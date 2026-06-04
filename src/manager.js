/**
 * manager.js
 * Asosiy entry point. CENTRAL_MODE ga qarab ishlash rejimini tanlaydi:
 *   CENTRAL_MODE=true  → Central server (Telegram + WebSocket, Minecraft yo'q)
 *   CENTRAL_MODE=false → Single-bot rejim (hozirgi kabi, bitta bot + Telegram)
 */

const fs = require('fs');
const path = require('path');

// ─── .env yuklash ─────────────────────────────────────────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

// ─── Rejimni aniqlash ─────────────────────────────────────────────────────────

const CENTRAL_MODE = process.env.CENTRAL_MODE === 'true';

if (CENTRAL_MODE) {
  runCentralMode();
} else {
  runSingleBotMode();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CENTRAL MODE — Telegram + WebSocket server, Minecraft yo'q
// ═══════════════════════════════════════════════════════════════════════════════

async function runCentralMode() {
  console.log('=====================================================');
  console.log('🌐 ArtiCRAFT Central Server');
  console.log('=====================================================');

  const tg = require('./telegram-bot');
  const { startCentralServer, getRegistry } = require('./central-server');

  const TOKEN   = process.env.CENTRAL_TOKEN   || 'changeme';
  const WS_PORT = parseInt(process.env.CENTRAL_WS_PORT   || '8765', 10);
  const HTTP_PORT = parseInt(process.env.CENTRAL_HTTP_PORT || '8766', 10);

  // ─── Central server ishga tushirish ────────────────────────────────────────
  const { registry } = startCentralServer({
    token: TOKEN,
    wsPort: WS_PORT,
    httpPort: HTTP_PORT,
    onNotify: (event, data) => {
      handleCentralNotification(event, data, tg);
    },
  });

  // ─── Telegram bot ishga tushirish ───────────────────────────────────────────
  tg.initTelegramBot({
    getBot: () => null, // Central serverda Minecraft boti yo'q
    getStatusFn: () => ({
      connected: false,
      username: 'Central Server',
      host: 'localhost',
      port: WS_PORT,
      mcVersion: null,
      health: null,
      food: null,
      position: null,
      inventoryCount: 0,
      lastKickReason: '',
      stoppedByBotCheck: false,
      stats: registry.getTotalStats(),
      scoreboard: null,
    }),
    execFn: () => {}, // Single-bot buyruqlari central'da ishlamaydi
    registry,         // Multi-bot boshqaruv uchun
  });

  console.log('[Manager] Central mode ishga tushdi.');
  console.log(`[Manager] WebSocket: ws://localhost:${WS_PORT}`);
  console.log(`[Manager] HTTP API: http://localhost:${HTTP_PORT}`);
}

/**
 * Central server hodisalarini Telegram'ga yuboradi.
 */
function handleCentralNotification(event, data, tg) {
  if (event === 'worker_connected') {
    tg.notifyWorkerStatus(data.id, true, `${data.info?.username || '?'} @ ${data.info?.host || '?'}`);
  } else if (event === 'worker_disconnected') {
    tg.notifyWorkerStatus(data.id, false, data.botStatus?.lastKickReason || '');
  } else if (event === 'log') {
    tg.forwardChatToTelegram({
      source: 'system',
      text: `[${data.workerId}] ${data.message}`,
    });
  } else if (event === 'inventory_response') {
    tg.sendInventoryToChat(data.chatId, data.items);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE-BOT MODE — Hozirgi arxitektura, bitta bot + Telegram
// ═══════════════════════════════════════════════════════════════════════════════

async function runSingleBotMode() {
  console.log('=====================================================');
  console.log('🤖 ArtiCRAFT Farmer/Seller Bot 🤖');
  console.log('=====================================================');

  const BotInstance = require('./bot-instance');
  const tg = require('./telegram-bot');
  const profiles = require('./profiles');

  // Profil yuklash
  const allProfiles = profiles.loadProfiles();
  let profile = allProfiles.find(p => p.enabled !== false);

  if (!profile) {
    profile = { ...profiles.DEFAULT_PROFILE };
    profiles.addProfile(profile);
    console.log('[Tizim] Yangi profil yaratildi:', profile.username);
  } else {
    if (process.env.MC_USERNAME) profile.username = process.env.MC_USERNAME;
    if (process.env.MC_PASSWORD) profile.password = process.env.MC_PASSWORD;
    if (process.env.MC_HOST)     profile.host     = process.env.MC_HOST;
    if (process.env.MC_PORT)     profile.port     = parseInt(process.env.MC_PORT, 10);
    if (process.env.MC_VERSION)  profile.version  = process.env.MC_VERSION;
    if (process.env.MC_AUTH)     profile.auth     = process.env.MC_AUTH;
    if (process.env.FARMING_CROPS) {
      profile.farmingCrops = process.env.FARMING_CROPS.split(',').map(c => c.trim());
    }
  }

  console.log(`[Tizim] Bot profili: ${profile.username} @ ${profile.host}:${profile.port}`);

  const botInst = new BotInstance(profile);

  // ─── Telegram Bot ───────────────────────────────────────────────────────────
  tg.initTelegramBot({
    getBot: () => botInst.bot,
    getStatusFn: () => ({
      connected: botInst.connected,
      username: botInst.bot?.username || botInst.profile.username,
      host: botInst.profile.host,
      port: botInst.profile.port,
      mcVersion: botInst.bot?.version || null,
      health: botInst.bot?.health ?? null,
      food: botInst.bot?.food ?? null,
      position: botInst.bot?.entity?.position
        ? `${botInst.bot.entity.position.x.toFixed(1)}, ${botInst.bot.entity.position.y.toFixed(1)}, ${botInst.bot.entity.position.z.toFixed(1)}`
        : null,
      inventoryCount: botInst.bot?.inventory?.items().length ?? 0,
      lastKickReason: botInst.lastKickReason,
      stoppedByBotCheck: botInst.stoppedByBotCheck,
      stats: botInst.getStats(),
      scoreboard: null,
    }),
    execFn: (action, args) => {
      switch (action) {
        case 'chat':      botInst.safeChat(args[0] || ''); break;
        case 'stop':      botInst.bot?.pathfinder?.stop(); break;
        case 'stop_all':
          botInst.bot?.pathfinder?.stop();
          for (const ctrl of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
            try { botInst.bot?.setControlState(ctrl, false); } catch (_) {}
          }
          break;
        case 'jump':
          if (botInst.bot) {
            botInst.bot.setControlState('jump', true);
            setTimeout(() => { botInst.bot?.setControlState('jump', false); }, 500);
          }
          break;
        case 'move': {
          const [dir, dur] = args;
          if (botInst.bot) {
            botInst.bot.setControlState(dir, true);
            setTimeout(() => { botInst.bot?.setControlState(dir, false); }, dur || 1_000);
          }
          break;
        }
        case 'control':   botInst.bot?.setControlState(args[0], args[1]); break;
        case 'inventory':
          if (botInst.bot?.inventory) {
            const items = botInst.bot.inventory.items().map(item => ({
              item: { displayName: item.displayName, name: item.name, count: item.count },
              label: 'Slot',
            }));
            tg.sendInventoryToChat(args[0], items);
          }
          break;
        case 'reconnect':
          botInst.stop();
          setTimeout(() => botInst.start(), 1_000);
          break;
        default:
          console.warn(`[Tizim] Noma'lum buyruq: ${action}`);
      }
    },
  });

  // ─── Bot hodisalari → Telegram ──────────────────────────────────────────────
  botInst.on('status_change', () => {
    tg.notifyStatus(botInst.connected, botInst.lastKickReason);
  });

  botInst.on('log', msg => {
    if (
      msg.includes('Serverdan chiqarildi') ||
      msg.includes('Muvaffaqiyatli Yoqish') ||
      msg.includes('Bot tiqilib qolgani')
    ) {
      tg.forwardChatToTelegram({ source: 'system', text: msg });
    }
  });

  botInst.start();
  console.log('[Tizim] Bot ishga tushdi. Boshqarish Telegram orqali amalga oshiriladi.');
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Tizim] ${signal} signal qabul qilindi. Yopilmoqda...`);
  setTimeout(() => { console.log('[Tizim] Yopildi.'); process.exit(0); }, 2_000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', err => {
  console.error('[Tizim] Uslanmagan xato:', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Tizim] Uslanmagan Promise rejection:', reason);
});
