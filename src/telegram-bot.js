/**
 * telegram-bot.js
 * Minecraft botni Telegram orqali to'liq boshqarish moduli.
 */

const TelegramBot = require('node-telegram-bot-api');

// ─── Konfiguratsiya (initTelegramBot ichida yuklanadi) ───────────────────────

let TELEGRAM_TOKEN = '';
let ALLOWED_IDS = [];
let ENABLED = true;
let FORWARD_CHAT = true;

// ─── Holat ───────────────────────────────────────────────────────────────────

let tgBot = null;
let getBotRef = null;   // () => bot | null
let getStatus = null;   // () => statusObject
let execCommand = null; // (action, args) => void

// Sprint/sneak toggle holati
const toggleState = { sprint: false, sneak: false };

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Telegram botni ishga tushirish.
 * @param {object} opts
 * @param {() => object|null} opts.getBot       - Mineflayer bot ref-ini qaytaradi
 * @param {() => object}      opts.getStatusFn  - Status object qaytaradi
 * @param {Function}          opts.execFn       - Amal bajarish uchun callback
 */
function initTelegramBot({ getBot, getStatusFn, execFn }) {
  // .env yuklanganidan keyin o'qiladi
  TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  ALLOWED_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(Number);
  ENABLED = process.env.TELEGRAM_ENABLED !== 'false';
  FORWARD_CHAT = process.env.TELEGRAM_FORWARD_CHAT !== 'false';

  if (!ENABLED || !TELEGRAM_TOKEN) {
    console.log('[Telegram] O\'chirilgan yoki token yo\'q — o\'tkazib yuborildi.');
    return null;
  }

  if (ALLOWED_IDS.length === 0) {
    console.log('[Telegram] TELEGRAM_CHAT_IDS bo\'sh — hech kim boshqara olmaydi!');
  }

  getBotRef = getBot;
  getStatus = getStatusFn;
  execCommand = execFn;

  tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

  console.log('[Telegram] Bot ishga tushdi ✅');
  tgBot.on('polling_error', err => {
    console.error('[Telegram] Polling xato:', err.message || err);
  });

  registerHandlers();
  return tgBot;
}

// ─── Xavfsizlik ──────────────────────────────────────────────────────────────

function isAllowed(chatId) {
  if (ALLOWED_IDS.length === 0) return true; // Cheklov yo'q bo'lsa hammaga ruxsat
  return ALLOWED_IDS.includes(Number(chatId));
}

function guard(msg, fn) {
  if (!isAllowed(msg.chat.id)) {
    tgBot.sendMessage(msg.chat.id, '⛔ Ruxsat yo\'q.');
    return;
  }
  try {
    fn();
  } catch (err) {
    tgBot.sendMessage(msg.chat.id, `❌ Xato: ${err.message}`);
  }
}

// ─── Buyruq ro'yxati ─────────────────────────────────────────────────────────

function registerHandlers() {
  // /start
  tgBot.onText(/\/start/, msg => {
    guard(msg, () => {
      const text = [
        '🎮 *Minecraft Bot — Telegram Panel*',
        '',
        '📡 *Holat:*',
        '`/status` — Bot holati',
        '`/scoreboard` — Scoreboard',
        '',
        '💬 *Chat:*',
        '`/chat <xabar>` — Chatga yozish',
        '`/say <xabar>` — Chatga oddiy xabar',
        '',
        '🏃 *Harakat:*',
        '`/come` — Bot yoningizga kelsin',
        '`/follow` — Bot sizni kuzatsin',
        '`/stop` — To\'xtatish',
        '`/jump` — Sakrash',
        '`/forward` `/ back` — Oldinga/orqaga (1s)',
        '`/left` `/right` — Chapga/o\'ngga (1s)',
        '`/sprint` — Sprint on/off',
        '`/sneak` — Sneak on/off',
        '',
        '🎒 *Inventar:*',
        '`/inventory` — Inventarni ko\'rsatish',
        '',
        '⚙️ *Boshqarish:*',
        '`/reconnect` — Qayta ulash',
        '`/stop_all` — Barcha harakatni to\'xtatish',
        '',
        '❓ `/help` — Bu xabar',
      ].join('\n');
      tgBot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    });
  });

  // /help
  tgBot.onText(/\/help/, msg => {
    guard(msg, () => {
      tgBot.sendMessage(msg.chat.id, '/start ni bosing — to\'liq buyruqlar ro\'yxati uchun.');
    });
  });

  // /status
  tgBot.onText(/\/status/, msg => {
    guard(msg, () => {
      const status = getStatus();
      const lines = [];

      if (status.connected) {
        lines.push(`✅ *Ulangan:* \`${status.host}:${status.port}\``);
        lines.push(`👤 *Bot:* \`${status.username}\``);
        lines.push(`❤️ *HP:* \`${status.health?.toFixed(1) ?? '?'} / 20\``);
        lines.push(`🍖 *Ovqat:* \`${status.food ?? '?'} / 20\``);
        lines.push(`📍 *Pozitsiya:* \`${status.position ?? 'noma\'lum'}\``);
        lines.push(`🎒 *Inventar:* \`${status.inventoryCount ?? 0} ta\` buyum`);
        if (status.mcVersion) {
          lines.push(`🎮 *Versiya:* \`${status.mcVersion}\``);
        }
      } else {
        lines.push('❌ *Ulanmagan*');
        if (status.lastKickReason) {
          lines.push(`⚠️ *Sabab:* ${status.lastKickReason}`);
        }
        if (status.stoppedByBotCheck) {
          lines.push('🤖 Bot tekshiruvi aniqlandi — qayta ulanish to\'xtatildi.');
        }
      }

      tgBot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    });
  });

  // /scoreboard
  tgBot.onText(/\/scoreboard/, msg => {
    guard(msg, () => {
      const status = getStatus();
      const sb = status.scoreboard;
      if (!sb) {
        tgBot.sendMessage(msg.chat.id, 'ℹ️ Scoreboard topilmadi.');
        return;
      }
      const lines = [`📊 *${escapeMarkdown(sb.title)}*`, ''];
      for (const item of (sb.items || [])) {
        lines.push(`• ${escapeMarkdown(item.name)} — \`${item.value}\``);
      }
      tgBot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
    });
  });

  // /chat <xabar>
  tgBot.onText(/\/chat (.+)/, (msg, match) => {
    guard(msg, () => {
      const text = match[1].trim();
      if (!text) {
        tgBot.sendMessage(msg.chat.id, '⚠️ Xabar yozing: /chat salom dunyo');
        return;
      }
      execCommand('chat', [text]);
      tgBot.sendMessage(msg.chat.id, `✉️ Yuborildi: ${text}`);
    });
  });

  // /say <xabar>
  tgBot.onText(/\/say (.+)/, (msg, match) => {
    guard(msg, () => {
      const text = match[1].trim();
      execCommand('chat', [text]);
      tgBot.sendMessage(msg.chat.id, `💬 Chat: ${text}`);
    });
  });

  // /come
  tgBot.onText(/\/come/, msg => {
    guard(msg, () => {
      execCommand('come', []);
      tgBot.sendMessage(msg.chat.id, '🚶 Yoningizga kelyapman...');
    });
  });

  // /follow
  tgBot.onText(/\/follow/, msg => {
    guard(msg, () => {
      execCommand('follow', []);
      tgBot.sendMessage(msg.chat.id, '🔄 Kuzatishni boshladim...');
    });
  });

  // /stop
  tgBot.onText(/\/stop$/, msg => {
    guard(msg, () => {
      execCommand('stop', []);
      tgBot.sendMessage(msg.chat.id, '🛑 To\'xtatdim.');
    });
  });

  // /stop_all
  tgBot.onText(/\/stop_all/, msg => {
    guard(msg, () => {
      execCommand('stop_all', []);
      tgBot.sendMessage(msg.chat.id, '⏹ Barcha harakatlar to\'xtatildi.');
    });
  });

  // /jump
  tgBot.onText(/\/jump/, msg => {
    guard(msg, () => {
      execCommand('jump', []);
      tgBot.sendMessage(msg.chat.id, '⬆️ Sakradim!');
    });
  });

  // /forward
  tgBot.onText(/\/forward/, msg => {
    guard(msg, () => {
      execCommand('move', ['forward', 1000]);
      tgBot.sendMessage(msg.chat.id, '⬆️ Oldinga 1 soniya...');
    });
  });

  // /back
  tgBot.onText(/\/back/, msg => {
    guard(msg, () => {
      execCommand('move', ['back', 1000]);
      tgBot.sendMessage(msg.chat.id, '⬇️ Orqaga 1 soniya...');
    });
  });

  // /left
  tgBot.onText(/\/left/, msg => {
    guard(msg, () => {
      execCommand('move', ['left', 1000]);
      tgBot.sendMessage(msg.chat.id, '⬅️ Chapga 1 soniya...');
    });
  });

  // /right
  tgBot.onText(/\/right/, msg => {
    guard(msg, () => {
      execCommand('move', ['right', 1000]);
      tgBot.sendMessage(msg.chat.id, '➡️ O\'ngga 1 soniya...');
    });
  });

  // /sprint
  tgBot.onText(/\/sprint/, msg => {
    guard(msg, () => {
      toggleState.sprint = !toggleState.sprint;
      execCommand('control', ['sprint', toggleState.sprint]);
      const icon = toggleState.sprint ? '🏃 Yoqildi' : '🚶 O\'chirildi';
      tgBot.sendMessage(msg.chat.id, `${icon} — Sprint`);
    });
  });

  // /sneak
  tgBot.onText(/\/sneak/, msg => {
    guard(msg, () => {
      toggleState.sneak = !toggleState.sneak;
      execCommand('control', ['sneak', toggleState.sneak]);
      const icon = toggleState.sneak ? '🐾 Yoqildi' : '🚶 O\'chirildi';
      tgBot.sendMessage(msg.chat.id, `${icon} — Sneak`);
    });
  });

  // /inventory
  tgBot.onText(/\/inventory/, msg => {
    guard(msg, () => {
      execCommand('inventory', [msg.chat.id]);
    });
  });

  // /reconnect
  tgBot.onText(/\/reconnect/, msg => {
    guard(msg, () => {
      execCommand('reconnect', []);
      tgBot.sendMessage(msg.chat.id, '🔄 Qayta ulanish boshlandi...');
    });
  });
}

// ─── Broadcast (Bot → Telegram) ──────────────────────────────────────────────

/**
 * Minecraft chat xabarini Telegram-ga yuborish.
 */
function forwardChatToTelegram(entry) {
  if (!tgBot || !FORWARD_CHAT) return;
  if (!entry || !entry.text) return;

  // Faqat server va o'yinchi xabarlarini forward qilish (panel/system emas yoki login/register)
  if (entry.source === 'panel') return;
  const text = String(entry.text);

  // Login/register xabarlarini filtr qilish (parol ko'rinmasin)
  if (text.includes('/login') || text.includes('/register')) return;

  let prefix = '';
  if (entry.source === 'system') prefix = '⚙️ ';
  else if (entry.source === 'server') prefix = '💬 ';

  const formatted = `${prefix}${escapeMarkdown(text)}`;

  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, formatted, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

/**
 * Bot serverga ulanganda/uzilganda bildirishnoma.
 */
function notifyStatus(connected, extra = '') {
  if (!tgBot) return;

  const icon = connected ? '✅' : '❌';
  const state = connected ? 'Serverga ulandi' : 'Uzildi';
  let msg = `${icon} *Bot ${state}*`;
  if (extra) msg += `\n${escapeMarkdown(extra)}`;

  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

/**
 * HP past bo'lganda ogohlantirish.
 */
function notifyLowHealth(health) {
  if (!tgBot) return;

  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, `⚠️ *Bot HP past!* ❤️ \`${health.toFixed(1)} / 20\``, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

/**
 * Inventar holatini Telegram-ga yuborish.
 */
function sendInventoryToChat(chatId, inventorySlots) {
  if (!tgBot) return;

  const items = (inventorySlots || []).filter(s => s.item);
  if (items.length === 0) {
    tgBot.sendMessage(chatId, '🎒 Inventar bo\'sh.').catch(() => {});
    return;
  }

  const lines = ['🎒 *Inventar:*', ''];
  for (const slot of items) {
    const item = slot.item;
    lines.push(`• \`${item.displayName || item.name}\` ×${item.count} [${slot.label}]`);
  }

  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
}

// ─── Yordamchi ───────────────────────────────────────────────────────────────

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function getTgBot() {
  return tgBot;
}

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  initTelegramBot,
  forwardChatToTelegram,
  notifyStatus,
  notifyLowHealth,
  sendInventoryToChat,
  getTgBot,
  isEnabled: () => ENABLED && Boolean(TELEGRAM_TOKEN),
};
