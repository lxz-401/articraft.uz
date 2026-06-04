const { stripControlCodes } = require('./utils');

/**
 * Toggles the auto-sell feature via the /shop GUI.
 * @param {import('mineflayer').Bot} bot 
 * @param {boolean} turnOn True to turn on, false to turn off.
 * @param {function} log Callback for logging.
 */
async function executeAutoSellFlow(bot, turnOn, log = console.log) {
  return new Promise(async (resolve) => {
    let currentWindow = null;
    let timeoutTimer = null;
    let step = 0;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      bot.removeListener('windowOpen', onWindowOpen);
      if (currentWindow) {
        try { bot.closeWindow(currentWindow); } catch (err) {}
      }
    };

    const fail = (msg) => {
      log(`[AutoSell] Xato: ${msg}`);
      cleanup();
      resolve(false);
    };

    // Helpler function to find an item by ID and/or name in the current window
    const findItem = (window, nameId, customNameSubstring) => {
      if (!window || !window.slots) return null;
      // slots from 0 to window.inventoryStart - 1 are the container slots
      for (let i = 0; i < window.inventoryStart; i++) {
        const item = window.slots[i];
        if (!item) continue;
        
        const isMatchId = item.name === nameId;
        if (!isMatchId) continue;
        
        if (customNameSubstring) {
          // Check displayName or customLore
          const rawName = item.customName || item.displayName || '';
          const cleanName = stripControlCodes(rawName).toUpperCase();
          if (cleanName.includes(customNameSubstring)) {
            return { item, slot: i };
          }
        } else {
          return { item, slot: i };
        }
      }
      return null;
    };

    const clickItem = async (slot) => {
      try {
        await bot.clickWindow(slot, 0, 0); // left click
        await bot.waitForTicks(10); // Wait for server to process and open new window/update
      } catch (err) {
        fail(`Tugmani bosishda xato: ${err.message}`);
      }
    };

    const runSteps = async (window) => {
      try {
        // Step 1: Click Back (arrow) if in initial /shop menu
        if (step === 1) {
          const arrow = findItem(window, 'arrow');
          if (arrow) {
            log('[AutoSell] "Orqaga" (arrow) tugmasi topildi, bosilmoqda...');
            step = 2;
            await clickItem(arrow.slot);
            return;
          } else {
            // It might already be on the main menu, proceed to step 2
            log('[AutoSell] "Orqaga" tugmasi topilmadi, ehtimol asosiy menyudamiz.');
            step = 2;
          }
        }

        // Step 2: Click Seller (player_head)
        if (step === 2) {
          let sellerHead = findItem(window, 'player_head', 'SOTUVCHI');
          if (!sellerHead) {
            // Fallback to slot 30 or 33 if it's a player head
            for (const slot of [30, 33]) {
              const item = window.slots[slot];
              if (item && item.name === 'player_head') {
                sellerHead = { item, slot };
                break;
              }
            }
          }

          if (sellerHead) {
            log('[AutoSell] "Sotuvchi" (player_head) tugmasi topildi, bosilmoqda...');
            step = 3;
            await clickItem(sellerHead.slot);
            return;
          } else {
            fail('"Sotuvchi" tugmasi topilmadi!');
            return;
          }
        }

        // Step 3: Click Hopper (Auto-sotuv menyusiga o'tish)
        if (step === 3) {
          const hopper = findItem(window, 'hopper');
          if (hopper) {
            log('[AutoSell] "Avtosotuv" (hopper) tugmasi topildi, bosilmoqda...');
            step = 4;
            await clickItem(hopper.slot);
            return;
          } else {
            fail('"Avtosotuv" (hopper) tugmasi topilmadi!');
            return;
          }
        }

        // Step 4: Click lime_dye (On) or gray_dye (Off)
        if (step === 4) {
          const targetItemName = turnOn ? 'lime_dye' : 'gray_dye';
          const targetNameUz = turnOn ? 'Yoqish' : "O'chirish";
          
          const toggleBtn = findItem(window, targetItemName);
          if (toggleBtn) {
            log(`[AutoSell] "${targetNameUz}" (${targetItemName}) tugmasi topildi, bosilmoqda...`);
            await clickItem(toggleBtn.slot);
            
            log(`[AutoSell] Muvaffaqiyatli ${targetNameUz} bajarildi.`);
            cleanup();
            
            if (turnOn) {
              log(`[AutoSell] 3 soniya kutilmoqda (sotish jarayoni)...`);
              await new Promise(r => setTimeout(r, 3000));
              log(`[AutoSell] Endi avtosotuvni o'chiramiz...`);
              await executeAutoSellFlow(bot, false, log);
            }
            resolve(true);
            return;
          } else {
            // Agar allaqachon kerakli holatda bo'lsa (masalan, yoqiq bo'lsa lime_dye o'rniga faqat gray_dye bo'lishi mumkin)
            log(`[AutoSell] "${targetItemName}" topilmadi, ehtimol allaqachon kerakli holatda.`);
            cleanup();
            
            if (turnOn) {
              log(`[AutoSell] 3 soniya kutilmoqda (sotish jarayoni)...`);
              await new Promise(r => setTimeout(r, 3000));
              log(`[AutoSell] Endi avtosotuvni o'chiramiz...`);
              await executeAutoSellFlow(bot, false, log);
            }
            resolve(true);
            return;
          }
        }
      } catch (err) {
        fail(`Oyna qadamida xato: ${err.message}`);
      }
    };

    const onWindowOpen = async (window) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      currentWindow = window;
      
      // Reset timer for window operations
      timeoutTimer = setTimeout(() => fail("Oyna amallari vaqti tugadi"), 10000);
      
      // Wait a tiny bit for items to populate fully in the window
      await bot.waitForTicks(5);
      
      // Ensure we re-attach to update events of the new window
      window.on('updateSlot', async () => {
         // Debounce or just wait a tick before checking
         await bot.waitForTicks(2);
         runSteps(window);
      });

      runSteps(window);
    };

    bot.on('windowOpen', onWindowOpen);

    // Start the process
    log(`[AutoSell] /shop komandasi yuborilmoqda (${turnOn ? 'Yoqish' : "O'chirish"})...`);
    step = 1;
    bot.chat('/shop');
    
    timeoutTimer = setTimeout(() => {
      fail("/shop oynasi ochilmadi (Timeout)");
    }, 10000);
  });
}

module.exports = { executeAutoSellFlow };
