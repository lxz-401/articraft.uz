/**
 * crop-manager.js
 * Barcha ekin turlarini boshqaruvchi unified modul.
 * Har bir ekin turi uchun: pishganini tekshirish, yig'ish, ekish.
 */

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

// ─── Ekin konfiguratsiyasi ────────────────────────────────────────────────────

/**
 * Har bir ekin uchun konfiguratsiya.
 * type: ekin bloki nomi (mineflayer registry'da)
 * maxAge: to'liq pishgan yoshi
 * seedItem: ekish uchun item nomi (null = o'zi yig'ishdan tushadi)
 * needsFarmland: farmland ustida o'sadimi
 * harvestMode: 'dig' | 'stem' | 'height'
 *   - dig: to'g'ridan yig'ish (wheat, carrot, potato, beetroot, cocoa)
 *   - stem: poya va pishgan blokni alohida boshqarish (melon, pumpkin)
 *   - height: balandlikka qarab yig'ish (sugarcane, bamboo)
 */
const CROP_CONFIGS = {
  cocoa: {
    blockName: 'cocoa',
    maxAge: 2,
    seedItem: 'cocoa_beans',
    needsFarmland: false,
    harvestMode: 'dig',
    logBlocks: ['jungle_log', 'jungle_wood', 'stripped_jungle_log', 'stripped_jungle_wood'],
  },
  wheat: {
    blockName: 'wheat',
    maxAge: 7,
    seedItem: 'wheat_seeds',
    needsFarmland: true,
    harvestMode: 'dig',
  },
  carrot: {
    blockName: 'carrots',
    maxAge: 7,
    seedItem: 'carrot',
    needsFarmland: true,
    harvestMode: 'dig',
  },
  potato: {
    blockName: 'potatoes',
    maxAge: 7,
    seedItem: 'potato',
    needsFarmland: true,
    harvestMode: 'dig',
  },
  beetroot: {
    blockName: 'beetroots',
    maxAge: 3,
    seedItem: 'beetroot_seeds',
    needsFarmland: true,
    harvestMode: 'dig',
  },
  melon: {
    blockName: 'melon',
    stemName: 'melon_stem',
    maxAge: null,
    seedItem: 'melon_seeds',
    needsFarmland: true,
    harvestMode: 'stem',
  },
  pumpkin: {
    blockName: 'pumpkin',
    stemName: 'pumpkin_stem',
    maxAge: null,
    seedItem: 'pumpkin_seeds',
    needsFarmland: true,
    harvestMode: 'stem',
  },
  sugarcane: {
    blockName: 'sugar_cane',
    maxAge: null,
    seedItem: 'sugar_cane',
    needsFarmland: false,
    harvestMode: 'height',
    minHarvestHeight: 2,  // kamida 2 blok baland bo'lsa yig'
  },
  bamboo: {
    blockName: 'bamboo',
    maxAge: null,
    seedItem: null,
    needsFarmland: false,
    harvestMode: 'height',
    minHarvestHeight: 3,  // kamida 3 blok baland bo'lsa yig'
  },
};

// ─── CropManager sinfi ─────────────────────────────────────────────────────────

class CropManager {
  /**
   * @param {import('mineflayer').Bot} bot
   * @param {string[]} enabledCrops - Yoqilgan ekin turlari ro'yxati
   * @param {function} log - Loglash funksiyasi
   */
  constructor(bot, enabledCrops, log = console.log) {
    this.bot = bot;
    this.log = log;
    this.blacklistedSpots = new Map();
    this.BLACKLIST_TTL_MS = 60_000;

    // Faqat yoqilgan va registry'da mavjud ekinlarni qoldirish
    this.enabledCrops = (enabledCrops || Object.keys(CROP_CONFIGS)).filter(name => {
      const cfg = CROP_CONFIGS[name];
      if (!cfg) return false;
      const exists = !!bot.registry.blocksByName[cfg.blockName];
      if (!exists) this.log(`[Farming] '${name}' bloki registry'da topilmadi, o'tkazildi.`);
      return exists;
    });

    this.log(`[Farming] Yoqilgan ekinlar: ${this.enabledCrops.join(', ') || 'yo\'q'}`);
  }

  // ─── Asosiy sikl ─────────────────────────────────────────────────────────────

  /**
   * Barcha yoqilgan ekinlarni ko'rib chiqib, pishganini yig'adi.
   * @returns {Promise<boolean>} true = biror narsa yig'ildi
   */
  async harvestAll() {
    for (const cropName of this.enabledCrops) {
      const cfg = CROP_CONFIGS[cropName];
      let harvested = false;

      try {
        if (cfg.harvestMode === 'dig') {
          harvested = await this._harvestByAge(cropName, cfg);
        } else if (cfg.harvestMode === 'stem') {
          harvested = await this._harvestStem(cropName, cfg);
        } else if (cfg.harvestMode === 'height') {
          harvested = await this._harvestByHeight(cropName, cfg);
        }
      } catch (err) {
        if (err.name !== 'NoPath' && !err.message?.includes('cancelled')) {
          this.log(`[Farming] ${cropName} yig'ishda xato: ${err.message}`);
        }
      }

      if (harvested) return true;
    }
    return false;
  }

  /**
   * Yoqilgan ekinlarni ekishga urinadi (inventarda urug' bo'lsa).
   * @returns {Promise<boolean>} true = biror narsa ekildi
   */
  async plantAll() {
    for (const cropName of this.enabledCrops) {
      const cfg = CROP_CONFIGS[cropName];
      if (!cfg.seedItem) continue;
      if (cfg.harvestMode === 'height') continue; // sugarcane/bamboo o'zi ekadi
      if (cfg.harvestMode === 'stem') continue;   // stem ekinlar alohida logika

      try {
        const planted = await this._plantCrop(cropName, cfg);
        if (planted) return true;
      } catch (err) {
        if (!err.message?.includes('cancelled') && !err.message?.includes('timeout')) {
          this.log(`[Farming] ${cropName} ekishda xato: ${err.message}`);
        }
      }
    }
    return false;
  }

  // ─── Yig'ish metodlari ────────────────────────────────────────────────────────

  /**
   * age asosida yetilgan blokni topib yig'adi (wheat, carrot, potato, beetroot, cocoa).
   */
  async _harvestByAge(cropName, cfg) {
    const blockId = this.bot.registry.blocksByName[cfg.blockName]?.id;
    if (!blockId) return false;

    const blocks = this._findBlocks(blockId, 30, 150);
    if (blocks.length === 0) return false;

    const botPos = this.bot.entity.position;
    blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    for (const pos of blocks) {
      const block = this.bot.blockAt(pos);
      if (!block) continue;

      const age = Number(block.getProperties()?.age ?? -1);
      if (age !== cfg.maxAge) continue;

      // Cocoa uchun: log blokiga yopishgan bo'lishi kerak
      if (cfg.logBlocks) {
        const isOnLog = this._isCocoaOnLog(pos);
        if (!isOnLog) continue;
      }

      await this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      const fresh = this.bot.blockAt(pos);
      if (!fresh || fresh.type !== blockId || Number(fresh.getProperties()?.age) !== cfg.maxAge) continue;

      await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      await this._equipBestTool(cropName);
      this._fixEnchantmentBug();

      await this.bot.dig(fresh);
      this.log(`[Farming] ${cropName} yig'ildi: ${pos.x},${pos.y},${pos.z}`);
      await this.bot.waitForTicks(8);
      return true;
    }
    return false;
  }

  /**
   * Stem (poya) ekinlarni yig'adi: melon va pumpkin.
   * Pishgan blok (melon/pumpkin) ni topib, to'g'ridan yig'adi.
   */
  async _harvestStem(cropName, cfg) {
    const blockId = this.bot.registry.blocksByName[cfg.blockName]?.id;
    if (!blockId) return false;

    const blocks = this._findBlocks(blockId, 30, 100);
    if (blocks.length === 0) return false;

    const botPos = this.bot.entity.position;
    blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    for (const pos of blocks) {
      const block = this.bot.blockAt(pos);
      if (!block || block.type !== blockId) continue;

      await this.bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2));

      const fresh = this.bot.blockAt(pos);
      if (!fresh || fresh.type !== blockId) continue;

      await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      await this._equipBestTool(cropName);
      await this.bot.dig(fresh);
      this.log(`[Farming] ${cropName} yig'ildi: ${pos.x},${pos.y},${pos.z}`);
      await this.bot.waitForTicks(8);
      return true;
    }
    return false;
  }

  /**
   * Balandlik asosida yig'adi: sugarcane va bamboo.
   * Pastki blokni qoldiradi (o'sishda davom etsin), yuqori qismini qaziydi.
   */
  async _harvestByHeight(cropName, cfg) {
    const blockId = this.bot.registry.blocksByName[cfg.blockName]?.id;
    if (!blockId) return false;
    const minH = cfg.minHarvestHeight || 2;

    const blocks = this._findBlocks(blockId, 30, 100);
    if (blocks.length === 0) return false;

    // Eng pastki blokni topish (yuqori qismini yig'amiz)
    const bases = new Map();
    for (const pos of blocks) {
      const key = `${pos.x},${pos.z}`;
      if (!bases.has(key) || pos.y < bases.get(key).y) {
        bases.set(key, pos);
      }
    }

    const botPos = this.bot.entity.position;
    const sortedBases = [...bases.values()].sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    for (const base of sortedBases) {
      // Balandlikni o'lchash
      let height = 0;
      while (true) {
        const b = this.bot.blockAt(base.offset(0, height, 0));
        if (!b || b.type !== blockId) break;
        height++;
      }
      if (height < minH) continue;

      // 2-chi blokdan boshlab yig'ish (1-chi qoladi)
      const harvestPos = base.offset(0, 1, 0);
      await this.bot.pathfinder.goto(new goals.GoalNear(base.x, base.y, base.z, 2));

      const harvestBlock = this.bot.blockAt(harvestPos);
      if (!harvestBlock || harvestBlock.type !== blockId) continue;

      await this.bot.lookAt(harvestPos.offset(0.5, 0.5, 0.5), true);
      await this.bot.dig(harvestBlock);
      this.log(`[Farming] ${cropName} yig'ildi (balandlik: ${height}): ${base.x},${base.y},${base.z}`);
      await this.bot.waitForTicks(8);
      return true;
    }
    return false;
  }

  // ─── Ekish metodlari ──────────────────────────────────────────────────────────

  /**
   * Farmland ustidagi bo'sh joyga ekin ekadi.
   */
  async _plantCrop(cropName, cfg) {
    const seedItem = this.bot.inventory.items().find(i => i.name === cfg.seedItem);
    if (!seedItem) return false;

    // Farmland blokini topish
    const farmlandId = this.bot.registry.blocksByName['farmland']?.id;
    if (!farmlandId) return false;

    const farmlands = this._findBlocks(farmlandId, 25, 100);
    if (farmlands.length === 0) return false;

    const now = Date.now();
    const botPos = this.bot.entity.position;
    farmlands.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    for (const farmPos of farmlands) {
      const above = farmPos.offset(0, 1, 0);
      const key = `${above.x},${above.y},${above.z}`;

      // Blacklist tekshirish
      const bl = this.blacklistedSpots.get(key);
      if (bl && now - bl < this.BLACKLIST_TTL_MS) continue;

      const aboveBlock = this.bot.blockAt(above);
      if (!aboveBlock || (aboveBlock.name !== 'air' && aboveBlock.name !== 'cave_air')) continue;

      await this.bot.pathfinder.goto(new goals.GoalNear(above.x, above.y, above.z, 2));

      try {
        const freshAbove = this.bot.blockAt(above);
        if (!freshAbove || (freshAbove.name !== 'air' && freshAbove.name !== 'cave_air')) continue;

        const freshFarmland = this.bot.blockAt(farmPos);
        if (!freshFarmland || freshFarmland.type !== farmlandId) continue;

        await this.bot.equip(seedItem.type, 'hand');
        await this.bot.placeBlock(freshFarmland, new Vec3(0, 1, 0));
        this.log(`[Farming] ${cropName} ekildi: ${above.x},${above.y},${above.z}`);
        await this.bot.waitForTicks(5);
        return true;
      } catch (err) {
        this.blacklistedSpots.set(key, Date.now());
      }
    }
    return false;
  }

  // ─── Yordamchi metodlar ───────────────────────────────────────────────────────

  /**
   * Cocoa bloki jungle log'ga yopishganini tekshiradi.
   */
  _isCocoaOnLog(pos) {
    if (!this.bot) return true;
    const logNames = CROP_CONFIGS.cocoa.logBlocks;
    const neighbors = [
      pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
      pos.offset(0, 0, 1), pos.offset(0, 0, -1),
    ];
    for (const n of neighbors) {
      const b = this.bot.blockAt(n);
      if (b && logNames.includes(b.name)) return true;
    }
    return false;
  }

  /**
   * Bloklar ro'yxatini kenglikka qarab bosqichma-bosqich qidiradi.
   */
  _findBlocks(matching, maxDistance = 30, count = 150) {
    if (!this.bot || !this.bot.entity) return [];
    const tiers = [...new Set([8, 16, maxDistance].filter(d => d <= maxDistance))];
    for (const tier of tiers) {
      const found = this.bot.findBlocks({ matching, maxDistance: tier, count });
      if (found.length > 0) return found;
    }
    return [];
  }

  /**
   * Enchantment bug'ini tuzatadi (mineflayer bug workaround).
   */
  _fixEnchantmentBug() {
    if (this.bot?.heldItem?.enchantments && !Array.isArray(this.bot.heldItem.enchantments)) {
      this.bot.heldItem.enchantments = [];
    }
  }

  /**
   * Ekin turiga mos eng yaxshi qurolni tanlaydi.
   * Cocoa uchun balta, boshqalar uchun qo'l (yoki boshqa qurollar).
   */
  async _equipBestTool(cropName) {
    if (cropName === 'cocoa') {
      await this._equipBestAxe();
    }
    // Boshqa ekinlar uchun: mineflayer o'zi eng yaxshi qurolni tanlaydi
  }

  async _equipBestAxe() {
    const AXE_PRIORITY = ['netherite_axe', 'diamond_axe', 'golden_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
    const AXE_MAX_DUR = { netherite_axe: 2031, diamond_axe: 1561, iron_axe: 250, golden_axe: 32, stone_axe: 131, wooden_axe: 59 };
    const MIN_DUR = 5;

    for (const axeName of AXE_PRIORITY) {
      const maxDur = AXE_MAX_DUR[axeName] || 50;
      const items = this.bot.inventory.items().filter(i => i.name === axeName);
      for (const item of items) {
        if ((maxDur - (item.durabilityUsed || 0)) > MIN_DUR) {
          await this.bot.equip(item, 'hand');
          return;
        }
      }
    }
  }

  /**
   * Blacklist'ni tozalaydi (muddati o'tgan yozuvlarni).
   */
  cleanupBlacklist() {
    const now = Date.now();
    for (const [key, ts] of this.blacklistedSpots) {
      if (now - ts >= this.BLACKLIST_TTL_MS) this.blacklistedSpots.delete(key);
    }
  }

  /**
   * Yoqilgan ekinlar ro'yxatini qaytaradi.
   */
  getEnabledCrops() {
    return [...this.enabledCrops];
  }
}

module.exports = { CropManager, CROP_CONFIGS };
