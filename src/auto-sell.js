/**
 * auto-sell.js
 * /shop GUI orqali avto-sotuv jarayonini boshqaradi.
 *
 * GUI navigatsiya: /shop → (arrow/orqaga) → player_head(SOTUVCHI) → hopper → lime_dye(Yoqish)
 * Yoqilgandan keyin 3 soniya kutib, o'chirish (gray_dye) bajariladi.
 */

const { stripControlCodes } = require('./utils');

// ─── Konstantalar ─────────────────────────────────────────────────────────────

const WINDOW_OPEN_TIMEOUT_MS = 12_000;  // /shop oynasi ochilishi uchun maksimal kutish
const WINDOW_OP_TIMEOUT_MS   = 10_000;  // Har bir oyna amali uchun kutish
const TICKS_AFTER_OPEN       = 5;       // Oyna ochilgandan keyingi kutish (tick)
const TICKS_AFTER_CLICK      = 10;      // Har bir click dan keyingi kutish (tick)
const AUTO_SELL_ON_WAIT_MS   = 3_000;   // Sotish jarayoni davomiyligi
const MAX_DEPTH              = 2;       // executeAutoSellFlow rekursiv chaqiruv limiti

// ─── Yordamchi: oyna slotlaridan item topish ──────────────────────────────────

/**
 * Konteyner slotlaridan item topadi (0..inventoryStart-1).
 * @param {object} window - Mineflayer window ob'ekti
 * @param {string} itemName - item.name (masalan 'arrow', 'player_head')
 * @param {string|null} [customNameSubstring] - customName/displayName ichida qidiriladigan matn (UPPERCASE)
 * @returns {{ item: object, slot: number }|null}
 */
function findItem(window, itemName, customNameSubstring = null) {
  if (!window?.slots) return null;
  const end = window.inventoryStart ?? window.slots.length;

  for (let i = 0; i < end; i++) {
    const item = window.slots[i];
    if (!item || item.name !== itemName) continue;

    if (customNameSubstring) {
      const raw = item.customName || item.displayName || '';
      const clean = stripControlCodes(String(raw)).toUpperCase();
      if (!clean.includes(customNameSubstring)) continue;
    }

    return { item, slot: i };
  }
  return null;
}

// ─── Asosiy funksiya ──────────────────────────────────────────────────────────

/**
 * /shop orqali avto-sotuv yoqadi yoki o'chiradi.
 * @param {import('mineflayer').Bot} bot
 * @param {boolean} turnOn - true = yoqish, false = o'chirish
 * @param {function} [log] - loglash callback
 * @param {number} [_depth=0] - rekursiv chaqiruv chuqurligi (ichki foydalanish uchun)
 * @returns {Promise<boolean>} - Muvaffaqiyatli bo'lsa true
 */
async function executeAutoSellFlow(bot, turnOn, log = console.log, _depth = 0) {
  if (_depth > MAX_DEPTH) {
    log('[AutoSell] Maksimal rekursiv chuqurlikka yetildi, to\'xtatildi.');
    return false;
  }

  const label = turnOn ? 'Yoqish' : "O'chirish";
  log(`[AutoSell] Boshlanmoqda (${label}), /shop yuborilmoqda...`);

  let currentWindow = null;
  let step = 1;
  let resolved = false;
  let updateDebounce = null; // updateSlot debounce uchun

  // Oyna event listener'larini tozalash
  const cleanup = () => {
    if (currentWindow) {
      try { currentWindow.removeAllListeners('updateSlot'); } catch (_) {}
      try { bot.closeWindow(currentWindow); } catch (_) {}
      currentWindow = null;
    }
    bot.removeListener('windowOpen', onWindowOpen);
    if (updateDebounce) {
      clearTimeout(updateDebounce);
      updateDebounce = null;
    }
  };

  return new Promise((resolve) => {
    const finish = (success, reason) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (!success && reason) log(`[AutoSell] Muvaffaqiyatsiz: ${reason}`);
      resolve(success);
    };

    // ─── Oyna amallari ──────────────────────────────────────────────────────

    const runSteps = async (window) => {
      try {
        // Step 1: "Orqaga" (arrow) — agar mavjud bo'lsa bosish
        if (step === 1) {
          const arrow = findItem(window, 'arrow');
          if (arrow) {
            log('[AutoSell] "Orqaga" (arrow) topildi, bosilmoqda...');
            step = 2;
            await clickSlot(window, arrow.slot);
            return; // Keyingi oyna ochilguncha kutamiz
          } else {
            log('[AutoSell] "Orqaga" topilmadi — asosiy menyudamiz.');
            step = 2;
            // To'g'ridan-to'g'ri step 2 ga o'tish
          }
        }

        // Step 2: Sotuvchi (player_head)
        if (step === 2) {
          let seller = findItem(window, 'player_head', 'SOTUVCHI');
          if (!seller) {
            // Fallback: 30 yoki 33-slot da player_head bor bo'lsa
            for (const slot of [30, 33]) {
              const item = window.slots[slot];
              if (item?.name === 'player_head') {
                seller = { item, slot };
                break;
              }
            }
          }

          if (!seller) {
            finish(false, '"Sotuvchi" (player_head) topilmadi!');
            return;
          }
          log('[AutoSell] "Sotuvchi" (player_head) topildi, bosilmoqda...');
          step = 3;
          await clickSlot(window, seller.slot);
          return;
        }

        // Step 3: Avtosotuv (hopper)
        if (step === 3) {
          const hopper = findItem(window, 'hopper');
          if (!hopper) {
            finish(false, '"Avtosotuv" (hopper) topilmadi!');
            return;
          }
          log('[AutoSell] "Avtosotuv" (hopper) topildi, bosilmoqda...');
          step = 4;
          await clickSlot(window, hopper.slot);
          return;
        }

        // Step 4: Toggle (lime_dye = Yoqish, gray_dye = O'chirish)
        if (step === 4) {
          const targetName = turnOn ? 'lime_dye' : 'gray_dye';
          const btn = findItem(window, targetName);

          if (btn) {
            log(`[AutoSell] "${label}" (${targetName}) topildi, bosilmoqda...`);
            await clickSlot(window, btn.slot);
          } else {
            log(`[AutoSell] "${targetName}" topilmadi — ehtimol allaqachon kerakli holatda.`);
          }

          // Oynani yopish va keyingi qadamni bajarish
          try { bot.closeWindow(window); } catch (_) {}
          currentWindow = null;
          resolved = true; // Cleanup oldidan flag o'rnatish
          cleanup();

          if (turnOn) {
            log(`[AutoSell] ${AUTO_SELL_ON_WAIT_MS / 1000}s kutilmoqda (sotish jarayoni)...`);
            await sleep(AUTO_SELL_ON_WAIT_MS);
            log("[AutoSell] Endi avtosotuvni o'chiramiz...");
            const offResult = await executeAutoSellFlow(bot, false, log, _depth + 1);
            resolve(offResult);
          } else {
            resolve(true);
          }
          return;
        }
      } catch (err) {
        finish(false, `Oyna qadamida xato (step ${step}): ${err.message}`);
      }
    };

    // ─── Click yordamchi funksiya ────────────────────────────────────────────

    const clickSlot = async (window, slot) => {
      try {
        await bot.clickWindow(slot, 0, 0);
        await bot.waitForTicks(TICKS_AFTER_CLICK);
      } catch (err) {
        throw new Error(`Click (slot ${slot}) xatosi: ${err.message}`);
      }
    };

    // ─── windowOpen hodisasi ────────────────────────────────────────────────

    const onWindowOpen = async (window) => {
      currentWindow = window;

      // Oyna to'liq yuklanishini kutish
      await bot.waitForTicks(TICKS_AFTER_OPEN);

      // updateSlot — debounce bilan (ikki marta chaqirilmaslik uchun)
      window.on('updateSlot', () => {
        if (updateDebounce) clearTimeout(updateDebounce);
        updateDebounce = setTimeout(() => {
          updateDebounce = null;
          if (!resolved) runSteps(window);
        }, 200);
      });

      runSteps(window);
    };

    bot.on('windowOpen', onWindowOpen);

    // /shop yuborish
    bot.chat('/shop');

    // Oyna ochilmasa — timeout
    const openTimeout = setTimeout(() => {
      finish(false, '/shop oynasi ochilmadi (timeout)');
    }, WINDOW_OPEN_TIMEOUT_MS);

    // Oyna ochilganda timeout bekor qilinsin
    bot.once('windowOpen', () => clearTimeout(openTimeout));
  });
}

// ─── Yordamchi ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { executeAutoSellFlow };
