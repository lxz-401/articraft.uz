const fs = require('fs');
const path = require('path');
const BotInstance = require('./bot-instance');
const tg = require('./telegram-bot');
const profiles = require('./profiles');

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

async function main() {
  console.log('=====================================================');
  console.log('🤖 Birlashtirilgan Farmer/Seller Bot 🤖');
  console.log('=====================================================');

  // To keep things simple, we create ONE main bot profile if none exists,
  // or use the first one that is enabled.
  const allProfiles = profiles.loadProfiles();
  let mainProfile = allProfiles.find(p => p.enabled);
  
  if (!mainProfile) {
    mainProfile = {
      id: "farmer_seller",
      name: "Farmer & Seller",
      host: process.env.MC_HOST || "articraft.uz",
      port: 25565,
      username: process.env.MC_USERNAME || "ArticraftBot",
      password: process.env.MC_PASSWORD || "",
      version: process.env.MC_VERSION || "1.21.11",
      auth: process.env.MC_AUTH || "offline",
      autoLogin: true,
      autoReconnect: true,
      reconnectDelayMs: 5000,
      enabled: true
    };
    profiles.addProfile(mainProfile);
  }

  console.log(`[Tizim] Bot profili yuklandi: ${mainProfile.username}`);

  const botInst = new BotInstance(mainProfile);

  // Initialize Telegram Bot
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
      position: botInst.bot?.entity?.position ? `${botInst.bot.entity.position.x.toFixed(1)}, ${botInst.bot.entity.position.y.toFixed(1)}, ${botInst.bot.entity.position.z.toFixed(1)}` : null,
      inventoryCount: botInst.bot?.inventory?.items().length ?? 0,
      lastKickReason: botInst.lastKickReason,
      stoppedByBotCheck: botInst.stoppedByBotCheck,
      scoreboard: null // Simplify scoreboard for now
    }),
    execFn: (action, args) => {
      switch (action) {
        case 'chat':
          botInst.safeChat(args[0] || '');
          break;
        case 'come':
          // Optional: handle come using utils and bot.players
          break;
        case 'follow':
          // Optional: handle follow
          break;
        case 'stop':
          if (botInst.bot && botInst.bot.pathfinder) botInst.bot.pathfinder.stop();
          break;
        case 'stop_all':
          if (botInst.bot && botInst.bot.pathfinder) botInst.bot.pathfinder.stop();
          for (const a of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
            try { botInst.bot.setControlState(a, false); } catch(e){}
          }
          break;
        case 'jump':
          if (botInst.bot) {
            botInst.bot.setControlState('jump', true);
            setTimeout(() => { if (botInst.bot) botInst.bot.setControlState('jump', false); }, 500);
          }
          break;
        case 'move':
          if (botInst.bot) {
            const [dir, dur] = args;
            botInst.bot.setControlState(dir, true);
            setTimeout(() => { if (botInst.bot) botInst.bot.setControlState(dir, false); }, dur || 1000);
          }
          break;
        case 'control':
          if (botInst.bot) {
            const [ctrl, active] = args;
            botInst.bot.setControlState(ctrl, active);
          }
          break;
        case 'inventory':
          if (botInst.bot && botInst.bot.inventory) {
            const items = botInst.bot.inventory.items().map(item => ({
              item: { displayName: item.displayName, name: item.name, count: item.count },
              label: 'Slot'
            }));
            tg.sendInventoryToChat(args[0], items);
          }
          break;
        case 'reconnect':
          botInst.stop();
          setTimeout(() => botInst.start(), 1000);
          break;
      }
    }
  });

  // Wire up bot events to Telegram notifications
  botInst.on('status_change', () => {
    tg.notifyStatus(botInst.connected, botInst.lastKickReason);
  });

  botInst.on('log', (msg) => {
    // Only forward important system messages to telegram if needed
    if (msg.includes("Serverdan chiqarildi") || msg.includes("Muvaffaqiyatli Yoqish")) {
       tg.forwardChatToTelegram({ source: 'system', text: msg });
    }
  });

  botInst.start();
  console.log('[Tizim] Hamma narsa tayyor. Boshqarish Telegram orqali amalga oshiriladi.');
}

function shutdown() {
  console.log('\n[Tizim] Tizim yopilmoqda...');
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('[Tizim Xatosi Uslandi]:', err);
});

main().catch(err => {
  console.error('[Manager Main Error]:', err);
});
