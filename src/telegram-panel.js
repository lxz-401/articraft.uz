const TelegramBot = require('node-telegram-bot-api');
const profiles = require('./profiles');
const BotInstance = require('./bot-instance');
const { Vec3 } = require('vec3');

let tgBot = null;
let ALLOWED_IDS = [];
let botInstancesMap = null; // Map of id -> BotInstance
let registerBotInstanceFn = null; // Function to register new BotInstance dynamically
let unregisterBotInstanceFn = null; // Function to unregister BotInstance dynamically

const creationStates = new Map(); // chatId -> { step, data }
const userActiveBot = new Map(); // chatId -> botId (which bot they are currently viewing/interacting with)
const userChatState = new Map(); // chatId -> { action: 'chat' }

// Emojis for Minecraft items in inventory
const emojiMap = {
  cocoa_beans: '🍫',
  netherite_axe: '🪓',
  diamond_axe: '🪓',
  golden_axe: '🪓',
  iron_axe: '🪓',
  stone_axe: '🪓',
  wooden_axe: '🪓',
  netherite_sword: '⚔️',
  diamond_sword: '⚔️',
  golden_sword: '⚔️',
  iron_sword: '⚔️',
  stone_sword: '⚔️',
  wooden_sword: '⚔️',
  wheat: '🌾',
  wheat_seeds: '🌱',
  chest: '📦',
  ender_chest: '📦',
  barrel: '🛢️',
  jungle_log: '🪵',
  jungle_wood: '🪵',
  netherite_helmet: '🪖',
  diamond_helmet: '🪖',
  iron_helmet: '🪖',
  netherite_chestplate: '👕',
  diamond_chestplate: '👕',
  iron_chestplate: '👕',
  netherite_leggings: '👖',
  diamond_leggings: '👖',
  iron_leggings: '👖',
  netherite_boots: '🥾',
  diamond_boots: '🥾',
  iron_boots: '🥾'
};

function getItemEmoji(name) {
  if (!name) return '📦';
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (name.toLowerCase().includes(key)) return emoji;
  }
  return '📦';
}

function initTelegramPanel(botInstances, registerFn, unregisterFn) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] TELEGRAM_BOT_TOKEN aniqlanmadi. Telegram panel o\'chirildi.');
    return null;
  }

  ALLOWED_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(Number);

  botInstancesMap = botInstances;
  registerBotInstanceFn = registerFn;
  unregisterBotInstanceFn = unregisterFn;

  tgBot = new TelegramBot(token, { polling: true });

  console.log('[Telegram] Premium Telegram panel bot ishga tushdi ✅');
  
  tgBot.on('polling_error', err => {
    console.error('[Telegram] Polling xato:', err.message || err);
  });

  registerHandlers();
  subscribeToBotEvents();

  return tgBot;
}

function isAllowed(chatId) {
  if (ALLOWED_IDS.length === 0) return true;
  return ALLOWED_IDS.includes(Number(chatId));
}

function guard(msg, fn) {
  if (!isAllowed(msg.chat.id)) {
    tgBot.sendMessage(msg.chat.id, '⛔ Ruxsat berilmagan. Sizning Chat ID: ' + msg.chat.id);
    return;
  }
  try {
    fn();
  } catch (err) {
    tgBot.sendMessage(msg.chat.id, `❌ Xato: ${err.message}`);
  }
}

function subscribeToBotEvents() {
  for (const botInst of botInstancesMap.values()) {
    bindEvents(botInst);
  }
}

function bindEvents(botInst) {
  botInst.on('started', () => {
    sendToAllAllowed(`✅ *[${botInst.name}]* serverga ulandi!`);
  });

  botInst.on('stopped', () => {
    sendToAllAllowed(`❌ *[${botInst.name}]* serverdan uzildi.`);
  });

  botInst.on('kick', reason => {
    sendToAllAllowed(`⚠️ *[${botInst.name}]* Kick qilindi: \`${reason}\``);
  });

  botInst.on('low_health', health => {
    sendToAllAllowed(`⚠️ *[${botInst.name}]* HP juda past! ❤️ \`${health.toFixed(1)} / 20\``);
  });

  botInst.on('chat', (source, text) => {
    if (botInst.profile.telegramForwardChat !== false && (source === 'chat' || source === 'server')) {
      if (text.includes('/login') || text.includes('/register')) return;
      sendToAllAllowed(`💬 *[${botInst.name}]* ${escapeMarkdown(text)}`);
    }
  });
}

function sendToAllAllowed(message, options = { parse_mode: 'Markdown' }) {
  if (!tgBot) return;
  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, message, options).catch(() => {});
  }
}

function getBotStatusEmoji(botInst) {
  if (!botInst) return '⚪ O\'chirilgan';
  if (botInst.connected) return '🟢 Ulangan';
  if (botInst.stopped) return '🔴 O\'chirilgan';
  return '🟡 Ulanmoqda...';
}

function registerHandlers() {
  // Main Menu Reply Keyboard
  const mainMenuKeyboard = {
    reply_markup: {
      keyboard: [
        [{ text: '🤖 Botlar' }, { text: '👤 Profillar' }],
        [{ text: '➕ Yangi Profil' }, { text: '🌾 Umumiy Stats' }],
        [{ text: '▶️ Hammasini yoqish' }, { text: '🛑 Hammasini o\'chirish' }]
      ],
      resize_keyboard: true
    }
  };

  // /start & /help
  tgBot.onText(/\/start|\/help/, msg => {
    guard(msg, () => {
      const text = [
        '🎮 *Birlashtirilgan Minecraft Bot Manager — Premium Panel*',
        '',
        'Pastdagi menyu tugmalari orqali botlarni to\'liq interaktiv tarzda boshqarishingiz mumkin.',
        'Dashboard orqali har bir botni yoqish, inventar, log va statuslarini bitta oynada ko\'ra olasiz.',
        '',
        '📚 *Mavjud Buyruqlar:*',
        '/bots — Botlarni boshqarish paneli',
        '/profiles — Profillar ro\'yxati',
        '/newprofile — Yangi bot yaratish',
        '/stopall — Barcha botlarni to\'xtatish',
        '/runall — Barcha botlarni ulatish',
        '/farmstats <id> — Rol statistikasi',
        '/setchest <id> <x> <y> <z> — Sandiq koordinatasi'
      ].join('\n');
      
      tgBot.sendMessage(msg.chat.id, text, {
        parse_mode: 'Markdown',
        reply_markup: mainMenuKeyboard.reply_markup
      });
    });
  });

  // Handle Text Menu Interactions
  tgBot.on('message', msg => {
    if (!msg.text) return;
    if (msg.text.startsWith('/')) return; // handled by onText regexes

    guard(msg, () => {
      const text = msg.text.trim();
      
      if (text === '🤖 Botlar') {
        sendBotsDashboard(msg.chat.id);
      } else if (text === '👤 Profillar') {
        sendProfilesList(msg.chat.id);
      } else if (text === '➕ Yangi Profil') {
        startNewProfileWizard(msg.chat.id);
      } else if (text === '🌾 Umumiy Stats') {
        sendGeneralStats(msg.chat.id);
      } else if (text === '▶️ Hammasini yoqish') {
        runAllBots(msg.chat.id);
      } else if (text === '🛑 Hammasini o\'chirish') {
        stopAllBots(msg.chat.id);
      } else {
        // Check if user is in a active chat input state
        const chatState = userChatState.get(msg.chat.id);
        if (chatState && chatState.botId) {
          const botInst = botInstancesMap.get(chatState.botId);
          if (botInst && botInst.connected) {
            botInst.safeChat(text);
            tgBot.sendMessage(msg.chat.id, `✉️ *[${botInst.name}]* chatiga yuborildi: \`${text}\``, {
              parse_mode: 'Markdown'
            });
            // Clean up state and return to dashboard
            userChatState.delete(msg.chat.id);
            sendBotDetailView(msg.chat.id, botInst, chatState.messageId);
          } else {
            tgBot.sendMessage(msg.chat.id, '❌ Bot ulanmagan yoki o\'chirilgan. Xabar yuborilmadi.');
            userChatState.delete(msg.chat.id);
          }
        }
      }
    });
  });

  // /bots - Show list of bots
  tgBot.onText(/\/bots/, msg => {
    guard(msg, () => {
      sendBotsDashboard(msg.chat.id);
    });
  });

  // /profiles
  tgBot.onText(/\/profiles/, msg => {
    guard(msg, () => {
      sendProfilesList(msg.chat.id);
    });
  });

  // /newprofile
  tgBot.onText(/\/newprofile/, msg => {
    guard(msg, () => {
      startNewProfileWizard(msg.chat.id);
    });
  });

  // /run <id>
  tgBot.onText(/\/run (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      botInst.start();
      tgBot.sendMessage(msg.chat.id, `🚀 *[${botInst.name}]* ishga tushirilmoqda...`, { parse_mode: 'Markdown' });
    });
  });

  // /stop <id>
  tgBot.onText(/\/stop (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      botInst.stop();
      tgBot.sendMessage(msg.chat.id, `🛑 *[${botInst.name}]* to'xtatildi.`, { parse_mode: 'Markdown' });
    });
  });

  // /restart <id>
  tgBot.onText(/\/restart (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      botInst.stop();
      setTimeout(() => {
        botInst.start();
        tgBot.sendMessage(msg.chat.id, `🔄 *[${botInst.name}]* qayta ishga tushirildi.`, { parse_mode: 'Markdown' });
      }, 1000);
    });
  });

  // /status <id>
  tgBot.onText(/\/status (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      sendStatusMessage(msg.chat.id, botInst);
    });
  });

  // /inventory <id>
  tgBot.onText(/\/inventory (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      if (!botInst.connected) {
        tgBot.sendMessage(msg.chat.id, `❌ *[${botInst.name}]* ulanmagan.`);
        return;
      }
      sendInventory(msg.chat.id, botInst);
    });
  });

  // /chat <id> <message>
  tgBot.onText(/\/chat ([^\s]+) (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const text = match[2].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      if (!botInst.connected) {
        tgBot.sendMessage(msg.chat.id, `❌ *[${botInst.name}]* ulanmagan.`);
        return;
      }
      botInst.safeChat(text);
      tgBot.sendMessage(msg.chat.id, `✉️ Yuborildi [${botInst.name}]: ${text}`);
    });
  });

  // /runall
  tgBot.onText(/\/runall/, msg => {
    guard(msg, () => {
      runAllBots(msg.chat.id);
    });
  });

  // /stopall
  tgBot.onText(/\/stopall/, msg => {
    guard(msg, () => {
      stopAllBots(msg.chat.id);
    });
  });

  // /deleteprofile <id>
  tgBot.onText(/\/deleteprofile (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const res = deleteBotProfile(id);
      if (res) {
        tgBot.sendMessage(msg.chat.id, `✅ Profil \`${id}\` muvaffaqiyatli o'chirildi.`, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi yoki o'chirishda xatolik: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  // /setchest <id> <x> <y> <z>
  tgBot.onText(/\/setchest ([^\s]+) (-?\d+) (-?\d+) (-?\d+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const x = parseInt(match[2]);
      const y = parseInt(match[3]);
      const z = parseInt(match[4]);
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      const pos = new Vec3(x, y, z);
      botInst.saveChestPos(pos);
      tgBot.sendMessage(msg.chat.id, `✅ Sandiq koordinatasi o'rnatildi [${botInst.name}]: ${x}, ${y}, ${z}`);
    });
  });

  // /farmstats <id>
  tgBot.onText(/\/farmstats (.+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const botInst = botInstancesMap.get(id);
      if (!botInst) {
        tgBot.sendMessage(msg.chat.id, `❌ Bot topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
        return;
      }
      const stats = botInst.stats;
      const text = [
        `🌾 *[${botInst.name}] Farm Statistikasi:*`,
        `• Yig'ilgan cocoa beans: \`${stats.harvested} ta\``,
        `• Ekilgan cocoa beans: \`${stats.planted} ta\``,
        `• Sandiqdan olingan: \`${stats.withdrawn} ta\``,
        `• Sandiqqa qo'yilgan: \`${stats.deposited} ta\``
      ].join('\n');
      tgBot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });
  });

  // Edit commands: /setserver, /setversion, /setusername, /setpassword, /setrole
  tgBot.onText(/\/setserver ([^\s]+) ([^\s]+)(?:\s+(\d+))?/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const host = match[2].trim();
      const port = match[3] ? parseInt(match[3]) : 25565;
      
      const success = profiles.updateProfile(id, { host, port });
      if (success) {
        reloadBotInstance(id);
        tgBot.sendMessage(msg.chat.id, `✅ Server o'zgartirildi: \`${host}:${port}\``, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  tgBot.onText(/\/setversion ([^\s]+) ([^\s]+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const version = match[2].trim();
      
      const success = profiles.updateProfile(id, { version });
      if (success) {
        reloadBotInstance(id);
        tgBot.sendMessage(msg.chat.id, `✅ Versiya o'zgartirildi: \`${version}\``, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  tgBot.onText(/\/setusername ([^\s]+) ([^\s]+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const username = match[2].trim();
      
      const success = profiles.updateProfile(id, { username });
      if (success) {
        reloadBotInstance(id);
        tgBot.sendMessage(msg.chat.id, `✅ O'yinchi niki o'zgartirildi: \`${username}\``, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  tgBot.onText(/\/setpassword ([^\s]+) ([^\s]+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const password = match[2].trim();
      
      const success = profiles.updateProfile(id, { password });
      if (success) {
        reloadBotInstance(id);
        tgBot.sendMessage(msg.chat.id, `✅ Parol yangilandi.`, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  tgBot.onText(/\/setrole ([^\s]+) ([^\s]+)/, (msg, match) => {
    guard(msg, () => {
      const id = match[1].trim();
      const role = match[2].trim().toLowerCase();
      if (!['panel', 'harvester', 'planter', 'farmer'].includes(role)) {
        tgBot.sendMessage(msg.chat.id, `❌ Noto'g'ri rol. Rol ro'yxati: harvester, planter, farmer, panel`);
        return;
      }
      
      const success = profiles.updateProfile(id, { role });
      if (success) {
        reloadBotInstance(id);
        tgBot.sendMessage(msg.chat.id, `✅ Rol o'zgartirildi: \`${role.toUpperCase()}\``, { parse_mode: 'Markdown' });
      } else {
        tgBot.sendMessage(msg.chat.id, `❌ Profil topilmadi: \`${id}\``, { parse_mode: 'Markdown' });
      }
    });
  });

  // Wizard listener
  tgBot.on('message', msg => {
    if (!msg.text) return;
    if (msg.text.startsWith('/')) {
      if (msg.text === '/cancel' && creationStates.has(msg.chat.id)) {
        creationStates.delete(msg.chat.id);
        tgBot.sendMessage(msg.chat.id, '❌ Bot yaratish bekor qilindi.');
      }
      return;
    }

    const state = creationStates.get(msg.chat.id);
    if (!state) return;

    guard(msg, () => {
      const text = msg.text.trim();
      
      switch (state.step) {
        case 'id': {
          const cleanId = text.replace(/[^a-zA-Z0-9_]/g, '');
          if (!cleanId) {
            tgBot.sendMessage(msg.chat.id, '❌ ID faqat harf va sonlardan iborat bo\'lishi kerak. Qayta kiriting:');
            return;
          }
          const allProfiles = profiles.loadProfiles();
          if (allProfiles.some(p => p.id === cleanId)) {
            tgBot.sendMessage(msg.chat.id, '❌ Bu ID ga ega bot allaqachon mavjud. Boshqa ID kiriting:');
            return;
          }
          state.data.id = cleanId;
          state.step = 'name';
          tgBot.sendMessage(msg.chat.id, '👤 Bot uchun to\'liq nom kiriting (masalan: `Yig\'uvchi Bot`):');
          break;
        }
        case 'name': {
          state.data.name = text;
          state.step = 'role';
          tgBot.sendMessage(msg.chat.id, '⚙️ Bot rolini tanlang (harvester, farmer, panel):', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🌾 Harvester (Ekuvchi & Yig\'uvchi)', callback_data: 'role_select:harvester' }
                ],
                [
                  { text: '💰 Farmer (Seller)', callback_data: 'role_select:farmer' },
                  { text: '💻 Panel (Dashboard)', callback_data: 'role_select:panel' }
                ]
              ]
            }
          });
          break;
        }
        case 'host': {
          state.data.host = text;
          state.step = 'port';
          tgBot.sendMessage(msg.chat.id, '🔌 Portni kiriting (default: `25565`):');
          break;
        }
        case 'port': {
          state.data.port = parseInt(text) || 25565;
          state.step = 'username';
          tgBot.sendMessage(msg.chat.id, '👤 O\'yin niki (Username) kiriting:');
          break;
        }
        case 'username': {
          state.data.username = text;
          state.step = 'password';
          tgBot.sendMessage(msg.chat.id, "🔑 Login uchun parolni kiriting (agar yo'q bo'lsa `/` yozing):");
          break;
        }
        case 'password': {
          state.data.password = text === '/' ? '' : text;
          state.step = 'version';
          tgBot.sendMessage(msg.chat.id, '🎮 Minecraft versiyasini kiriting (masalan: `1.21.1`):');
          break;
        }
        case 'version': {
          state.data.version = text;
          
          const data = state.data;
          const newProf = {
            id: data.id,
            name: data.name,
            role: data.role,
            host: data.host,
            port: data.port,
            username: data.username,
            password: data.password,
            version: data.version,
            auth: 'offline',
            autoLogin: true,
            autoReconnect: true,
            reconnectDelayMs: 5000,
            webPort: getNextAvailablePort(),
            enabled: true
          };

          profiles.addProfile(newProf);
          
          if (registerBotInstanceFn) {
            const newInst = new BotInstance(newProf);
            registerBotInstanceFn(newProf.id, newInst);
            bindEvents(newInst);
          }

          creationStates.delete(msg.chat.id);
          
          const details = [
            '🎉 *Bot profili muvaffaqiyatli yaratildi!*',
            `• Nom: ${newProf.name}`,
            `• ID: \`${newProf.id}\``,
            `• Rol: \`${newProf.role.toUpperCase()}\``,
            `• Server: \`${newProf.host}:${newProf.port}\``,
            `• Web port: \`${newProf.webPort}\``,
            '',
            'Botni ishga tushirish uchun: `/run ' + newProf.id + '`'
          ].join('\n');

          tgBot.sendMessage(msg.chat.id, details, { parse_mode: 'Markdown' });
          break;
        }
      }
    });
  });

  // Callback query handler
  tgBot.on('callback_query', query => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Role select during wizard
    if (data.startsWith('role_select:')) {
      const role = data.split(':')[1];
      const state = creationStates.get(chatId);
      if (state && state.step === 'role') {
        state.data.role = role;
        state.step = 'host';
        tgBot.answerCallbackQuery(query.id, { text: `Tanlangan rol: ${role.toUpperCase()}` });
        tgBot.sendMessage(chatId, '🌐 Minecraft Server IP-manzilini kiriting (masalan: `articraft.uz`):');
      } else {
        tgBot.answerCallbackQuery(query.id, { text: 'Xato: Yaratish muddati o\'tgan.' });
      }
      return;
    }

    const [action, id] = data.split(':');
    const botInst = botInstancesMap.get(id);

    if (action === 'menu') {
      tgBot.answerCallbackQuery(query.id);
      sendBotsDashboardEdit(chatId, messageId);
      return;
    }

    if (!botInst) {
      tgBot.answerCallbackQuery(query.id, { text: 'Xatolik: Bot topilmadi' });
      return;
    }

    // Dashboard Actions
    switch (action) {
      case 'view':
        tgBot.answerCallbackQuery(query.id);
        sendBotDetailView(chatId, botInst, messageId);
        break;
      case 'start':
        botInst.start();
        tgBot.answerCallbackQuery(query.id, { text: 'Bot ishga tushmoqda...' });
        // Refresh view with small delay
        setTimeout(() => sendBotDetailView(chatId, botInst, messageId), 1500);
        break;
      case 'stop':
        botInst.stop();
        tgBot.answerCallbackQuery(query.id, { text: 'Bot to\'xtatildi.' });
        setTimeout(() => sendBotDetailView(chatId, botInst, messageId), 1000);
        break;
      case 'restart':
        botInst.stop();
        tgBot.answerCallbackQuery(query.id, { text: 'Qayta ulanmoqda...' });
        setTimeout(() => {
          botInst.start();
          setTimeout(() => sendBotDetailView(chatId, botInst, messageId), 1500);
        }, 1000);
        break;
      case 'status':
        tgBot.answerCallbackQuery(query.id);
        sendBotDetailView(chatId, botInst, messageId);
        break;
      case 'inv':
        tgBot.answerCallbackQuery(query.id);
        sendBotInventoryView(chatId, botInst, messageId);
        break;
      case 'logs':
        tgBot.answerCallbackQuery(query.id);
        sendBotLogsView(chatId, botInst, messageId);
        break;
      case 'chat_input':
        tgBot.answerCallbackQuery(query.id, { text: 'Xabar yozing...' });
        userChatState.set(chatId, { botId: botInst.id, messageId });
        tgBot.sendMessage(chatId, `✉️ *[${botInst.name}]* uchun chat xabarini yozing:`, {
          parse_mode: 'Markdown',
          reply_markup: { force_reply: true }
        });
        break;
      default:
        tgBot.answerCallbackQuery(query.id, { text: 'Noma\'lum amal' });
    }
  });
}

// Render dynamic main bots list (Dashboard)
function sendBotsDashboard(chatId) {
  const allProfiles = profiles.loadProfiles();
  if (allProfiles.length === 0) {
    tgBot.sendMessage(chatId, 'ℹ️ Hozircha bot profillari mavjud emas. /newprofile bosing.');
    return;
  }

  const { text, keyboard } = getDashboardData(allProfiles);
  tgBot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
}

function sendBotsDashboardEdit(chatId, messageId) {
  const allProfiles = profiles.loadProfiles();
  const { text, keyboard } = getDashboardData(allProfiles);
  tgBot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  }).catch(() => {});
}

function getDashboardData(allProfiles) {
  let text = '🎮 *Minecraft Bot Dashboard*\n\nBoshqarmoqchi bo\'lgan botni tanlang:\n';
  const keyboard = [];

  for (const prof of allProfiles) {
    const botInst = botInstancesMap.get(prof.id);
    const emoji = botInst && botInst.connected ? '🟢' : (botInst && !botInst.stopped ? '🟡' : '🔴');
    text += `${emoji} *${prof.name}* (\`${prof.role.toUpperCase()}\`)\n`;
    
    keyboard.push([
      { text: `${emoji} ${prof.name} (${prof.role.toUpperCase()})`, callback_data: `view:${prof.id}` }
    ]);
  }
  
  return { text, keyboard };
}

// Render single bot detailed dashboard view
function sendBotDetailView(chatId, botInst, messageId) {
  const status = botInst.getStatus();
  const stateEmoji = botInst.connected ? '🟢' : (botInst.stopped ? '🔴' : '🟡');
  
  const lines = [
    `🤖 *Bot:* *${botInst.name}* (\`${botInst.id}\`)`,
    `⚙️ *Rol:* \`${botInst.role.toUpperCase()}\``,
    `🌐 *Server:* \`${botInst.profile.host}:${botInst.profile.port}\``,
    `👤 *Username:* \`${botInst.profile.username}\``,
    `📡 *Ulanish:* ${stateEmoji} *${getBotStatusEmoji(botInst)}*`
  ];

  if (status.connected) {
    lines.push(
      '',
      `❤️ *HP:* \`${status.health?.toFixed(1) ?? '?'} / 20\` | 🍖 *Food:* \`${status.food ?? '?'} / 20\``,
      `📍 *Pos:* \`${status.position ?? 'noma\'lum'}\``,
      `🎒 *Inventar:* \`${status.inventoryCount ?? 0} ta\` buyum`
    );

    if (['harvester', 'planter', 'farmer'].includes(botInst.role)) {
      lines.push(
        '',
        `🌾 *Farm Statistikasi:*`,
        `  • Yig'ilgan cocoa: \`${status.stats.harvested} ta\``,
        `  • Ekilgan cocoa: \`${status.stats.planted} ta\``,
        `  • Sandiqdan olingan: \`${status.stats.withdrawn} ta\``,
        `  • Sandiqqa qo'yilgan: \`${status.stats.deposited} ta\``
      );
    }
  } else if (status.lastKickReason) {
    lines.push('', `⚠️ *Kicked:* \`${status.lastKickReason}\``);
  }

  const keyboard = [];
  
  // Power controls
  if (botInst.connected) {
    keyboard.push([
      { text: '🛑 O\'chirish', callback_data: `stop:${botInst.id}` },
      { text: '🔄 Qayta ulanish', callback_data: `restart:${botInst.id}` }
    ]);
    keyboard.push([
      { text: '🎒 Inventar', callback_data: `inv:${botInst.id}` },
      { text: '📄 Oxirgi Loglar', callback_data: `logs:${botInst.id}` }
    ]);
    keyboard.push([
      { text: '💬 Chat yozish', callback_data: `chat_input:${botInst.id}` },
      { text: '🔄 Yangilash', callback_data: `view:${botInst.id}` }
    ]);
  } else {
    keyboard.push([
      { text: '▶️ Ishga tushirish', callback_data: `start:${botInst.id}` },
      { text: '🔄 Yangilash', callback_data: `view:${botInst.id}` }
    ]);
  }

  keyboard.push([
    { text: '🔙 Bosh menyu', callback_data: 'menu:' }
  ]);

  tgBot.editMessageText(lines.join('\n'), {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  }).catch(() => {});
}

// Render dynamic inventory view
function sendBotInventoryView(chatId, botInst, messageId) {
  const items = botInst.latestInventory.filter(s => s.item);
  let text = `🎒 *[${botInst.name}] Inventari:*\n\n`;

  if (items.length === 0) {
    text += '_Inventar bo\'sh._';
  } else {
    for (const slot of items) {
      const item = slot.item;
      const emoji = getItemEmoji(item.name);
      text += `${emoji} \`${item.displayName || item.name}\` ×${item.count} _[${slot.label}]_\n`;
    }
  }

  const keyboard = [
    [
      { text: '🔄 Yangilash', callback_data: `inv:${botInst.id}` },
      { text: '🔙 Orqaga', callback_data: `view:${botInst.id}` }
    ]
  ];

  tgBot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  }).catch(() => {});
}

// Render dynamic logs view
function sendBotLogsView(chatId, botInst, messageId) {
  let text = `📄 *[${botInst.name}] Oxirgi Loglar (Maks: 15 ta):*\n\n`;
  
  if (botInst.logs.length === 0) {
    text += '_Loglar mavjud emas._';
  } else {
    text += '```\n' + botInst.logs.slice(-15).join('\n') + '\n```';
  }

  const keyboard = [
    [
      { text: '🔄 Yangilash', callback_data: `logs:${botInst.id}` },
      { text: '🔙 Orqaga', callback_data: `view:${botInst.id}` }
    ]
  ];

  tgBot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  }).catch(() => {});
}

function sendProfilesList(chatId) {
  const allProfiles = profiles.loadProfiles();
  if (allProfiles.length === 0) {
    tgBot.sendMessage(chatId, 'ℹ️ Profillar mavjud emas.');
    return;
  }
  const lines = ['👤 *Bot Profillari:*', ''];
  for (const p of allProfiles) {
    lines.push(`• *ID:* \`${p.id}\` | *Nom:* ${p.name} | *Rol:* \`${p.role.toUpperCase()}\` | *IP:* \`${p.host}:${p.port}\``);
  }
  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

function sendGeneralStats(chatId) {
  const allProfiles = profiles.loadProfiles();
  const lines = ['🌾 *Dehqonchilik Umumiy Statistikasi:*', ''];
  
  let totalHarvested = 0;
  let totalPlanted = 0;
  
  for (const prof of allProfiles) {
    const botInst = botInstancesMap.get(prof.id);
    if (botInst && ['harvester', 'planter', 'farmer'].includes(prof.role)) {
      totalHarvested += botInst.stats.harvested;
      totalPlanted += botInst.stats.planted;
      lines.push(`• *${botInst.name}:* Yig'ildi: \`${botInst.stats.harvested}\` | Ekildi: \`${botInst.stats.planted}\``);
    }
  }

  lines.push('', `📊 *Jami:*`);
  lines.push(`• Umumiy hosil yig'ilgan: \`${totalHarvested} ta\``);
  lines.push(`• Umumiy urug' ekilgan: \`${totalPlanted} ta\``);

  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

function startNewProfileWizard(chatId) {
  creationStates.set(chatId, { step: 'id', data: {} });
  tgBot.sendMessage(chatId, [
    '✨ *Yangi bot yaratish boshlandi!*',
    'Yaratishni bekor qilish uchun istalgan payt /cancel deb yozing.',
    '',
    '🤖 Yangi bot uchun *ID* kiriting (masalan: `my_planter`):'
  ].join('\n'), { parse_mode: 'Markdown' });
}

function runAllBots(chatId) {
  let count = 0;
  for (const botInst of botInstancesMap.values()) {
    if (botInst.stopped) {
      botInst.start();
      count++;
    }
  }
  tgBot.sendMessage(chatId, `🚀 ${count} ta bot ishga tushirilmoqda...`);
}

function stopAllBots(chatId) {
  let count = 0;
  for (const botInst of botInstancesMap.values()) {
    if (!botInst.stopped) {
      botInst.stop();
      count++;
    }
  }
  tgBot.sendMessage(chatId, `🛑 ${count} ta bot ulanishdan uzildi.`);
}

function sendStatusMessage(chatId, botInst) {
  const status = botInst.getStatus();
  const lines = [];

  if (status.connected) {
    lines.push(`✅ *[${botInst.name}] Holati:*`);
    lines.push(`• *HP:* \`${status.health?.toFixed(1) ?? '?'} / 20\``);
    lines.push(`• *🍖 Ovqat:* \`${status.food ?? '?'} / 20\``);
    lines.push(`• *📍 Pozitsiya:* \`${status.position ?? 'noma\'lum'}\``);
  } else {
    lines.push(`❌ *[${botInst.name}] Ulanmagan*`);
  }

  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

function sendInventory(chatId, botInst) {
  const items = botInst.latestInventory.filter(s => s.item);
  const lines = [`🎒 *[${botInst.name}] Inventari:*`, ''];
  for (const slot of items) {
    const item = slot.item;
    const emoji = getItemEmoji(item.name);
    lines.push(`• ${emoji} \`${item.displayName || item.name}\` ×${item.count}`);
  }
  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

function reloadBotInstance(id) {
  const botInst = botInstancesMap.get(id);
  const wasRunning = botInst && !botInst.stopped;

  if (botInst) {
    botInst.stop();
  }

  const allProfiles = profiles.loadProfiles();
  const prof = allProfiles.find(p => p.id === id);
  if (prof) {
    const newInst = new BotInstance(prof);
    if (unregisterBotInstanceFn) {
      unregisterBotInstanceFn(id);
    }
    if (registerBotInstanceFn) {
      registerBotInstanceFn(id, newInst);
      bindEvents(newInst);
    }
    if (wasRunning) {
      newInst.start();
    }
  }
}

function deleteBotProfile(id) {
  const botInst = botInstancesMap.get(id);
  if (botInst) {
    botInst.stop();
  }

  const res = profiles.deleteProfile(id);
  if (res) {
    if (unregisterBotInstanceFn) {
      unregisterBotInstanceFn(id);
    }
    return true;
  }
  return false;
}

function getNextAvailablePort() {
  const allProfiles = profiles.loadProfiles();
  const ports = allProfiles.map(p => p.webPort).filter(Boolean);
  if (ports.length === 0) return 3000;
  return Math.max(...ports) + 1;
}

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = {
  initTelegramPanel,
  sendToAllAllowed
};
