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

// ==========================================
// QO'LDA KIRITILADIGAN BOTLAR RO'YXATI
// ==========================================
// 1-bot: 'harvester' faqat yig'adi va sandiqqa joylaydi
// 2-bot: 'planter' sandiqdan urug' oladi va ekib chiqadi
const BOTS_CONFIG = [
  { username: 'l0rd1x', role: 'harvester', port: 3008 },
  { username: 'lord1x',   role: 'planter',   port: 3009 }
];

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: toNumber(process.env.MC_PORT, 25565),
  version: process.env.MC_VERSION && process.env.MC_VERSION !== 'false' && process.env.MC_VERSION !== 'auto' ? process.env.MC_VERSION : false,
  auth: process.env.MC_AUTH || 'offline',
  password: process.env.MC_PASSWORD || '',
  autoLogin: process.env.AUTO_LOGIN !== 'false',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: toNumber(process.env.RECONNECT_DELAY_MS, 5000),
};

const chestFile = path.join(__dirname, 'chest-pos.json');
let chestPos = null;

try {
  if (fs.existsSync(chestFile)) {
    const data = JSON.parse(fs.readFileSync(chestFile, 'utf8'));
    if (data && data.x !== undefined && data.y !== undefined && data.z !== undefined) {
      chestPos = new Vec3(data.x, data.y, data.z);
      console.log(`[Tizim] Oldingi sandiq kordinatasi yuklandi: ${chestPos.x}, ${chestPos.y}, ${chestPos.z}`);
    }
  }
} catch (err) {
  console.log(`[Tizim] Sandiq faylini o'qishda xatolik: ${err.message}`);
}

function saveChestPos(pos) {
  chestPos = pos;
  fs.writeFileSync(chestFile, JSON.stringify({ x: pos.x, y: pos.y, z: pos.z }));
}

const activeBots = new Map(); // username -> bot state instance

class BotState {
  constructor(botConfig) {
    this.botConfig = botConfig;
    this.bot = null;
    this.isWorking = false;
    this.farmInterval = null;
    this.reconnectTimer = null;
    this.blacklistedSpots = new Map(); // Planter uchun vaqtinchalik xato bergan joylar
  }

  log(msg) {
    console.log(`[${new Date().toISOString()}] [${this.botConfig.username} | ${this.botConfig.role.toUpperCase()}] ${msg}`);
  }

  start() {
    this.clearReconnect();
    
    this.bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: this.botConfig.username,
      version: config.version,
      auth: config.auth
    });

    this.bot.loadPlugin(pathfinder);

    this.bot.once('spawn', () => {
      const movements = new Movements(this.bot);
      if (this.bot.registry.blocksByName.cocoa) {
          movements.blocksToAvoid.add(this.bot.registry.blocksByName.cocoa.id);
      }
      movements.canDig = false; // Hosilni tasodifan buzmasligi uchun umumiy qazishni o'chiramiz
      this.bot.pathfinder.setMovements(movements);

      this.log(`Serverga ulandi.`);
      inventoryViewer(this.bot, { port: this.botConfig.port });
      this.log(`Web Inventar ishga tushdi: http://localhost:${this.botConfig.port}`);

      this.loginIfNeeded();
      
      setTimeout(() => {
        if (this.bot && this.bot.entity) {
            this.bot.chat('/anarxiya');
            this.log('/anarxiya buyrug\'i yuborildi.');
        }
      }, 1000);
      
      if (this.farmInterval) clearInterval(this.farmInterval);
      this.farmInterval = setInterval(() => this.farmLoop(), 2000);
    });

    this.bot.on('messagestr', (message) => this.handleAuthPrompt(message));

    this.bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
      this.log(`Serverdan chiqarildi: ${reasonStr}`);
      if (reasonStr.includes('ko‘p akkaunt') || reasonStr.includes('ko\\u2018p akkaunt')) {
          this.log('XATOLIK: IP manzilingizdan ruxsat etilganidan ko\'p akkaunt ochilgan. Reconnect to\'xtatildi.');
          config.autoReconnect = false;
      }
    });

    this.bot.on('error', (error) => {
      this.log(`Xato: ${error.message}`);
    });

    this.bot.on('end', () => {
      this.log('Ulanish uzildi.');
      if (this.farmInterval) {
          clearInterval(this.farmInterval);
          this.farmInterval = null;
      }
      this.isWorking = false;
      this.scheduleReconnect();
    });
  }

  loginIfNeeded() {
    if (!config.autoLogin || !config.password) return;
    setTimeout(() => { if (this.bot && this.bot.entity) this.bot.chat(`/register ${config.password} ${config.password}`); }, 1500);
    setTimeout(() => { if (this.bot && this.bot.entity) this.bot.chat(`/login ${config.password}`); }, 3500);
  }

  handleAuthPrompt(message) {
    if (!config.autoLogin || !config.password) return;
    const normalized = String(message).toLowerCase().replace(/\u00a7[0-9a-fk-or]/gi, '');
    if (normalized.includes("ro'yxatdan") || normalized.includes('register')) {
      setTimeout(() => { if (this.bot && this.bot.entity) this.bot.chat(`/register ${config.password} ${config.password}`); }, 500);
    } else if (normalized.includes('login') || normalized.includes('kirish')) {
      setTimeout(() => { if (this.bot && this.bot.entity) this.bot.chat(`/login ${config.password}`); }, 500);
    }
  }

  async doChestInteraction(action) {
      if (!chestPos) {
          this.log(`Sandiq kordinatasi belgilanmagan! (!setchest yozing) Shuning uchun ${action} bekor qilindi.`);
          return false;
      }

      this.log(`Sandiqqa borilmoqda (${action})...`);
      const chestGoal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 1);
      await this.bot.pathfinder.goto(chestGoal);

      let targetChestBlock = this.bot.blockAt(chestPos);
      const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => this.bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
      
      if (!targetChestBlock || !chestIds.includes(targetChestBlock.type)) {
          targetChestBlock = this.bot.findBlock({ matching: chestIds, maxDistance: 4, point: chestPos });
      }

      if (!targetChestBlock) {
          this.log(`Belgilangan kordinatada sandiq topilmadi!`);
          return false;
      }

      const chest = await this.bot.openContainer(targetChestBlock);
      const cocoaItemId = this.bot.registry.itemsByName.cocoa_beans?.id;

      if (action === 'deposit') {
          for (const item of this.bot.inventory.items()) {
              if (item.type === cocoaItemId) {
                  await chest.deposit(item.type, null, item.count).catch(() => {});
              }
          }
          this.log("Hosil sandiqqa to'liq joylandi.");
      } else if (action === 'withdraw') {
          const chestCocoa = chest.items().filter(item => item.type === cocoaItemId);
          const totalInChest = chestCocoa.reduce((acc, item) => acc + item.count, 0);
          
          if (totalInChest > 0) {
              const toWithdraw = Math.min(64, totalInChest); // Ko'pi bilan bir stak (64) oladi
              await chest.withdraw(cocoaItemId, null, toWithdraw).catch(err => {
                  this.log(`Sandiqdan olishda xatolik: ${err.message}`);
              });
              this.log(`Sandiqdan ${toWithdraw} ta cocoa beans olindi.`);
          } else {
              this.log("Sandiqda cocoa beans yo'q, kutilmoqda...");
          }
      }
      
      await chest.close();
      return true;
  }

  async farmLoop() {
    if (!this.bot || !this.bot.entity || this.isWorking) return;
    
    try {
      const cocoaItemId = this.bot.registry.itemsByName.cocoa_beans?.id;
      if (!cocoaItemId) return;

      const cocoaBeansItems = this.bot.inventory.items().filter(item => item.type === cocoaItemId);
      const totalCocoaCount = cocoaBeansItems.reduce((acc, item) => acc + item.count, 0);
      const emptySlots = this.bot.inventory.emptySlotCount();

      // ==========================================
      // YIG'IB OLUVCHI (HARVESTER) MANTIQ
      // ==========================================
      if (this.botConfig.role === 'harvester') {
          // Agar joy tugasa yoki ko'p yig'ilib qolsa sandiqqa to'kadi
          if (emptySlots <= 5 || totalCocoaCount >= 128) {
              this.isWorking = true;
              await this.doChestInteraction('deposit');
              this.isWorking = false;
              return;
          }

          const cocoaId = this.bot.registry.blocksByName.cocoa?.id;
          if (!cocoaId) return;

          const blocks = this.bot.findBlocks({ matching: cocoaId, maxDistance: 30, count: 200 });
          if (blocks.length === 0) return;

          const botPos = this.bot.entity.position;
          blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

          let targetPos = null;
          let targetBlock = null;

          // Faqat pishganini (age = 2) qidirish
          for (const pos of blocks) {
            const block = this.bot.blockAt(pos);
            if (block && block.getProperties() && Number(block.getProperties().age) === 2) {
              targetPos = pos;
              targetBlock = block;
              break;
            }
          }

          if (!targetBlock) return; // Pishgani yo'q

          this.isWorking = true;
          const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
          await this.bot.pathfinder.goto(goal);

          const blockToBreak = this.bot.blockAt(targetPos);
          if (blockToBreak && blockToBreak.type === cocoaId && Number(blockToBreak.getProperties().age) === 2) {
              await this.bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
              
              const axes = ['netherite_axe', 'diamond_axe', 'golden_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
              for (const axeName of axes) {
                const axeItem = this.bot.inventory.items().find(item => item.name === axeName);
                if (axeItem) {
                  await this.bot.equip(axeItem, 'hand');
                  break;
                }
              }

              // Nosoz qurol xatosini oldini olish
              if (this.bot.heldItem && this.bot.heldItem.enchantments && !Array.isArray(this.bot.heldItem.enchantments)) {
                  this.bot.heldItem.enchantments = [];
              }
              await this.bot.dig(blockToBreak);
              await this.bot.waitForTicks(10); // Buyumni yerdan ko'tarishga ulgurishi uchun ozgina kutish
          }
          this.isWorking = false;
      } 
      
      // ==========================================
      // EKUVCHI (PLANTER) MANTIQ
      // ==========================================
      else if (this.botConfig.role === 'planter') {
          // Urug'i qolmasa sandiqdan oladi
          if (totalCocoaCount === 0) {
              this.isWorking = true;
              await this.doChestInteraction('withdraw');
              this.isWorking = false;
              return;
          }

          const logIds = ['jungle_log', 'jungle_wood', 'stripped_jungle_log', 'stripped_jungle_wood']
              .map(name => this.bot.registry.blocksByName[name]?.id)
              .filter(id => id !== undefined);

          if (logIds.length === 0) return;

          const logBlocks = this.bot.findBlocks({ matching: logIds, maxDistance: 30, count: 200 });
          if (logBlocks.length === 0) return;

          const botPos = this.bot.entity.position;
          logBlocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

          const offsets = [
              { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
              { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
              { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
              { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) }
          ];

          let targetSpot = null;
          let targetLog = null;
          let placeFace = null;

          const now = Date.now();

          // Bo'sh (air) joylarni topish
          for (const pos of logBlocks) {
              const logBlock = this.bot.blockAt(pos);
              for (const { offset, face } of offsets) {
                  const airPos = pos.plus(offset);
                  const spotKey = `${airPos.x},${airPos.y},${airPos.z}`;
                  
                  // Blacklistdagi nosoz joylarni 30 soniya o'tkazib yuborish
                  if (this.blacklistedSpots.has(spotKey) && now - this.blacklistedSpots.get(spotKey) < 30000) {
                      continue;
                  }

                  const airBlock = this.bot.blockAt(airPos);
                  if (airBlock && (airBlock.name === 'air' || airBlock.name === 'cave_air')) {
                      targetSpot = airPos;
                      targetLog = logBlock;
                      placeFace = face;
                      break;
                  }
              }
              if (targetSpot) break;
          }

          if (!targetSpot) return; // Bo'sh joy topilmadi

          this.isWorking = true;
          const goal = new goals.GoalNear(targetSpot.x, targetSpot.y, targetSpot.z, 2);
          await this.bot.pathfinder.goto(goal);
          
          try {
              await this.bot.equip(cocoaItemId, 'hand');
              
              const checkAir = this.bot.blockAt(targetSpot);
              if (checkAir && (checkAir.name === 'air' || checkAir.name === 'cave_air')) {
                  await this.bot.placeBlock(targetLog, placeFace);
                  // this.log(`Hosil ekildi.`);
              }
          } catch (err) {
              if (err && err.message && !err.message.includes('timeout')) {
                  this.log(`Ekishda xatolik: ${err.message}`);
              }
              // Agar ushbu kordinataga ekib bo'lmasa blacklitga qo'shamiz
              const spotKey = `${targetSpot.x},${targetSpot.y},${targetSpot.z}`;
              this.blacklistedSpots.set(spotKey, Date.now());
          }
          this.isWorking = false;
      }

    } catch (error) {
      if (error.name !== 'NoPath') {
        this.log(`Xatolik: ${error.stack || error.message}`);
        // Nosoz enchantments xatosi bo'lsa qurolni tashlab yuborish
        if (error.message && (error.message.includes('enchantments.concat') || error.message.includes('enchantments is not iterable'))) {
          if (this.bot.heldItem) {
            this.bot.tossStack(this.bot.heldItem).catch(() => {});
          }
        }
      }
      this.isWorking = false;
    }
  }

  scheduleReconnect() {
    if (!config.autoReconnect || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.log('Qayta ulanishga harakat qilinmoqda...');
      this.start();
    }, config.reconnectDelayMs);
  }

  clearReconnect() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

// ==========================================
// BARCHA BOTLARNI KETMA-KET ISHGA TUSHIRISH
// ==========================================
async function startAllBots() {
    for (let i = 0; i < BOTS_CONFIG.length; i++) {
        const botConfig = BOTS_CONFIG[i];
        console.log(`[Tizim] Ishga tushirilmoqda: ${botConfig.username} (${botConfig.role})`);
        
        const botState = new BotState(botConfig);
        activeBots.set(botConfig.username, botState);
        botState.start();

        if (i < BOTS_CONFIG.length - 1) {
            console.log(`[Tizim] Keyingi bot ulanishi uchun 6 soniya kutilmoqda (Anti-Spam himoyasi uchun)...`);
            await new Promise(resolve => setTimeout(resolve, 6000));
        }
    }
}

// Terminaldan boshqarish (Chat yozish, !setchest buyrug'i)
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

process.on('uncaughtException', (err) => {
  console.log(`[Tizim xatosi ushlandi]: ${err.message}`);
});

rl.on('line', (line) => {
  const message = line.trim();
  if (message) {
    if (message.startsWith('!setchest')) {
      const parts = message.split(/\s+/);
      let newPos = null;
      if (parts.length === 4) {
        const x = parseInt(parts[1]);
        const y = parseInt(parts[2]);
        const z = parseInt(parts[3]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          newPos = new Vec3(x, y, z);
        }
      }
      
      if (!newPos) {
          let anyBot = null;
          for (const bs of activeBots.values()) {
              if (bs.bot && bs.bot.entity) {
                  anyBot = bs.bot; break;
              }
          }
          if (anyBot) {
              const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => anyBot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
              const targetBlock = anyBot.findBlock({ matching: chestIds, maxDistance: 6 });
              if (targetBlock) {
                  newPos = targetBlock.position;
              }
          }
      }

      if (newPos) {
          saveChestPos(newPos);
          console.log(`[Tizim] Sandiq kordinatasi o'rnatildi: ${newPos.x}, ${newPos.y}, ${newPos.z}`);
      } else {
          console.log("[Tizim] Sandiq topilmadi yoki xato kiritildi. Aniq kordinata yozing: '!setchest x y z'");
      }
      return;
    }

    let sent = false;
    for (const bs of activeBots.values()) {
        if (bs.bot && bs.bot.entity) {
            bs.bot.chat(message);
            bs.log(`Terminaldan yuborildi: ${message}`);
            sent = true;
        }
    }
    if (!sent) console.log('[Tizim] Hali hech bir bot serverga ulanmagan.');
  }
});

startAllBots();