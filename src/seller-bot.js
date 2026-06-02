const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const inventoryViewer = require('mineflayer-web-inventory');

// .env faylidan sozlamalarni yuklash
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

loadEnvFile(path.join(__dirname, '..', '.env'));

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseVersion(value) {
  if (!value || value === 'false' || value === 'auto') return false;
  return value;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] [SellerBot] ${message}`);
}

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: toNumber(process.env.MC_PORT, 25565),
  username: process.env.MC_SELLER_USERNAME || 'lxz_401', // Sotuvchi uchun alohida ism
  version: parseVersion(process.env.MC_VERSION),
  auth: process.env.MC_AUTH || 'offline',
  password: process.env.MC_SELLER_PASSWORD || process.env.MC_PASSWORD || 'bobo',
  autoLogin: process.env.AUTO_LOGIN !== 'false',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: toNumber(process.env.RECONNECT_DELAY_MS, 5000),
};

let bot = null;
let isWorking = false;
let reconnectTimer = null;
let farmInterval = null;
let chestPos = null;

const chestFile = path.join(__dirname, 'chest-pos.json');

function loadChestPos() {
  try {
    if (fs.existsSync(chestFile)) {
      const data = JSON.parse(fs.readFileSync(chestFile, 'utf8'));
      if (data && data.x !== undefined && data.y !== undefined && data.z !== undefined) {
        return new Vec3(data.x, data.y, data.z);
      }
    }
  } catch (err) {
    log(`Sandiq faylini o'qishda xatolik: ${err.message}`);
  }
  return null;
}

function saveChestPos(pos) {
  chestPos = pos;
  fs.writeFileSync(chestFile, JSON.stringify({ x: pos.x, y: pos.y, z: pos.z }));
}

function startBot() {
  clearReconnect();
  chestPos = loadChestPos();
  if (chestPos) {
     log(`Sandiq kordinatasi yuklandi: ${chestPos.x}, ${chestPos.y}, ${chestPos.z}`);
  }
  
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

    log(`Serverga ulandi: ${config.host}:${config.port} (${bot.username})`);
    
    // Web inventoryni ishga tushirish (port 3009)
    inventoryViewer(bot, { port: 3009 });
    log(`Web Inventar ishga tushdi: http://localhost:3009`);

    loginIfNeeded();
    
    setTimeout(() => {
      if (bot && bot.entity) {
          bot.chat('/anarxiya');
          log('/anarxiya buyrug\'i yuborildi.');
      }
    }, 1000);
    
    // Sandiqni tekshirish siklini boshlash
    if (farmInterval) clearInterval(farmInterval);
    farmInterval = setInterval(withdrawLoop, 5000); // Har 5 soniyada sandiqdan olishga harakat qiladi
  });

  bot.on('messagestr', message => {
    handleAuthPrompt(message);
  });

  bot.on('kicked', reason => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log(`Serverdan chiqarildi: ${reasonStr}`);
    if (reasonStr.includes('ko‘p akkaunt') || reasonStr.includes('ko\\u2018p akkaunt')) {
        config.autoReconnect = false;
    }
  });

  bot.on('error', error => {
    log(`Xato: ${error.message}`);
  });

  bot.on('end', () => {
    log('Ulanish uzildi.');
    if (farmInterval) {
        clearInterval(farmInterval);
        farmInterval = null;
    }
    isWorking = false;
    scheduleReconnect();
  });
}

function loginIfNeeded() {
  if (!config.autoLogin || !config.password) return;
  setTimeout(() => {
    if (bot && bot.entity) bot.chat(`/register ${config.password} ${config.password}`);
  }, 1500);
  setTimeout(() => {
    if (bot && bot.entity) bot.chat(`/login ${config.password}`);
  }, 3500);
}

function handleAuthPrompt(message) {
  if (!config.autoLogin || !config.password) return;
  const normalized = String(message).toLowerCase().replace(/\u00a7[0-9a-fk-or]/gi, '');
  if (normalized.includes("ro'yxatdan") || normalized.includes('register')) {
    setTimeout(() => { if (bot && bot.entity) bot.chat(`/register ${config.password} ${config.password}`) }, 500);
  } else if (normalized.includes('login') || normalized.includes('kirish')) {
    setTimeout(() => { if (bot && bot.entity) bot.chat(`/login ${config.password}`) }, 500);
  }
}

async function withdrawLoop() {
  if (!bot || !bot.entity || isWorking) return;

  // Har safar ishlashdan oldin sandiq kordinatasini qayta o'qib ko'ramiz (agar boshqa bot o'zgartirgan bo'lsa)
  chestPos = loadChestPos();
  
  if (!chestPos) {
     return; // Sandiq kordinatasi yo'q bo'lsa hech narsa qilmaydi
  }

  // Inventar to'la bo'lsa ishlamaydi
  if (bot.inventory.emptySlotCount() === 0) {
      log("Inventar to'la, sandiqdan ola olmayman!");
      return;
  }

  isWorking = true;

  try {
    const chestGoal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 1);
    await bot.pathfinder.goto(chestGoal);

    let targetChestBlock = bot.blockAt(chestPos);
    
    // Agar kordinatada to'g'ridan-to'g'ri sandiq bo'lmasa
    if (!targetChestBlock || !['chest', 'trapped_chest', 'barrel'].includes(targetChestBlock.name)) {
        const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
        targetChestBlock = bot.findBlock({ matching: chestIds, maxDistance: 4, point: chestPos });
    }

    if (!targetChestBlock) {
        isWorking = false;
        return;
    }

    const chest = await bot.openContainer(targetChestBlock);
    
    // Sandiqdan cocoa beans qidirish
    const cocoaItemId = bot.registry.itemsByName.cocoa_beans?.id;
    if (cocoaItemId) {
        const items = chest.containerItems().filter(item => item.type === cocoaItemId);
        let withdrawn = 0;
        
        for (const item of items) {
           if (bot.inventory.emptySlotCount() === 0) break; // Inventar to'lsa to'xtaydi
           await chest.withdraw(item.type, null, item.count).catch(() => {});
           withdrawn += item.count;
        }

        if (withdrawn > 0) {
            log(`Sandiqdan ${withdrawn} ta cocoa beans olindi.`);
        }
    }
    
    await chest.close();

  } catch (err) {
    if (err.name !== 'NoPath') {
        log(`Xato: ${err.message}`);
    }
  } finally {
    isWorking = false;
  }
}

function scheduleReconnect() {
  if (!config.autoReconnect || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    log('Qayta ulanishga harakat qilinmoqda...');
    startBot();
  }, config.reconnectDelayMs);
}

function clearReconnect() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// Terminaldan chatga yozish uchun
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

process.on('uncaughtException', (err) => {
  log(`Tizim xatosi ushlandi: ${err.message}`);
});

rl.on('line', (line) => {
  const message = line.trim();
  if (message) {
    if (bot && bot.entity) {
      if (message.startsWith('!setchest')) {
        const parts = message.split(/\s+/);
        if (parts.length === 4) {
          const x = parseInt(parts[1]);
          const y = parseInt(parts[2]);
          const z = parseInt(parts[3]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            saveChestPos(new Vec3(x, y, z));
            log(`Sandiq kordinatasi o'rnatildi: ${x}, ${y}, ${z}`);
            return;
          }
        }
        
        const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
        const targetBlock = bot.findBlock({ matching: chestIds, maxDistance: 6 });
        if (targetBlock) {
           saveChestPos(targetBlock.position);
           log(`Sandiq topildi va kordinatasi saqlandi: ${chestPos.x}, ${chestPos.y}, ${chestPos.z}`);
        } else {
           log("Yaqin atrofda sandiq topilmadi. Yoki aniq kordinata bering: !setchest x y z");
        }
        return;
      }

      bot.chat(message);
      log(`Terminaldan: ${message}`);
    } else {
      log('Bot hali serverga ulanmagan.');
    }
  }
});

startBot();
