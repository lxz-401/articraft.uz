/**
 * manager.js
 * Botni ishga tushiruvchi asosiy entry point.
 * .env yuklab, profil yaratib, BotInstance va Telegram botni ulaydi.
 */

const fs = require('fs');
const path = require('path');
const BotInstance = require('./bot-instance');
const tg = require('./telegram-bot');
const profiles = require('./profiles');

// ─── .env yuklash ────────────────────────────────────────────────────────────

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
    // Tirnoqlarni olib tashlash
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    // Mavjud bo'lmasa o'rnatish (process.env ustunlik qiladi)
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '..', '.env'));

// ─── Asosiy funksiya ─────────────────────────────────────────────────────────

async function main() {
  console.log('=====================================================');
  console.log('🤖 ArtiCRAFT Farmer/Seller Bot 🤖');
  console.log('=====================================================');

  // Profil yuklash yoki yaratish
  const allProfiles = profiles.loadProfiles();
  let profile = allProfiles.find(p => p.enabled !== false);

  if (!profile) {
    // Hech qanday faol profil topilmasa — default profil yaratamiz
    profile = { ...profiles.DEFAULT_PROFILE };
    profiles.addProfile(profile);
    console.log('[Tizim] Yangi profil yaratildi:', profile.username);
  } else {
    // .env qiymatlari profiles.json ustidan ustunlik qilsin
    if (process.env.MC_USERNAME) profile.username = process.env.MC_USERNAME;
    if (process.env.MC_PASSWORD) profile.password = process.env.MC_PASSWORD;
    if (process.env.MC_HOST)     profile.host = process.env.MC_HOST;
    if (process.env.MC_PORT)     profile.port = parseInt(process.env.MC_PORT, 10);
    if (process.env.MC_VERSION)  profile.version = process.env.MC_VERSION;
    if (process.env.MC_AUTH)     profile.auth = process.env.MC_AUTH;
  }

  console.log(`[Tizim] Bot profili: ${profile.username} @ ${profile.host}:${profile.port}`);

  const botInst = new BotInstance(profile);

  // ─── Telegram Bot ─────────────────────────────────────────────────────────

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
      stats: botInst.getStats(),   // /stats buyrug'i uchun
      scoreboard: null,
    }),

    execFn: (action, args) => {
      switch (action) {
        case 'chat':
          botInst.safeChat(args[0] || '');
          break;

        case 'stop':
          if (botInst.bot?.pathfinder) botInst.bot.pathfinder.stop();
          break;

        case 'stop_all':
          if (botInst.bot?.pathfinder) botInst.bot.pathfinder.stop();
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

        case 'control': {
          const [ctrl, active] = args;
          botInst.bot?.setControlState(ctrl, active);
          break;
        }

        case 'inventory':
          if (botInst.bot?.inventory) {
            const items = botInst.bot.inventory.items().map(item => ({
              item: {
                displayName: item.displayName,
                name: item.name,
                count: item.count,
              },
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

  // ─── Bot hodisalari → Telegram ────────────────────────────────────────────

  botInst.on('status_change', () => {
    tg.notifyStatus(botInst.connected, botInst.lastKickReason);
  });

  botInst.on('log', msg => {
    // Faqat muhim tizim xabarlarini Telegram'ga yuborish
    if (
      msg.includes('Serverdan chiqarildi') ||
      msg.includes('Muvaffaqiyatli Yoqish') ||
      msg.includes('Bot tiqilib qolgani')
    ) {
      tg.forwardChatToTelegram({ source: 'system', text: msg });
    }
  });

  // ─── Botni ishga tushirish ────────────────────────────────────────────────

  botInst.start();
  console.log('[Tizim] Bot ishga tushdi. Boshqarish Telegram orqali amalga oshiriladi.');
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[Tizim] ${signal} signal qabul qilindi. Yopilmoqda...`);

  // Node.js process'ni majburan yopish (bot.end() async, shuning uchun timeout)
  setTimeout(() => {
    console.log('[Tizim] Yopildi.');
    process.exit(0);
  }, 2_000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', err => {
  console.error('[Tizim] Uslanmagan xato:', err.stack || err.message || err);
  // Kritik xato — shutdown qilmaslik, faqat log
});

process.on('unhandledRejection', (reason) => {
  console.error('[Tizim] Uslanmagan Promise rejection:', reason);
});

// ─── Ishga tushirish ─────────────────────────────────────────────────────────

main().catch(err => {
  console.error('[Manager] Kritik xato:', err.stack || err.message || err);
  process.exit(1);
});
