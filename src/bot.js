const fs = require('fs');
const http = require('http');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
const WebSocket = require('ws');

loadEnvFile(path.join(__dirname, '..', '.env'));

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: toNumber(process.env.MC_PORT, 25565),
  username: process.env.MC_USERNAME || 'ArticraftBot',
  version: parseVersion(process.env.MC_VERSION),
  auth: process.env.MC_AUTH || 'offline',
  owner: process.env.MC_OWNER || '',
  password: process.env.MC_PASSWORD || '',
  autoLogin: process.env.AUTO_LOGIN !== 'false',
  antiAfk: process.env.AUTO_ANTIAFK !== 'false',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: toNumber(process.env.RECONNECT_DELAY_MS, 5000),
  stopOnBotCheckKick: process.env.STOP_ON_BOT_CHECK_KICK !== 'false',
  webHost: process.env.WEB_HOST || '127.0.0.1',
  webPort: toNumber(process.env.WEB_PORT, 3000),
  viewerEnabled: process.env.VIEWER_ENABLED !== 'false',
  viewerPort: toNumber(process.env.VIEWER_PORT, 3007)
};

let bot = null;
let reconnectTimer = null;
let antiAfkTimer = null;
let latestInventory = [];
let latestWindow = null;
let lastKickReason = '';
let stoppedByBotCheck = false;
let inventoryActionRunning = false;
let registerSent = false;
let loginSent = false;
let viewerStarted = false;
let controlReleaseTimers = new Map();
const chatHistory = [];
const maxChatHistory = 200;

const webClients = new Set();
const webServer = http.createServer(handleWebRequest);
const wsServer = new WebSocket.Server({ server: webServer });

wsServer.on('connection', socket => {
  webClients.add(socket);
  sendToSocket(socket, 'snapshot', getDashboardSnapshot());

  socket.on('message', rawMessage => {
    handleWebSocketMessage(socket, rawMessage);
  });

  socket.on('close', () => {
    webClients.delete(socket);
  });
});

webServer.listen(config.webPort, config.webHost, () => {
  log(`Web panel: http://${config.webHost}:${config.webPort}`);
});

function startBot() {
  clearReconnect();
  registerSent = false;
  loginSent = false;
  lastKickReason = '';
  stoppedByBotCheck = false;

  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    const movements = new Movements(bot);
    bot.pathfinder.setMovements(movements);

    // Prismarine-viewer 1.30 doesn't support display entities and crashes in browser.
    // We filter them out here to prevent the browser-side error.
    const ignoredEntities = ['text_display', 'item_display', 'block_display', 'interaction', 'item', 'display', 'marker', 'armor_stand', 'falling_block'];
    
    // Clean up already existing ignored entities that spawned during login
    for (const id in bot.entities) {
      if (bot.entities[id] && ignoredEntities.includes(bot.entities[id].name)) {
        delete bot.entities[id];
      }
    }

    const originalEmit = bot.emit;
    bot.emit = function (event, ...args) {
      if (event === 'entitySpawn' || event === 'entityUpdate') {
        const entity = args[0];
        if (entity && ignoredEntities.includes(entity.name)) {
          if (bot.entities[entity.id]) {
             delete bot.entities[entity.id];
          }
          return;
        }
      }
      return originalEmit.apply(this, [event, ...args]);
    };

    log(`Serverga ulandi: ${config.host}:${config.port} (${bot.username})`);
    broadcastStatus();
    updateInventory();
    bot.inventory.on('updateSlot', updateInventory);
    startViewer();
    loginIfNeeded();
    startAntiAfk();
    safeChat(`Salom! Men ${bot.username}. Buyruqlar uchun !help yozing.`);

    setTimeout(() => {
      safeChat('/anarxiya');
      log('/anarxiya buyrug\'i yuborildi.');
    }, 1000);
  });

  bot.on('messagestr', message => {
    addChatMessage('server', message);
    handleAuthPrompt(message);
  });

  bot.on('chat', (username, message) => {
    if (username === bot.username || !message.startsWith('!')) return;
    if (config.owner && username !== config.owner) return;

    handleCommand(username, message.trim());
  });

  bot.on('heldItemChanged', updateInventory);
  bot.on('windowUpdate', updateInventory);
  bot.on('playerCollect', updateInventory);
  bot.on('health', broadcastStatus);
  bot.on('scoreUpdated', broadcastStatus);
  bot.on('scoreRemoved', broadcastStatus);
  bot.on('scoreboardTitleChanged', broadcastStatus);
  bot.on('scoreboardCreated', broadcastStatus);
  bot.on('scoreboardDeleted', broadcastStatus);
  bot.on('windowOpen', updateCurrentWindow);
  bot.on('windowUpdate', updateCurrentWindow);
  bot.on('windowClose', () => {
    latestWindow = null;
    broadcast('window', latestWindow);
  });

  bot.on('kicked', reason => {
    lastKickReason = formatReason(reason);
    stoppedByBotCheck = config.stopOnBotCheckKick && isBotCheckKick(lastKickReason);

    log(`Serverdan chiqarildi: ${lastKickReason}`);
    addChatMessage('system', `Serverdan chiqarildi: ${lastKickReason}`);

    if (stoppedByBotCheck) {
      addChatMessage('system', 'Server bot tekshiruvini talab qildi. Avtomatik qayta ulanish toxtatildi.');
    }
  });

  bot.on('error', error => {
    log(`Xato: ${error.message}`);
    addChatMessage('system', `Xato: ${error.message}`);
  });

  bot.on('end', () => {
    log('Ulanish uzildi.');
    addChatMessage('system', 'Ulanish uzildi.');
    stopAntiAfk();
    broadcastStatus();
    scheduleReconnect();
  });
}

function handleCommand(username, message) {
  const [command, ...args] = message.slice(1).split(/\s+/);

  switch (command.toLowerCase()) {
    case 'help':
      safeChat('Buyruqlar: !status, !come, !follow, !stop, !jump, !say <xabar>');
      break;

    case 'status':
      safeChat(`HP: ${bot.health.toFixed(1)}, food: ${bot.food}, pos: ${formatPosition(bot.entity.position)}`);
      break;

    case 'come':
      goToPlayer(username);
      break;

    case 'follow':
      followPlayer(username);
      break;

    case 'stop':
      bot.pathfinder.stop();
      safeChat('Toxtadim.');
      break;

    case 'jump':
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 500);
      safeChat('Sakradim.');
      break;

    case 'say':
      if (args.length === 0) {
        safeChat('Xabar yozing: !say salom');
        return;
      }
      safeChat(args.join(' '));
      break;

    default:
      safeChat('Nomalum buyruq. !help yozing.');
  }
}

function loginIfNeeded() {
  if (!config.autoLogin || !config.password) return;

  setTimeout(() => {
    sendRegister();
  }, 1500);

  setTimeout(() => {
    sendLogin();
  }, 3500);
}

function handleAuthPrompt(message) {
  if (!config.autoLogin || !config.password) return;

  const normalized = stripControlCodes(String(message))
    .toLowerCase()
    .replace(/[‘’`]/g, "'");

  if (normalized.includes("ro'yxatdan") || normalized.includes('register')) {
    setTimeout(sendRegister, 500);
    return;
  }

  if (normalized.includes('login') || normalized.includes('kirish')) {
    setTimeout(sendLogin, 500);
  }
}

function sendRegister() {
  if (registerSent || !isBotSpawned()) return;
  registerSent = true;
  safeChat(`/register ${config.password} ${config.password}`);
  addChatMessage('system', '/register yuborildi.');
}

function sendLogin() {
  if (loginSent || !isBotSpawned()) return;
  loginSent = true;
  safeChat(`/login ${config.password}`);
  addChatMessage('system', '/login yuborildi.');
}

function startAntiAfk() {
  if (!config.antiAfk || antiAfkTimer) return;

  antiAfkTimer = setInterval(() => {
    if (!bot?.entity) return;

    bot.setControlState('jump', true);
    setTimeout(() => {
      if (bot) bot.setControlState('jump', false);
    }, 350);
  }, 45000);
}

function stopAntiAfk() {
  if (!antiAfkTimer) return;
  clearInterval(antiAfkTimer);
  antiAfkTimer = null;
}

function updateInventory() {
  if (!bot?.inventory) return;

  latestInventory = bot.inventory.slots
    .map((item, slot) => {
      return {
        slot,
        label: getSlotLabel(slot),
        item: item
          ? {
              name: item.name,
              displayName: item.displayName,
              count: item.count,
              type: item.type,
              metadata: item.metadata
            }
          : null
      };
    })
    .filter(entry => entry.slot >= 5);

  broadcast('inventory', latestInventory);
  broadcastStatus();
}

function updateCurrentWindow() {
  if (!bot?.currentWindow) {
    latestWindow = null;
    broadcast('window', latestWindow);
    return;
  }

  latestWindow = serializeWindow(bot.currentWindow);
  broadcast('window', latestWindow);
}

function addChatMessage(source, text) {
  const entry = {
    source,
    text: stripControlCodes(String(text)),
    time: new Date().toISOString()
  };

  chatHistory.push(entry);
  if (chatHistory.length > maxChatHistory) chatHistory.shift();

  broadcast('chat', entry);
}

function handleWebRequest(request, response) {
  if (request.method !== 'GET' || request.url !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  const filePath = path.join(__dirname, '..', 'public', 'index.html');
  fs.readFile(filePath, 'utf8', (error, html) => {
    if (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Panel fayli topilmadi.');
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
}

function handleWebSocketMessage(socket, rawMessage) {
  let payload;

  try {
    payload = JSON.parse(rawMessage.toString());
  } catch {
    sendToSocket(socket, 'error', "Noto'g'ri WebSocket xabari.");
    return;
  }

  if (payload.type === 'moveItem') {
    moveInventoryItem(socket, payload.fromSlot, payload.toSlot);
    return;
  }

  if (payload.type === 'moveWindowItem') {
    moveWindowItem(socket, payload.fromSlot, payload.toSlot);
    return;
  }

  if (payload.type === 'openContainer') {
    openNearestContainer(socket, payload.container);
    return;
  }

  if (payload.type === 'control') {
    handleControl(socket, payload);
    return;
  }

  if (payload.type === 'closeWindow') {
    closeCurrentWindow(socket);
    return;
  }

  if (payload.type !== 'sendChat') return;

  const message = String(payload.message || '').trim();
  if (!message) return;
  if (message.length > 256) {
    sendToSocket(socket, 'error', "Xabar 256 belgidan uzun bo'lmasin.");
    return;
  }

  if (!isBotSpawned()) {
    sendToSocket(socket, 'error', 'Bot hali serverga ulanmagan.');
    return;
  }

  safeChat(message);
  addChatMessage('panel', `<${config.username}> ${message}`);
}

function getDashboardSnapshot() {
  return {
    status: getStatus(),
    chat: chatHistory,
    inventory: latestInventory,
    window: latestWindow,
    viewer: getViewerInfo()
  };
}

function getStatus() {
  return {
    connected: isBotSpawned(),
    username: bot?.username || config.username,
    host: config.host,
    port: config.port,
    mcVersion: bot?.version || null,
    health: bot?.health ?? null,
    food: bot?.food ?? null,
    position: bot?.entity?.position ? formatPosition(bot.entity.position) : null,
    yaw: bot?.entity?.yaw ?? 0,
    pitch: bot?.entity?.pitch ?? 0,
    inventoryCount: latestInventory.filter(slot => slot.item).length,
    lastKickReason,
    stoppedByBotCheck,
    scoreboard: getScoreboard()
  };
}

function formatRawText(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (text.toMotd) return text.toMotd();
  if (text.toString) return text.toString();
  return JSON.stringify(text);
}

function getScoreboard() {
  if (!bot || !bot.scoreboard || !bot.scoreboard.sidebar) return null;
  const board = bot.scoreboard.sidebar;
  return {
    title: formatRawText(board.title),
    items: board.items.map(item => ({
      name: formatRawText(item.displayName || item.name || ''),
      value: item.value
    })).sort((a, b) => b.value - a.value)
  };
}

function isBotSpawned() {
  return Boolean(bot?.entity && typeof bot.chat === 'function');
}

function broadcastStatus() {
  broadcast('status', getStatus());
}

function broadcast(type, data) {
  for (const socket of webClients) {
    sendToSocket(socket, type, data);
  }
}

function sendToSocket(socket, type, data) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, data }));
}

function handleControl(socket, payload) {
  if (!isBotSpawned()) {
    sendToSocket(socket, 'error', 'Bot hali serverga ulanmagan.');
    return;
  }

  const action = String(payload.action || '');
  const active = payload.active !== false;
  const durationMs = clampDuration(payload.durationMs);

  if (action === 'look') {
    const yaw = Number(payload.yaw);
    const pitch = Number(payload.pitch);

    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
      sendToSocket(socket, 'error', 'Look koordinatalari noto‘g‘ri.');
      return;
    }

    bot.look(yaw, pitch, true).catch(error => {
      // silently ignore look errors during fast movements
    });
    return;
  }

  if (action === 'attack') {
    const block = bot.blockAtCursor(5);
    if (block) {
      if (bot.canDigBlock(block)) {
        bot.dig(block, true, 'raycast').catch(() => {});
      }
    } else {
      const entity = bot.entityAtCursor(5);
      if (entity) {
        bot.attack(entity);
      } else {
        bot.swingArm();
      }
    }
    return;
  }
  
  if (action === 'stop_digging') {
    bot.stopDigging();
    return;
  }

  if (action === 'use') {
    const block = bot.blockAtCursor(5);
    if (block) {
      bot.activateBlock(block).catch(() => {});
    } else {
      bot.activateItem();
    }
    return;
  }

  if (action === 'stop_all') {
    stopAllControls();
    return;
  }

  if (!isSupportedControl(action)) {
    sendToSocket(socket, 'error', 'Noma‘lum control amali.');
    return;
  }

  bot.setControlState(action, active);

  if (active && durationMs > 0) {
    clearControlRelease(action);
    controlReleaseTimers.set(
      action,
      setTimeout(() => {
        if (bot) bot.setControlState(action, false);
        clearControlRelease(action);
      }, durationMs)
    );
  } else if (!active) {
    clearControlRelease(action);
  }
}

function startViewer() {
  if (!config.viewerEnabled || viewerStarted) return;

  try {
    mineflayerViewer(bot, {
      port: config.viewerPort,
      firstPerson: true
    });
    viewerStarted = true;
    log(`3D viewer: http://127.0.0.1:${config.viewerPort}`);
    broadcast('viewer', getViewerInfo());
  } catch (error) {
    log(`3D viewer xatosi: ${error.message}`);
    addChatMessage('system', `3D viewer xatosi: ${error.message}`);
  }
}

function getViewerInfo() {
  return {
    enabled: config.viewerEnabled,
    started: viewerStarted,
    url: `http://127.0.0.1:${config.viewerPort}`
  };
}

async function moveInventoryItem(socket, fromSlot, toSlot) {
  const from = Number(fromSlot);
  const to = Number(toSlot);

  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

  if (!isBotSpawned() || !bot?.inventory) {
    sendToSocket(socket, 'error', 'Bot inventory boshqarish uchun serverda bo‘lishi kerak.');
    return;
  }

  if (!isManageableSlot(from) || !isManageableSlot(to)) {
    sendToSocket(socket, 'error', 'Bu slotni paneldan boshqarib bo‘lmaydi.');
    return;
  }

  if (!bot.inventory.slots[from]) {
    sendToSocket(socket, 'error', 'Tanlangan slot bo‘sh.');
    return;
  }

  if (inventoryActionRunning) {
    sendToSocket(socket, 'error', 'Oldingi inventory amali hali tugamadi.');
    return;
  }

  inventoryActionRunning = true;

  try {
    const targetHadItem = Boolean(bot.inventory.slots[to]);

    await bot.clickWindow(from, 0, 0);
    await bot.clickWindow(to, 0, 0);

    if (targetHadItem) {
      await bot.clickWindow(from, 0, 0);
    }

    addChatMessage('system', `Inventory: #${from} -> #${to}`);
    setTimeout(updateInventory, 250);
  } catch (error) {
    sendToSocket(socket, 'error', `Inventory amalida xato: ${error.message}`);
  } finally {
    inventoryActionRunning = false;
  }
}

async function moveWindowItem(socket, fromSlot, toSlot) {
  const from = Number(fromSlot);
  const to = Number(toSlot);

  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;

  if (!isBotSpawned() || !bot?.currentWindow) {
    sendToSocket(socket, 'error', 'Avval chest, ender chest yoki boshqa container ochilishi kerak.');
    return;
  }

  const slots = bot.currentWindow.slots || [];
  if (from < 0 || to < 0 || from >= slots.length || to >= slots.length) {
    sendToSocket(socket, 'error', 'Container slot raqami noto‘g‘ri.');
    return;
  }

  if (!slots[from]) {
    sendToSocket(socket, 'error', 'Tanlangan container sloti bo‘sh.');
    return;
  }

  if (inventoryActionRunning) {
    sendToSocket(socket, 'error', 'Oldingi inventory amali hali tugamadi.');
    return;
  }

  inventoryActionRunning = true;

  try {
    const targetHadItem = Boolean(slots[to]);

    await bot.clickWindow(from, 0, 0);
    await bot.clickWindow(to, 0, 0);

    if (targetHadItem) {
      await bot.clickWindow(from, 0, 0);
    }

    addChatMessage('system', `Container: #${from} -> #${to}`);
    setTimeout(updateCurrentWindow, 250);
    setTimeout(updateInventory, 250);
  } catch (error) {
    sendToSocket(socket, 'error', `Container amalida xato: ${error.message}`);
  } finally {
    inventoryActionRunning = false;
  }
}

async function openNearestContainer(socket, container) {
  if (!isBotSpawned()) {
    sendToSocket(socket, 'error', 'Bot serverda bo‘lishi kerak.');
    return;
  }

  const names = getContainerBlockNames(container);
  const ids = names
    .map(name => bot.registry.blocksByName[name]?.id)
    .filter(id => typeof id === 'number');

  if (ids.length === 0) {
    sendToSocket(socket, 'error', 'Bu Minecraft versiyasida container block topilmadi.');
    return;
  }

  const block = bot.findBlock({
    matching: ids,
    maxDistance: 6
  });

  if (!block) {
    sendToSocket(socket, 'error', `Yaqin atrofda ${container || 'container'} topilmadi.`);
    return;
  }

  try {
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true);
    await bot.openContainer(block);
    addChatMessage('system', `${block.name} ochildi.`);
    setTimeout(updateCurrentWindow, 250);
  } catch (error) {
    sendToSocket(socket, 'error', `${block.name} ochilmadi: ${error.message}`);
  }
}

function closeCurrentWindow(socket) {
  if (!bot?.currentWindow) {
    sendToSocket(socket, 'error', 'Ochilgan container yo‘q.');
    return;
  }

  bot.closeWindow(bot.currentWindow);
  latestWindow = null;
  broadcast('window', latestWindow);
}

function isManageableSlot(slot) {
  return slot >= 9 && slot <= 44;
}

function isSupportedControl(action) {
  return ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'].includes(action);
}

function stopAllControls() {
  for (const action of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
    bot.setControlState(action, false);
    clearControlRelease(action);
  }
}

function clearControlRelease(action) {
  const timer = controlReleaseTimers.get(action);
  if (!timer) return;
  clearTimeout(timer);
  controlReleaseTimers.delete(action);
}

function clampDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(duration, 10_000);
}

function getSlotLabel(slot) {
  if (slot >= 9 && slot <= 35) return 'Bag';
  if (slot >= 36 && slot <= 44) return 'Hotbar';
  if (slot >= 5 && slot <= 8) return 'Armor';
  if (slot === 45) return 'Offhand';
  return 'Slot';
}

function serializeWindow(window) {
  const inventoryStart = window.inventoryStart ?? 0;

  return {
    id: window.id,
    type: window.type,
    title: formatWindowTitle(window.title),
    inventoryStart,
    slots: window.slots.map((item, slot) => ({
      slot,
      label: slot < inventoryStart ? 'Container' : getSlotLabel(slot),
      item: item
        ? {
            name: item.name,
            displayName: item.displayName,
            count: item.count,
            type: item.type,
            metadata: item.metadata
          }
        : null
    }))
  };
}

function formatWindowTitle(title) {
  if (!title) return 'Container';
  if (typeof title === 'string') return stripControlCodes(title);
  return stripControlCodes(formatReason(title));
}

function getContainerBlockNames(container) {
  if (container === 'ender_chest') return ['ender_chest'];
  if (container === 'barrel') return ['barrel'];
  if (container === 'shulker_box') {
    return [
      'shulker_box',
      'white_shulker_box',
      'orange_shulker_box',
      'magenta_shulker_box',
      'light_blue_shulker_box',
      'yellow_shulker_box',
      'lime_shulker_box',
      'pink_shulker_box',
      'gray_shulker_box',
      'light_gray_shulker_box',
      'cyan_shulker_box',
      'purple_shulker_box',
      'blue_shulker_box',
      'brown_shulker_box',
      'green_shulker_box',
      'red_shulker_box',
      'black_shulker_box'
    ];
  }

  return ['chest', 'trapped_chest'];
}

function goToPlayer(username) {
  const target = bot.players[username]?.entity;
  if (!target) {
    safeChat(`${username}, sizni topa olmadim.`);
    return;
  }

  const goal = new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1);
  bot.pathfinder.setGoal(goal);
  safeChat(`${username}, yoningizga kelyapman.`);
}

function followPlayer(username) {
  const target = bot.players[username]?.entity;
  if (!target) {
    safeChat(`${username}, sizni topa olmadim.`);
    return;
  }

  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
  safeChat(`${username}, sizni kuzatyapman.`);
}

function scheduleReconnect() {
  if (!config.autoReconnect || reconnectTimer || stoppedByBotCheck) return;

  reconnectTimer = setTimeout(() => {
    log('Qayta ulanish...');
    startBot();
  }, config.reconnectDelayMs);
}

function clearReconnect() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function safeChat(message) {
  if (!bot || !bot.chat) return;
  bot.chat(message);
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseVersion(value) {
  if (!value || value === 'false' || value === 'auto') return false;
  return value;
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPosition(position) {
  return `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
}

function formatReason(reason) {
  if (typeof reason === 'string') return reason;

  const parts = [];
  collectTextParts(reason, parts);

  return parts.length > 0 ? parts.join('').trim() : JSON.stringify(reason);
}

function stripControlCodes(value) {
  return value.replace(/\u00a7[0-9a-fk-or]/gi, '');
}

function collectTextParts(node, parts, key = '') {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'string' && typeof node.value === 'string') {
    if (key !== 'color') parts.push(node.value);
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collectTextParts(item, parts);
    return;
  }

  if (node.type === 'list' && node.value?.value) {
    collectTextParts(node.value.value, parts);
    return;
  }

  if (node.type === 'compound' && node.value) {
    for (const [childKey, child] of Object.entries(node.value)) {
      collectTextParts(child, parts, childKey);
    }
    return;
  }

  if (node.value && typeof node.value === 'object') {
    collectTextParts(node.value, parts, key);
    return;
  }

  for (const [childKey, child] of Object.entries(node)) {
    collectTextParts(child, parts, childKey);
  }
}

function isBotCheckKick(reason) {
  const normalized = reason.toLowerCase();
  return normalized.includes('проверку на бота') || normalized.includes('bot');
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

startBot();
