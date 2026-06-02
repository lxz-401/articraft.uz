const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const inventoryViewer = require('mineflayer-web-inventory')

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

function parseVersion(value) {
  if (!value || value === 'false' || value === 'auto') return false;
  return value;
}

function log(message) {
  console.log(`[${new Date().toISOString()}] [CocoaBot] ${message}`);
}

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: toNumber(process.env.MC_PORT, 25565),
  username: process.env.MC_COCOA_USERNAME || 'l0rd1x', // Boshqa ism bilan ulanadi
  version: parseVersion(process.env.MC_VERSION),
  auth: process.env.MC_AUTH || 'offline',
  password: process.env.MC_PASSWORD || '',
  autoLogin: process.env.AUTO_LOGIN !== 'false',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: toNumber(process.env.RECONNECT_DELAY_MS, 5000),
};

let bot = null;
let isWorking = false;
let reconnectTimer = null;
let farmInterval = null;
let chestPos = null;

const chestFile = path.join(__dirname, 'chest-pos.json');
try {
  if (fs.existsSync(chestFile)) {
    const data = JSON.parse(fs.readFileSync(chestFile, 'utf8'));
    if (data && data.x !== undefined && data.y !== undefined && data.z !== undefined) {
      chestPos = new Vec3(data.x, data.y, data.z);
      log(`Oldingi sandiq kordinatasi yuklandi: ${chestPos.x}, ${chestPos.y}, ${chestPos.z}`);
    }
  }
} catch (err) {
  log(`Sandiq faylini o'qishda xatolik: ${err.message}`);
}

function saveChestPos(pos) {
  chestPos = pos;
  fs.writeFileSync(chestFile, JSON.stringify({ x: pos.x, y: pos.y, z: pos.z }));
}

function startBot() {
  clearReconnect();
  
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    version: config.version,
    auth: config.auth
  });

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    const movements = new Movements(bot);
    
    // Pathfinder yo'l topishda cocoa beanlarni sindirib yubormasligi uchun ularni chetlab o'tishini ta'minlaymiz
    if (bot.registry.blocksByName.cocoa) {
        movements.blocksToAvoid.add(bot.registry.blocksByName.cocoa.id);
    }
    movements.canDig = false; // Hosilni tasodifan buzmasligi uchun umumiy qazishni o'chiramiz
    bot.pathfinder.setMovements(movements);

    log(`Serverga ulandi: ${config.host}:${config.port} (${bot.username})`);
    
    // Web inventoryni ishga tushirish (port 3008, oldingi bot xalaqit bermasligi uchun)
    inventoryViewer(bot, { port: 3008 });
    log(`Web Inventar ishga tushdi: http://localhost:3008`);

    loginIfNeeded();
    
    setTimeout(() => {
      if (bot && bot.entity) {
          bot.chat('/anarxiya');
          log('/anarxiya buyrug\'i yuborildi.');
      }
    }, 1000);
    
    // Hosilni izlash va yig'ish siklini boshlash
    if (farmInterval) clearInterval(farmInterval);
    farmInterval = setInterval(farmLoop, 2000); // Har 2 soniyada atrofni tekshiradi
  });

  bot.on('messagestr', message => {
    handleAuthPrompt(message);
  });

  bot.on('kicked', reason => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log(`Serverdan chiqarildi: ${reasonStr}`);
    
    if (reasonStr.includes('ko‘p akkaunt') || reasonStr.includes('ko\\u2018p akkaunt')) {
        log('====================================================');
        log('XATOLIK: Sizning IP manzilingizdan ruxsat etilganidan ko\'p akkaunt ochilgan.');
        log('YECHIM: Server qoidasiga ko\'ra 1 ta IP dan faqat bir nechta akkaunt ochish mumkin.');
        log('1) .env faylida MC_COCOA_USERNAME=EskiAcc va MC_COCOA_PASSWORD=Parol orqali avval ro\'yxatdan o\'tgan profilingizni ulang.');
        log('2) YOKI telefoningiz (VPN/Mobil data) orqali serverga kirib CocoaBot ismini ro\'yxatdan o\'tkazing, keyin botni ishlating.');
        log('====================================================');
        config.autoReconnect = false; // Spam qilib bloklanmaslik uchun ulanishni to'xtatamiz
    }
  });

  bot.on('error', error => {
    log(`Xato: ${error.message}`);
  });

  bot.on('end', () => {
    log('Ulanish uzildi.');
    if (farmInterval) {
        clearInterval(farmInterval);
        farmInterval = null;
    }
    isWorking = false;
    scheduleReconnect();
  });
}

function loginIfNeeded() {
  if (!config.autoLogin || !config.password) return;
  setTimeout(() => {
    if (bot && bot.entity) {
        bot.chat(`/register ${config.password} ${config.password}`);
    }
  }, 1500);
  setTimeout(() => {
    if (bot && bot.entity) {
        bot.chat(`/login ${config.password}`);
    }
  }, 3500);
}

function handleAuthPrompt(message) {
  if (!config.autoLogin || !config.password) return;
  const normalized = String(message).toLowerCase().replace(/\u00a7[0-9a-fk-or]/gi, '');
  if (normalized.includes("ro'yxatdan") || normalized.includes('register')) {
    setTimeout(() => { if (bot && bot.entity) bot.chat(`/register ${config.password} ${config.password}`) }, 500);
  } else if (normalized.includes('login') || normalized.includes('kirish')) {
    setTimeout(() => { if (bot && bot.entity) bot.chat(`/login ${config.password}`) }, 500);
  }
}

async function farmLoop() {
  if (!bot || !bot.entity || isWorking) return;
  
  try {
    const cocoaItemId = bot.registry.itemsByName.cocoa_beans?.id;
    if (!cocoaItemId) return;

    // Inventarni tekshirish (faqat kakao loviyalari sonini sanaymiz)
    const emptySlots = bot.inventory.emptySlotCount();
    const cocoaBeansItems = bot.inventory.items().filter(item => item.type === cocoaItemId);
    const totalCocoaCount = cocoaBeansItems.reduce((acc, item) => acc + item.count, 0);

    // Agar bo'sh joy kam qolsa (yoki umuman qolmasa) va yetarlicha hosil yig'ilgan bo'lsa
    if (emptySlots <= 5 && totalCocoaCount > 64) {
        if (!chestPos) {
           log("Inventar to'lmoqda, lekin sandiq kordinatasi belgilanmagan! O'yin ichida '!setchest' deb yozing.");
           return;
        }

        isWorking = true;
        log("Inventar to'ldi, sandiqqa borilmoqda...");
        
        // 1. Sandiqqa borish
        const chestGoal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 1);
        await bot.pathfinder.goto(chestGoal);

        let targetChestBlock = bot.blockAt(chestPos);
        
        // Agar kiritilgan kordinatada to'g'ridan-to'g'ri sandiq bo'lmasa, atrofdan qidirib ko'ramiz
        // (Masalan foydalanuvchi sandiqni emas, o'zining kordinatasini bergan bo'lsa)
        if (!targetChestBlock || !['chest', 'trapped_chest', 'barrel'].includes(targetChestBlock.name)) {
            const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
            targetChestBlock = bot.findBlock({ matching: chestIds, maxDistance: 4, point: chestPos });
        }

        if (!targetChestBlock) {
            const currentBlock = bot.blockAt(chestPos);
            log(`Belgilangan kordinatada sandiq topilmadi! Siz yozgan kordinatada aslida: ${currentBlock ? currentBlock.name : "bo'shliq (air)"} joylashgan.`);
            isWorking = false;
            return;
        }

        // 2. Sandiqni ochish va narsalarni solish
        const chest = await bot.openContainer(targetChestBlock);
        
        let kept = 0;
        // Inventardagi barcha cocoa beanlarni tekshiramiz
        for (const item of bot.inventory.items()) {
            if (item.type === cocoaItemId) {
                if (kept >= 64) {
                    // Agar 64 ta zaxira yig'ilgan bo'lsa, qolganini to'liq solamiz
                    await chest.deposit(item.type, null, item.count).catch(() => {});
                } else if (kept + item.count > 64) {
                    // Agar bu stakdan faqat bir qismi zaxira uchun kerak bo'lsa
                    const toDeposit = item.count - (64 - kept);
                    kept = 64;
                    if (toDeposit > 0) {
                        await chest.deposit(item.type, null, toDeposit).catch(() => {});
                    }
                } else {
                    // Zaxira hali 64 ga yetmagan, bu stakni to'liq olib qolamiz
                    kept += item.count;
                }
            }
        }
        
        await chest.close();
        log("Hosil sandiqqa joylandi, ish davom etmoqda.");
        isWorking = false;
        return; // Keyingi loopgacha kutamiz
    }

    const cocoaId = bot.registry.blocksByName.cocoa?.id;
    if (!cocoaId) return;

    // Atrofdagi barcha cocoa bloklarini qidiramiz (radius: 30)
    const blocks = bot.findBlocks({
      matching: cocoaId,
      maxDistance: 30,
      count: 200
    });

    if (blocks.length === 0) return;

    // Eng yaqinini tanlash uchun masofa bo'yicha saralaymiz
    const botPos = bot.entity.position;
    blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    let targetPos = null;
    let targetBlock = null;

    // Faqat to'liq pishganlarini (age = 2) ajratib olamiz
    for (const pos of blocks) {
      const block = bot.blockAt(pos);
      if (block && block.getProperties() && Number(block.getProperties().age) === 2) {
        targetPos = pos;
        targetBlock = block;
        break; // Eng yaqin pishganini topdik
      }
    }

    if (!targetBlock) return; // Hozircha pishgan hosil yo'q

    isWorking = true;

    // 1. O'sha hosilning yoniga borish
    const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
    await bot.pathfinder.goto(goal);

    // Manzilga yetib kelgach, blok holatini qayta tekshirish
    const blockToBreak = bot.blockAt(targetPos);
    if (!blockToBreak || blockToBreak.type !== cocoaId || Number(blockToBreak.getProperties().age) !== 2) {
      isWorking = false;
      return;
    }

    const facing = blockToBreak.getProperties().facing; // Keyin o'rniga ekish uchun kerak bo'ladi

    // 2. Blokni sindirishdan oldin unga qarash va bolta ushlash
    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
    
    // Inventardan bolta (axe) qidirib topib, qo'lga olish
    const axes = ['netherite_axe', 'diamond_axe', 'golden_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
    for (const axeName of axes) {
      const axeItem = bot.inventory.items().find(item => item.name === axeName);
      if (axeItem) {
        await bot.equip(axeItem, 'hand');
        break; // Eng yaxshi boltani ushlab bo'lgach to'xtaydi
      }
    }

    // DigTime hisoblashda prismarine-block qulab tushmasligi uchun qo'ldagi buyumni oxirgi marta tekshirish
    if (bot.heldItem && bot.heldItem.enchantments && !Array.isArray(bot.heldItem.enchantments)) {
        bot.heldItem.enchantments = [];
    }

    // Blokni sindirish (Hosilni yig'ish)
    await bot.dig(blockToBreak);
    
    // Tushgan narsalarni terib olishi uchun ozgina kutamiz
    await bot.waitForTicks(10);

    // 3. Qayta ekish jarayoni
    if (!cocoaItemId) {
      isWorking = false;
      return;
    }

    // Inventardan cocoa_beans izlash
    const hasCocoaBeans = bot.inventory.items().some(item => item.type === cocoaItemId);
    
    if (!hasCocoaBeans) {
      log("Inventarda ekish uchun cocoa beans qolmadi.");
      isWorking = false;
      return;
    }

    // Cocoa beans ni qo'lga olish
    await bot.equip(cocoaItemId, 'hand');

    // Cocoa qaysi tomonga qarab turganini aniqlash o'rniga, atrofidagi 4 ta blokni tekshiramiz
    const offsets = [
      { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) }
    ];

    let foundLog = null;
    let foundFace = null;

    for (const { offset, face } of offsets) {
      const neighborPos = targetPos.plus(offset);
      const neighborBlock = bot.blockAt(neighborPos);
      // 'jungle' nomi qatnashgan har qanday blokni qabul qiladi (jungle_log, stripped_jungle_wood, v.k)
      if (neighborBlock && neighborBlock.name.includes('jungle')) {
        foundLog = neighborBlock;
        foundFace = face;
        break;
      }
    }

    if (foundLog) {
      await bot.placeBlock(foundLog, foundFace).catch(err => {
         // Agar server lag bo'lsa yoki blok qo'yishni bekor qilsa, time-out xatosi chiqadi, buni shunchaki e'tiborsiz qoldiramiz
         if (err && err.message && err.message.includes('timeout')) return;
         throw err;
      });
      log(`Hosil yig'ildi va qayta ekildi: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);
    } else {
      log(`Orqa tomondan jungle log topilmadi, ekish bekor qilindi.`);
    }

  } catch (error) {
    if (error.name !== 'NoPath') {
      log(`Xatolik: ${error.stack || error.message}`);
      // Agar enchantments xatosi bersa, qo'ldagi qurolni otib yuboramiz
      if (error.message && (error.message.includes('enchantments.concat') || error.message.includes('enchantments is not iterable'))) {
        log("Enchantments xatosi aniqlandi! Qo'ldagi nosoz qurol otib yuborilmoqda...");
        if (bot.heldItem) {
          bot.tossStack(bot.heldItem).catch(err => log(`Qurolni otishda xatolik: ${err.message}`));
        }
      }
    }
  } finally {
    isWorking = false;
  }
}

function scheduleReconnect() {
  if (!config.autoReconnect || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    log('Qayta ulanishga harakat qilinmoqda...');
    startBot();
  }, config.reconnectDelayMs);
}

function clearReconnect() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

// Terminaldan chatga yozish uchun
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

process.on('uncaughtException', (err) => {
  log(`Tizim xatosi ushlandi: ${err.message}`);
});

rl.on('line', (line) => {
  const message = line.trim();
  if (message) {
    if (bot && bot.entity) {
      if (message.startsWith('!setchest')) {
        const parts = message.split(/\s+/);
        if (parts.length === 4) {
          const x = parseInt(parts[1]);
          const y = parseInt(parts[2]);
          const z = parseInt(parts[3]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            saveChestPos(new Vec3(x, y, z));
            log(`Sandiq kordinatasi o'rnatildi: ${x}, ${y}, ${z}`);
            return;
          }
        }
        
        const chestIds = ['chest', 'trapped_chest', 'barrel'].map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
        const targetBlock = bot.findBlock({ matching: chestIds, maxDistance: 6 });
        if (targetBlock) {
           saveChestPos(targetBlock.position);
           log(`Sandiq topildi va kordinatasi saqlandi: ${chestPos.x}, ${chestPos.y}, ${chestPos.z}`);
        } else {
           log("Yaqin atrofda sandiq topilmadi. Yoki aniq kordinata bering: !setchest x y z");
        }
        return;
      }

      bot.chat(message);
      log(`Terminaldan: ${message}`);
    } else {
      log('Bot hali serverga ulanmagan.');
    }
  }
});

startBot();