/**
 * telegram-bot.js
 * Minecraft botni Telegram orqali to'liq boshqarish moduli.
 */

const TelegramBot = require('node-telegram-bot-api');

// ─── Holat o'zgaruvchilari ───────────────────────────────────────────────────

let TELEGRAM_TOKEN = '';
let ALLOWED_IDS = [];
let ENABLED = true;
let FORWARD_CHAT = true;

let tgBot = null;
let getBotRef = null;    // () => mineflayer bot | null
let getStatus = null;    // () => statusObject
let execCommand = null;  // (action, args) => void

// Sprint/sneak toggle holati
const toggleState = { sprint: false, sneak: false };

// ─── Init ────────────────────────────────────────────────────────────────────

/**
 * Telegram botni ishga tushirish.
 * @param {object} opts
 * @param {() => object|null} opts.getBot       - Mineflayer bot ref'ini qaytaradi
 * @param {() => object}      opts.getStatusFn  - Status ob'ektini qaytaradi
 * @param {Function}          opts.execFn       - Amal bajarish uchun callback
 * @returns {TelegramBot|null}
 */
function initTelegramBot({ getBot, getStatusFn, execFn }) {
  TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  ALLOWED_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .map(Number);
  ENABLED = process.env.TELEGRAM_ENABLED !== 'false';
  FORWARD_CHAT = process.env.TELEGRAM_FORWARD_CHAT !== 'false';

  if (!ENABLED || !TELEGRAM_TOKEN) {
    console.log("[Telegram] O'chirilgan yoki token yo'q — o'tkazib yuborildi.");
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
  if (ALLOWED_IDS.length === 0) return true;
  return ALLOWED_IDS.includes(Number(chatId));
}

/**
 * Xavfsizlik tekshiruvi bilan buyruq bajaradi.
 * Ruxsat yo'q bo'lsa yoki xato chiqsa — foydalanuvchiga xabar yuboradi.
 */
function guard(msg, fn) {
  if (!isAllowed(msg.chat.id)) {
    tgBot.sendMessage(msg.chat.id, "⛔ Ruxsat yo'q.").catch(() => {});
    return;
  }
  try {
    fn();
  } catch (err) {
    tgBot.sendMessage(msg.chat.id, `❌ Xato: ${err.message}`).catch(() => {});
  }
}

/**
 * Foydalanuvchiga xabar yuboradi (Markdown formati bilan).
 */
function reply(chatId, text) {
  if (!tgBot) return;
  tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).catch(err => {
    console.error('[Telegram] Xabar yuborishda xato:', err.message);
  });
}

// ─── Buyruqlar ───────────────────────────────────────────────────────────────

function registerHandlers() {
  // /start va /help
  tgBot.onText(/\/start|\/help/, msg => {
    guard(msg, () => {
      const text = [
        '🎮 *Minecraft Bot — Telegram Panel*',
        '',
        '📡 *Holat:*',
        '`/status` — Bot holati',
        '`/stats` — Farming statistikasi',
        '',
        '💬 *Chat:*',
        '`/chat <xabar>` — Chatga yozish',
        '`/say <xabar>` — Chatga oddiy xabar',
        '',
        '🏃 *Harakat:*',
        '`/come` — Bot yoningizga kelsin',
        '`/follow` — Bot sizni kuzatsin',
        '`/stop` — To\'xtatish',
        '`/stop_all` — Barcha harakatni to\'xtatish',
        '`/jump` — Sakrash',
        '`/forward` `/back` — Oldinga/orqaga (1s)',
        '`/left` `/right` — Chapga/o\'ngga (1s)',
        '`/sprint` — Sprint on/off',
        '`/sneak` — Sneak on/off',
        '',
        '🎒 *Inventar:*',
        '`/inventory` — Inventarni ko\'rsatish',
        '',
        '⚙️ *Boshqarish:*',
        '`/reconnect` — Qayta ulash',
      ].join('\n');
      reply(msg.chat.id, text);
    });
  });

  // /status
  tgBot.onText(/\/status/, msg => {
    guard(msg, () => {
      const s = getStatus();
      const lines = [];

      if (s.connected) {
        lines.push(`✅ *Ulangan:* \`${s.host}:${s.port}\``);
        lines.push(`👤 *Bot:* \`${s.username}\``);
        lines.push(`❤️ *HP:* \`${s.health?.toFixed(1) ?? '?'} / 20\``);
        lines.push(`🍖 *Ovqat:* \`${s.food ?? '?'} / 20\``);
        lines.push(`📍 *Pozitsiya:* \`${s.position ?? "noma'lum"}\``);
        lines.push(`🎒 *Inventar:* \`${s.inventoryCount ?? 0} ta\` buyum`);
        if (s.mcVersion) lines.push(`🎮 *Versiya:* \`${s.mcVersion}\``);
      } else {
        lines.push('❌ *Ulanmagan*');
        if (s.lastKickReason) lines.push(`⚠️ *Sabab:* ${escapeMarkdown(s.lastKickReason)}`);
        if (s.stoppedByBotCheck) lines.push('🤖 Bot tekshiruvi — qayta ulanish to\'xtatildi.');
      }

      reply(msg.chat.id, lines.join('\n'));
    });
  });

  // /stats — Farming statistikasi
  tgBot.onText(/\/stats/, msg => {
    guard(msg, () => {
      const s = getStatus();
      const st = s.stats || { harvested: 0, planted: 0, sold_cycles: 0 };
      const lines = [
        '📊 *Farming Statistikasi*',
        '',
        `🌿 *Yig\'ilgan:* \`${st.harvested}\` ta cocoa`,
        `🌱 *Ekilgan:* \`${st.planted}\` ta urug'`,
        `💰 *Sotish sikllari:* \`${st.sold_cycles}\``,
      ];
      reply(msg.chat.id, lines.join('\n'));
    });
  });

  // /scoreboard
  tgBot.onText(/\/scoreboard/, msg => {
    guard(msg, () => {
      const s = getStatus();
      const sb = s.scoreboard;
      if (!sb) {
        tgBot.sendMessage(msg.chat.id, 'ℹ️ Scoreboard topilmadi.').catch(() => {});
        return;
      }
      const lines = [`📊 *${escapeMarkdown(sb.title)}*`, ''];
      for (const item of (sb.items || [])) {
        lines.push(`• ${escapeMarkdown(item.name)} — \`${item.value}\``);
      }
      reply(msg.chat.id, lines.join('\n'));
    });
  });

  // /chat <xabar>
  tgBot.onText(/\/chat (.+)/, (msg, match) => {
    guard(msg, () => {
      const text = match[1].trim();
      if (!text) {
        tgBot.sendMessage(msg.chat.id, '⚠️ Xabar yozing: /chat salom dunyo').catch(() => {});
        return;
      }
      execCommand('chat', [text]);
      tgBot.sendMessage(msg.chat.id, `✉️ Yuborildi: ${text}`).catch(() => {});
    });
  });

  // /say <xabar>
  tgBot.onText(/\/say (.+)/, (msg, match) => {
    guard(msg, () => {
      const text = match[1].trim();
      execCommand('chat', [text]);
      tgBot.sendMessage(msg.chat.id, `💬 Chat: ${text}`).catch(() => {});
    });
  });

  // /come — hozircha amalga oshirilmagan
  tgBot.onText(/\/come/, msg => {
    guard(msg, () => {
      tgBot.sendMessage(
        msg.chat.id,
        "ℹ️ `/come` buyrug'i hozircha qo'llab-quvvatlanmaydi.",
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    });
  });

  // /follow — hozircha amalga oshirilmagan
  tgBot.onText(/\/follow/, msg => {
    guard(msg, () => {
      tgBot.sendMessage(
        msg.chat.id,
        "ℹ️ `/follow` buyrug'i hozircha qo'llab-quvvatlanmaydi.",
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    });
  });

  // /stop (faqat to'xtatish — /stop_all bilan aralashmasin)
  tgBot.onText(/^\/stop$/, msg => {
    guard(msg, () => {
      execCommand('stop', []);
      tgBot.sendMessage(msg.chat.id, "🛑 To'xtatdim.").catch(() => {});
    });
  });

  // /stop_all
  tgBot.onText(/\/stop_all/, msg => {
    guard(msg, () => {
      execCommand('stop_all', []);
      tgBot.sendMessage(msg.chat.id, '⏹ Barcha harakatlar to\'xtatildi.').catch(() => {});
    });
  });

  // /jump
  tgBot.onText(/\/jump/, msg => {
    guard(msg, () => {
      execCommand('jump', []);
      tgBot.sendMessage(msg.chat.id, '⬆️ Sakradim!').catch(() => {});
    });
  });

  // /forward
  tgBot.onText(/\/forward/, msg => {
    guard(msg, () => {
      execCommand('move', ['forward', 1_000]);
      tgBot.sendMessage(msg.chat.id, '⬆️ Oldinga 1 soniya...').catch(() => {});
    });
  });

  // /back
  tgBot.onText(/\/back/, msg => {
    guard(msg, () => {
      execCommand('move', ['back', 1_000]);
      tgBot.sendMessage(msg.chat.id, '⬇️ Orqaga 1 soniya...').catch(() => {});
    });
  });

  // /left
  tgBot.onText(/\/left/, msg => {
    guard(msg, () => {
      execCommand('move', ['left', 1_000]);
      tgBot.sendMessage(msg.chat.id, '⬅️ Chapga 1 soniya...').catch(() => {});
    });
  });

  // /right
  tgBot.onText(/\/right/, msg => {
    guard(msg, () => {
      execCommand('move', ['right', 1_000]);
      tgBot.sendMessage(msg.chat.id, "➡️ O'ngga 1 soniya...").catch(() => {});
    });
  });

  // /sprint — toggle
  tgBot.onText(/\/sprint/, msg => {
    guard(msg, () => {
      toggleState.sprint = !toggleState.sprint;
      execCommand('control', ['sprint', toggleState.sprint]);
      const icon = toggleState.sprint ? '🏃 Yoqildi' : "🚶 O'chirildi";
      tgBot.sendMessage(msg.chat.id, `${icon} — Sprint`).catch(() => {});
    });
  });

  // /sneak — toggle
  tgBot.onText(/\/sneak/, msg => {
    guard(msg, () => {
      toggleState.sneak = !toggleState.sneak;
      execCommand('control', ['sneak', toggleState.sneak]);
      const icon = toggleState.sneak ? '🐾 Yoqildi' : "🚶 O'chirildi";
      tgBot.sendMessage(msg.chat.id, `${icon} — Sneak`).catch(() => {});
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
      tgBot.sendMessage(msg.chat.id, '🔄 Qayta ulanish boshlandi...').catch(() => {});
    });
  });
}

// ─── Broadcast (Bot → Telegram) ──────────────────────────────────────────────

/**
 * Minecraft chat xabarini Telegram'ga yuboradi.
 * @param {{ source: string, text: string }} entry
 */
function forwardChatToTelegram(entry) {
  if (!tgBot || !FORWARD_CHAT) return;
  if (!entry?.text) return;
  if (entry.source === 'panel') return;

  const text = String(entry.text);

  // Parol xabarlarini filtrlash
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
 * Bot serverga ulanganda/uzilganda bildirishnoma yuboradi.
 * @param {boolean} connected
 * @param {string} [extra]
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
 * HP past bo'lganda ogohlantirish yuboradi.
 * @param {number} health
 */
function notifyLowHealth(health) {
  if (!tgBot) return;
  const msg = `⚠️ *Bot HP past!* ❤️ \`${health.toFixed(1)} / 20\``;
  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

/**
 * Inventar ro'yxatini Telegram'ga yuboradi.
 * @param {number} chatId
 * @param {Array<{item: object, label: string}>} inventorySlots
 */
function sendInventoryToChat(chatId, inventorySlots) {
  if (!tgBot) return;

  const items = (inventorySlots || []).filter(s => s.item);
  if (items.length === 0) {
    tgBot.sendMessage(chatId, "🎒 Inventar bo'sh.").catch(() => {});
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

/**
 * Markdown v1 uchun maxsus belgilarni escape qiladi.
 * @param {any} text
 * @returns {string}
 */
function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
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
