/**
 * telegram-bot.js
 * Minecraft botni/botlarni Telegram orqali to'liq boshqarish moduli.
 * Single-bot va multi-bot (Central mode) ni qo'llab-quvvatlaydi.
 */

const TelegramBot = require('node-telegram-bot-api');

// ─── Holat o'zgaruvchilari ────────────────────────────────────────────────────

let TELEGRAM_TOKEN = '';
let ALLOWED_IDS = [];
let ENABLED = true;
let FORWARD_CHAT = true;

let tgBot = null;
let getBotRef = null;
let getStatus = null;
let execCommand = null;
let workerRegistry = null; // Central mode uchun

// Sprint/sneak toggle holati (single-bot)
const toggleState = { sprint: false, sneak: false };

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Telegram botni ishga tushiradi.
 * @param {object} opts
 * @param {() => object|null} opts.getBot
 * @param {() => object}      opts.getStatusFn
 * @param {Function}          opts.execFn
 * @param {object}            [opts.registry] - WorkerRegistry (central mode)
 */
function initTelegramBot({ getBot, getStatusFn, execFn, registry }) {
  TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
  ALLOWED_IDS = (process.env.TELEGRAM_CHAT_IDS || '')
    .split(',').map(id => id.trim()).filter(Boolean).map(Number);
  ENABLED = process.env.TELEGRAM_ENABLED !== 'false';
  FORWARD_CHAT = process.env.TELEGRAM_FORWARD_CHAT !== 'false';

  if (!ENABLED || !TELEGRAM_TOKEN) {
    console.log("[Telegram] O'chirilgan yoki token yo'q — o'tkazib yuborildi.");
    return null;
  }

  if (ALLOWED_IDS.length === 0) {
    console.log("[Telegram] TELEGRAM_CHAT_IDS bo'sh — hech kim boshqara olmaydi!");
  }

  getBotRef    = getBot;
  getStatus    = getStatusFn;
  execCommand  = execFn;
  workerRegistry = registry || null;

  tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log('[Telegram] Bot ishga tushdi ✅');

  tgBot.on('polling_error', err => {
    console.error('[Telegram] Polling xato:', err.message || err);
  });

  registerHandlers();
  return tgBot;
}

// ─── Xavfsizlik ───────────────────────────────────────────────────────────────

function isAllowed(chatId) {
  if (ALLOWED_IDS.length === 0) return true;
  return ALLOWED_IDS.includes(Number(chatId));
}

function guard(msg, fn) {
  if (!isAllowed(msg.chat.id)) {
    tgBot.sendMessage(msg.chat.id, "⛔ Ruxsat yo'q.").catch(() => {});
    return;
  }
  try { fn(); } catch (err) {
    tgBot.sendMessage(msg.chat.id, `❌ Xato: ${err.message}`).catch(() => {});
  }
}

function reply(chatId, text, extra = {}) {
  if (!tgBot) return;
  tgBot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...extra }).catch(err => {
    console.error('[Telegram] Xabar yuborishda xato:', err.message);
  });
}

// ─── Buyruqlar ────────────────────────────────────────────────────────────────

function registerHandlers() {
  const isCentral = !!workerRegistry;

  // /start, /help
  tgBot.onText(/\/start|\/help/, msg => {
    guard(msg, () => {
      const lines = [
        '🎮 *ArtiCRAFT Bot — Telegram Panel*',
        '',
      ];

      if (isCentral) {
        // Central mode buyruqlari
        lines.push(
          '🌐 *Multi-Bot Boshqaruv:*',
          '`/bots` — Barcha botlar ro\'yxati',
          '`/bot <id> status` — Bot holati',
          '`/bot <id> start` — Botni ishga tushirish',
          '`/bot <id> stop` — Botni to\'xtatish',
          '`/bot <id> restart` — Qayta ishga tushirish',
          '`/bot <id> inventory` — Inventar',
          '`/bot <id> chat <xabar>` — Chat',
          '',
          '📊 *Statistika:*',
          '`/allstats` — Barcha botlar umumiy statistikasi',
          '`/bot <id> stats` — Aniq bot statistikasi',
        );
      } else {
        // Single-bot mode buyruqlari
        lines.push(
          '📡 *Holat:*',
          '`/status` — Bot holati',
          '`/stats` — Farming statistikasi',
          '',
          '💬 *Chat:*',
          '`/chat <xabar>` — Chatga yozish',
          '',
          '🏃 *Harakat:*',
          '`/stop` — To\'xtatish',
          '`/stop_all` — Barcha harakatni to\'xtatish',
          '`/jump` — Sakrash',
          '`/forward` `/back` — 1s harakat',
          '`/left` `/right` — 1s harakat',
          '`/sprint` — Sprint on/off',
          '`/sneak` — Sneak on/off',
          '',
          '🎒 *Inventar:*',
          '`/inventory` — Inventarni ko\'rsatish',
          '',
          '⚙️ *Boshqarish:*',
          '`/reconnect` — Qayta ulash',
        );
      }

      reply(msg.chat.id, lines.join('\n'));
    });
  });

  // /status (single-bot)
  tgBot.onText(/\/status(?!\s)/, msg => {
    if (isCentral) return; // Central modeda /bots ishlatiladi
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

  // /stats (single-bot)
  tgBot.onText(/\/stats(?!\s)/, msg => {
    if (isCentral) return;
    guard(msg, () => {
      const s = getStatus();
      const st = s.stats || { harvested: 0, planted: 0, sold_cycles: 0 };
      reply(msg.chat.id, [
        '📊 *Farming Statistikasi*',
        '',
        `🌿 *Yig\\'ilgan:* \`${st.harvested}\` ta`,
        `🌱 *Ekilgan:* \`${st.planted}\` ta`,
        `💰 *Sotish sikllari:* \`${st.sold_cycles}\``,
      ].join('\n'));
    });
  });

  // ─── CENTRAL MODE buyruqlari ─────────────────────────────────────────────────

  // /bots — barcha worker'lar
  tgBot.onText(/\/bots/, msg => {
    if (!isCentral) return;
    guard(msg, () => {
      const workers = workerRegistry.getAll();
      if (workers.length === 0) {
        reply(msg.chat.id, '🤖 Hozircha hech qanday worker ulanmagan.');
        return;
      }

      const lines = ['🌐 *Barcha Botlar:*', ''];
      for (const w of workers) {
        const icon = w.state === 'connected' ? '🟢' : '🔴';
        const botIcon = w.botStatus?.connected ? '✅' : '❌';
        lines.push(`${icon} \`${w.id}\` ${botIcon} *${escapeMarkdown(w.botStatus?.username || w.id)}*`);
        if (w.botStatus?.connected) {
          lines.push(`   ❤️ \`${w.botStatus.health?.toFixed(0) ?? '?'}\` 🍖 \`${w.botStatus.food ?? '?'}\` 🎒 \`${w.botStatus.inventoryCount ?? 0}\``);
        }
        lines.push('');
      }

      // Inline keyboard: tezkor boshqaruv
      const keyboard = {
        inline_keyboard: workers.map(w => ([
          { text: `📊 ${w.id}`, callback_data: `bot_status:${w.id}` },
          { text: w.state === 'connected' ? '⏹ Stop' : '▶️ Start',
            callback_data: w.state === 'connected' ? `bot_stop:${w.id}` : `bot_start:${w.id}` },
          { text: '🔄 Restart', callback_data: `bot_restart:${w.id}` },
        ])),
      };

      tgBot.sendMessage(msg.chat.id, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }).catch(() => {});
    });
  });

  // /bot <id> <buyruq> [args]
  tgBot.onText(/\/bot (\S+)\s*(.*)/, (msg, match) => {
    if (!isCentral) return;
    guard(msg, () => {
      const workerId = match[1];
      const rest = (match[2] || '').trim();
      const [subCmd, ...subArgs] = rest.split(/\s+/);

      const worker = workerRegistry.get(workerId);

      switch (subCmd?.toLowerCase()) {
        case 'status': {
          if (!worker) {
            reply(msg.chat.id, `❌ Worker \`${workerId}\` topilmadi.`);
            return;
          }
          const s = worker.botStatus;
          const lines = [
            `🤖 *Worker:* \`${workerId}\``,
            `📡 *Holat:* ${worker.state === 'connected' ? '🟢 Ulangan' : '🔴 Uzilgan'}`,
            '',
          ];
          if (s.connected) {
            lines.push(`✅ *MC:* \`${s.host}:${s.port}\``);
            lines.push(`👤 *Akkaunt:* \`${s.username}\``);
            lines.push(`❤️ *HP:* \`${s.health?.toFixed(1) ?? '?'} / 20\``);
            lines.push(`🍖 *Ovqat:* \`${s.food ?? '?'} / 20\``);
            lines.push(`📍 *Pozitsiya:* \`${s.position ?? "noma'lum"}\``);
            lines.push(`🎒 *Inventar:* \`${s.inventoryCount ?? 0}\` ta`);
          } else {
            lines.push('❌ *MC: Ulanmagan*');
            if (s.lastKickReason) lines.push(`⚠️ ${escapeMarkdown(s.lastKickReason)}`);
          }
          const st = s.stats || {};
          lines.push('', `📊 *Statistika:* yig' \`${st.harvested || 0}\` | ek \`${st.planted || 0}\` | sot \`${st.sold_cycles || 0}\``);
          reply(msg.chat.id, lines.join('\n'));
          break;
        }

        case 'stats': {
          if (!worker) {
            reply(msg.chat.id, `❌ Worker \`${workerId}\` topilmadi.`);
            return;
          }
          const st = worker.botStatus?.stats || {};
          reply(msg.chat.id, [
            `📊 *${workerId} Statistikasi*`,
            '',
            `🌿 *Yig\\'ilgan:* \`${st.harvested || 0}\``,
            `🌱 *Ekilgan:* \`${st.planted || 0}\``,
            `💰 *Sotish:* \`${st.sold_cycles || 0}\``,
          ].join('\n'));
          break;
        }

        case 'stop': {
          const sent = workerRegistry.sendCommand(workerId, 'bot_stop', []);
          reply(msg.chat.id, sent
            ? `⏹ \`${workerId}\` to\'xtatilmoqda...`
            : `❌ \`${workerId}\` ulangan emas.`);
          break;
        }

        case 'start': {
          const sent = workerRegistry.sendCommand(workerId, 'bot_start', []);
          reply(msg.chat.id, sent
            ? `▶️ \`${workerId}\` ishga tushirilmoqda...`
            : `❌ \`${workerId}\` ulangan emas.`);
          break;
        }

        case 'restart': {
          const sent = workerRegistry.sendCommand(workerId, 'reconnect', []);
          reply(msg.chat.id, sent
            ? `🔄 \`${workerId}\` qayta ishga tushirilmoqda...`
            : `❌ \`${workerId}\` ulangan emas.`);
          break;
        }

        case 'inventory': {
          const sent = workerRegistry.sendCommand(workerId, 'inventory', [msg.chat.id]);
          if (!sent) reply(msg.chat.id, `❌ \`${workerId}\` ulangan emas.`);
          break;
        }

        case 'chat': {
          const text = subArgs.join(' ');
          if (!text) {
            reply(msg.chat.id, '⚠️ Xabar kiriting: `/bot <id> chat salom`');
            return;
          }
          const sent = workerRegistry.sendCommand(workerId, 'chat', [text]);
          reply(msg.chat.id, sent
            ? `✉️ Yuborildi → \`${workerId}\`: ${escapeMarkdown(text)}`
            : `❌ \`${workerId}\` ulangan emas.`);
          break;
        }

        case 'logs': {
          const logs = workerRegistry.getLogs(workerId, 20);
          if (logs.length === 0) {
            reply(msg.chat.id, `📋 \`${workerId}\` log yozuvlari yo\'q.`);
            return;
          }
          const text = ['📋 *So\'nggi Loglar:*', '```', ...logs, '```'].join('\n');
          reply(msg.chat.id, text);
          break;
        }

        default:
          reply(msg.chat.id, [
            `❓ *Worker buyruqlari:*`,
            '`/bot <id> status` — holat',
            '`/bot <id> stats` — statistika',
            '`/bot <id> start` — ishga tushirish',
            '`/bot <id> stop` — to\'xtatish',
            '`/bot <id> restart` — qayta ishga tushirish',
            '`/bot <id> inventory` — inventar',
            '`/bot <id> chat <xabar>` — chat',
            '`/bot <id> logs` — loglar',
          ].join('\n'));
      }
    });
  });

  // /allstats — barcha botlar umumiy statistika
  tgBot.onText(/\/allstats/, msg => {
    if (!isCentral) return;
    guard(msg, () => {
      const total = workerRegistry.getTotalStats();
      const workers = workerRegistry.getAll();
      const lines = [
        '📊 *Umumiy Statistika*',
        '',
        `🌿 *Jami yig\\'ilgan:* \`${total.harvested}\``,
        `🌱 *Jami ekilgan:* \`${total.planted}\``,
        `💰 *Jami sotish:* \`${total.sold_cycles}\``,
        '',
        `🤖 *Botlar:* ${workers.filter(w => w.state === 'connected').length}/${workers.length} ulangan`,
      ];
      reply(msg.chat.id, lines.join('\n'));
    });
  });

  // ─── Inline keyboard callback'lari ──────────────────────────────────────────
  tgBot.on('callback_query', (query) => {
    if (!isAllowed(query.message.chat.id)) {
      tgBot.answerCallbackQuery(query.id, { text: "Ruxsat yo'q." }).catch(() => {});
      return;
    }

    const [action, workerId] = query.data.split(':');
    let responseText = '';

    if (!isCentral) {
      tgBot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    switch (action) {
      case 'bot_status': {
        const w = workerRegistry.get(workerId);
        if (w) {
          const s = w.botStatus;
          responseText = s.connected
            ? `✅ ${w.id}: HP=${s.health?.toFixed(0) ?? '?'} Ovqat=${s.food ?? '?'}`
            : `❌ ${w.id}: Ulanmagan`;
        } else {
          responseText = 'Worker topilmadi';
        }
        break;
      }
      case 'bot_stop':
        workerRegistry.sendCommand(workerId, 'bot_stop', []);
        responseText = `⏹ ${workerId} to'xtatilmoqda`;
        break;
      case 'bot_start':
        workerRegistry.sendCommand(workerId, 'bot_start', []);
        responseText = `▶️ ${workerId} ishga tushirilmoqda`;
        break;
      case 'bot_restart':
        workerRegistry.sendCommand(workerId, 'reconnect', []);
        responseText = `🔄 ${workerId} qayta ishga tushirilmoqda`;
        break;
    }

    tgBot.answerCallbackQuery(query.id, { text: responseText }).catch(() => {});
  });

  // ─── Single-bot mode buyruqlari ──────────────────────────────────────────────

  if (!isCentral) {
    _registerSingleBotHandlers();
  }
}

function _registerSingleBotHandlers() {
  // /chat <xabar>
  tgBot.onText(/\/chat (.+)/, (msg, match) => {
    guard(msg, () => {
      const text = match[1].trim();
      if (!text) { tgBot.sendMessage(msg.chat.id, '⚠️ Xabar yozing.').catch(() => {}); return; }
      execCommand('chat', [text]);
      tgBot.sendMessage(msg.chat.id, `✉️ Yuborildi: ${text}`).catch(() => {});
    });
  });

  // /say <xabar>
  tgBot.onText(/\/say (.+)/, (msg, match) => {
    guard(msg, () => {
      execCommand('chat', [match[1].trim()]);
      tgBot.sendMessage(msg.chat.id, `💬 Chat: ${match[1].trim()}`).catch(() => {});
    });
  });

  // /stop
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

  // /forward, /back, /left, /right
  for (const [cmd, dir, label] of [
    ['forward', 'forward', '⬆️ Oldinga'], ['back', 'back', '⬇️ Orqaga'],
    ['left', 'left', '⬅️ Chapga'], ['right', 'right', '➡️ O\'ngga'],
  ]) {
    tgBot.onText(new RegExp(`\\/${cmd}`), msg => {
      guard(msg, () => {
        execCommand('move', [dir, 1_000]);
        tgBot.sendMessage(msg.chat.id, `${label} 1 soniya...`).catch(() => {});
      });
    });
  }

  // /sprint toggle
  tgBot.onText(/\/sprint/, msg => {
    guard(msg, () => {
      toggleState.sprint = !toggleState.sprint;
      execCommand('control', ['sprint', toggleState.sprint]);
      tgBot.sendMessage(msg.chat.id, toggleState.sprint ? '🏃 Sprint yoqildi' : '🚶 Sprint o\'chirildi').catch(() => {});
    });
  });

  // /sneak toggle
  tgBot.onText(/\/sneak/, msg => {
    guard(msg, () => {
      toggleState.sneak = !toggleState.sneak;
      execCommand('control', ['sneak', toggleState.sneak]);
      tgBot.sendMessage(msg.chat.id, toggleState.sneak ? '🐾 Sneak yoqildi' : '🚶 Sneak o\'chirildi').catch(() => {});
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

  // /come, /follow (hozircha amalga oshirilmagan)
  for (const cmd of ['come', 'follow']) {
    tgBot.onText(new RegExp(`\\/${cmd}`), msg => {
      guard(msg, () => {
        tgBot.sendMessage(msg.chat.id, `ℹ️ \`/${cmd}\` hozircha qo'llab-quvvatlanmaydi.`, { parse_mode: 'Markdown' }).catch(() => {});
      });
    });
  }
}

// ─── Broadcast funksiyalari ────────────────────────────────────────────────────

/**
 * Minecraft chat xabarini Telegram'ga yuboradi.
 */
function forwardChatToTelegram(entry) {
  if (!tgBot || !FORWARD_CHAT) return;
  if (!entry?.text) return;
  if (entry.source === 'panel') return;
  const text = String(entry.text);
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
 * Worker online/offline bildirishnomasi (central mode).
 */
function notifyWorkerStatus(workerId, online, extra = '') {
  if (!tgBot) return;
  const icon = online ? '🟢' : '🔴';
  const state = online ? 'Ulandi' : 'Uzildi';
  let msg = `${icon} *Worker \`${workerId}\` ${state}*`;
  if (extra) msg += `\n${escapeMarkdown(extra)}`;
  for (const id of ALLOWED_IDS) {
    tgBot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

/**
 * HP past bildirishnomasi.
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
    lines.push(`• \`${item.displayName || item.name}\` ×${item.count}`);
  }
  tgBot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' }).catch(() => {});
}

// ─── Yordamchi ────────────────────────────────────────────────────────────────

function escapeMarkdown(text) {
  return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function getTgBot() { return tgBot; }

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  initTelegramBot,
  forwardChatToTelegram,
  notifyStatus,
  notifyWorkerStatus,
  notifyLowHealth,
  sendInventoryToChat,
  getTgBot,
  isEnabled: () => ENABLED && Boolean(TELEGRAM_TOKEN),
};
