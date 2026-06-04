/**
 * bot-instance.js
 * Bitta Minecraft bot instansiyasi: ulanish, fermerlik, avto-sotuv.
 */

const EventEmitter = require('events');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const profiles = require('./profiles');
const { formatPosition, formatReason, stripControlCodes, normalizeQuotes } = require('./utils');
const { executeAutoSellFlow } = require('./auto-sell');
const { CropManager } = require('./farming/crop-manager');

// ─── Konstantalar ─────────────────────────────────────────────────────────────

const BLACKLIST_TTL_MS = 60_000;        // 1 daqiqa
const BLACKLIST_CLEANUP_INTERVAL = 120_000; // 2 daqiqada tozalash
const STUCK_CHECK_INTERVAL_MS = 5_000;
const STUCK_THRESHOLD = 3;             // N marta harakatsiz bo'lsa — stuck deb hisobla
const STUCK_DIST_THRESHOLD = 0.5;
const LOG_MAX_LINES = 50;
const SAVE_DEBOUNCE_MS = 2_000;
const ANTI_AFK_MIN_MS = 30_000;
const ANTI_AFK_JITTER_MS = 50_000;
const LOGIN_FALLBACK_DELAY_MS = 5_000; // Server xabar yubormasa, shu vaqtdan keyin login

// ─── Axe durability ───────────────────────────────────────────────────────────

const AXE_PRIORITY = [
  'netherite_axe', 'diamond_axe', 'golden_axe', 'iron_axe', 'stone_axe', 'wooden_axe',
];
const AXE_MAX_DURABILITY = {
  netherite_axe: 2031,
  diamond_axe: 1561,
  iron_axe: 250,
  golden_axe: 32,
  stone_axe: 131,
  wooden_axe: 59,
};
const MIN_DURABILITY_LEFT = 5;

class BotInstance extends EventEmitter {
  constructor(profile) {
    super();
    this.profile = profile;
    this.id = profile.id;
    this.name = profile.name;

    this.bot = null;
    this.isWorking = false;
    this.connected = false;
    this.stopped = profile.enabled === false;

    this.reconnectTimer = null;
    this.antiAfkTimer = null;
    this.farmInterval = null;
    this.stuckCheckTimer = null;
    this.blacklistCleanupTimer = null;
    this.saveStateTimeout = null;
    this.loginFallbackTimer = null;

    this.lastKickReason = '';
    this.stoppedByBotCheck = false;

    // Login holati
    this.loginState = 'idle'; // 'idle' | 'waiting' | 'done'

    // Farm statistikasi
    this.stats = profile.stats || { harvested: 0, planted: 0, sold_cycles: 0 };

    // Qiyinchilik bo'lgan joylari vaqtinchalik bloklash uchun: key -> timestamp
    this.blacklistedSpots = new Map();

    // Log tarixi
    this.logs = [];

    // Stuck detection
    this.lastPosition = null;
    this.stuckCounter = 0;

    // Qayta ulanish urinishlari
    this.connectionFailures = 0;

    // CropManager (bot spawn'dan keyin yaratiladi)
    this.cropManager = null;

    // Yoqilgan ekin turlari (.env yoki profile'dan)
    this.farmingCrops = profile.farmingCrops ||
      (process.env.FARMING_CROPS ? process.env.FARMING_CROPS.split(',').map(c => c.trim()) : null);
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  log(message) {
    const iso = new Date().toISOString();
    const time = new Date().toLocaleTimeString();
    console.log(`[${iso}] [${this.name}] ${message}`);
    this.logs.push(`[${time}] ${message}`);
    if (this.logs.length > LOG_MAX_LINES) this.logs.shift();
    this.emit('log', message);
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (!this.stopped) {
      this.log('Bot allaqachon ishlamoqda.');
      return;
    }
    this.stopped = false;
    this.stoppedByBotCheck = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this._clearAll();
    if (this.bot) {
      try {
        this.bot.removeAllListeners();
        this.bot.end();
      } catch (_) {}
      this.bot = null;
    }
    this.connected = false;
    this.log("Bot to'liq to'xtatildi.");
    this.emit('status_change');
  }

  // ─── Ulanish ───────────────────────────────────────────────────────────────

  connect() {
    this._clearReconnect();
    this.loginState = 'idle';
    this.lastKickReason = '';
    this.isWorking = false;

    this.log(`Ulanmoqda: ${this.profile.host}:${this.profile.port}...`);

    this.bot = mineflayer.createBot({
      host: this.profile.host,
      port: this.profile.port,
      username: this.profile.username,
      version: this._parseVersion(this.profile.version),
      auth: this.profile.auth || 'offline',
    });

    this.bot.loadPlugin(pathfinder);
    this._attachBotEvents();
  }

  _parseVersion(v) {
    if (!v || v === 'auto' || v === 'false') return false;
    return v;
  }

  // ─── Bot hodisalari ────────────────────────────────────────────────────────

  _attachBotEvents() {
    // Spawn
    this.bot.once('spawn', () => this._onSpawn());

    // Server xabarlari (login/register prompt'lari uchun)
    this.bot.on('messagestr', msg => this._handleAuthPrompt(msg));

    // Kick
    this.bot.on('kicked', reason => this._onKicked(reason));

    // Xato
    this.bot.on('error', err => {
      // ECONNREFUSED va shunga o'xshash — alohida log bermaslik
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this.log(`Serverga ulanib bo'lmadi: ${err.code}`);
      } else {
        this.log(`Xato: ${err.message}`);
      }
    });

    // Ulanish uzildi
    this.bot.on('end', () => this._onEnd());
  }

  _onSpawn() {
    this.connected = true;
    this.connectionFailures = 0;
    this.log(`Serverga muvaffaqiyatli ulandi (${this.bot.username})`);
    this.emit('status_change');

    // Pathfinder sozlamalari
    const movements = new Movements(this.bot);
    if (this.bot.registry.blocksByName.cocoa) {
      movements.blocksToAvoid.add(this.bot.registry.blocksByName.cocoa.id);
    }
    movements.canDig = false;
    this.bot.pathfinder.setMovements(movements);

    // Entity filterlash
    this._setupEntityFilters();

    // Login: server xabari kutiladi. 5 sekundda hech narsa kelmasa — fallback
    this._scheduleLoginFallback();

    // Anti-AFK
    this._startAntiAfk();

    // Stuck detection
    this._startStuckCheck();

    // /anarxiya buyrug'i (server uchun maxsus)
    setTimeout(() => {
      if (this.bot?.entity) {
        this.bot.chat('/anarxiya');
        this.log('/anarxiya yuborildi');
      }
    }, 1_500);

    // CropManager yaratish (spawn'dan keyin, registry tayyor bo'lgach)
    this.cropManager = new CropManager(
      this.bot,
      this.farmingCrops,
      this.log.bind(this)
    );

    // Farming loopi
    this._stopFarmInterval();
    this.farmInterval = setInterval(() => this._farmerLoop(), 2_000);

    // Blacklist tozalash
    this._startBlacklistCleanup();

    this.emit('started');
  }

  _onKicked(reason) {
    this.lastKickReason = formatReason(reason);
    const reasonLower = normalizeQuotes(this.lastKickReason).toLowerCase();

    const isBotCheck =
      reasonLower.includes('проверку на бота') ||
      reasonLower.includes('bot check') ||
      reasonLower.includes('bot tekshiruvi');

    const isTooManyAccounts =
      reasonLower.includes("ko'p akkaunt") ||
      reasonLower.includes('слишком много аккаунтов') ||
      reasonLower.includes('too many accounts');

    this.stoppedByBotCheck =
      this.profile.stopOnBotCheckKick && (isBotCheck || isTooManyAccounts);

    if (isTooManyAccounts) {
      this.log("XATOLIK: IP manzilingizdan ko'p akkaunt — avtomatik reconnect o'chirildi.");
    }

    this.log(`Serverdan chiqarildi: ${this.lastKickReason}`);
    this.emit('kick', this.lastKickReason);
  }

  _onEnd() {
    this.log('Ulanish uzildi.');
    this.connected = false;
    this._clearLoginFallback();
    this._stopAntiAfk();
    this._stopFarmInterval();
    this._stopStuckCheck();
    this._stopBlacklistCleanup();
    this.isWorking = false;
    this.emit('stopped');
    this.connectionFailures++;
    this._scheduleReconnect();
    this.emit('status_change');
  }

  // ─── Login / Register ──────────────────────────────────────────────────────

  /**
   * Fallback: agar server login xabar yubormasa, belgilangan vaqtdan keyin login urinadi.
   */
  _scheduleLoginFallback() {
    this._clearLoginFallback();
    if (!this.profile.autoLogin || !this.profile.password) return;

    this.loginState = 'waiting';
    this.loginFallbackTimer = setTimeout(() => {
      if (this.bot && this.connected && this.loginState === 'waiting') {
        this.log('[Auth] Server xabar yubormagani uchun fallback login...');
        this._doLogin();
      }
    }, LOGIN_FALLBACK_DELAY_MS);
  }

  _clearLoginFallback() {
    if (this.loginFallbackTimer) {
      clearTimeout(this.loginFallbackTimer);
      this.loginFallbackTimer = null;
    }
  }

  /**
   * Server xabarini o'qib, /register yoki /login yuboradi.
   */
  _handleAuthPrompt(message) {
    if (!this.profile.autoLogin || !this.profile.password) return;
    if (this.loginState === 'done') return;

    const normalized = stripControlCodes(String(message))
      .toLowerCase()
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

    const needsRegister =
      normalized.includes("ro'yxatdan") ||
      normalized.includes('register') ||
      normalized.includes('/register');

    const needsLogin =
      normalized.includes('/login') ||
      normalized.includes('kirish') ||
      normalized.includes('login');

    if (needsRegister) {
      this._clearLoginFallback();
      setTimeout(() => {
        if (this.bot && this.connected && this.loginState !== 'done') {
          this.bot.chat(`/register ${this.profile.password} ${this.profile.password}`);
          this.log('[Auth] /register yuborildi');
          // Register dan keyin login kutiladi
        }
      }, 500);
      return;
    }

    if (needsLogin) {
      this._clearLoginFallback();
      setTimeout(() => {
        if (this.bot && this.connected && this.loginState !== 'done') {
          this._doLogin();
        }
      }, 500);
    }
  }

  _doLogin() {
    if (!this.bot || !this.connected) return;
    this.bot.chat(`/login ${this.profile.password}`);
    this.loginState = 'done';
    this.log('[Auth] /login yuborildi');
  }

  // ─── Entity filterlash ─────────────────────────────────────────────────────
  // Keraksiz display entity'larni pathfinder va logikadan yashirish.
  // bot.emit ni override qilish o'rniga — entitySpawn/entityUpdate listenerlaridan foydalanamiz.

  _setupEntityFilters() {
    const IGNORED = new Set([
      'text_display', 'item_display', 'block_display',
      'interaction', 'display', 'marker', 'armor_stand', 'falling_block',
    ]);

    // Mavjud entity'larni tozalash
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (e && IGNORED.has(e.name)) delete this.bot.entities[id];
    }

    // Yangi kelayotgan entity'larni filtrlash
    this.bot.on('entitySpawn', entity => {
      if (entity && IGNORED.has(entity.name)) {
        setImmediate(() => {
          if (this.bot?.entities?.[entity.id]) delete this.bot.entities[entity.id];
        });
      }
    });
  }

  // ─── Anti-AFK ──────────────────────────────────────────────────────────────

  _startAntiAfk() {
    this._stopAntiAfk();
    const run = () => {
      if (this.stopped || !this.bot) return;
      if (this.bot.entity) {
        const rand = Math.random();
        if (rand < 0.6) {
          this.bot.setControlState('jump', true);
          setTimeout(() => { if (this.bot) this.bot.setControlState('jump', false); }, 350);
        } else if (rand < 0.8) {
          this.bot.setControlState('sneak', true);
          setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 1_000);
        } else {
          const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.5;
          const pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.3;
          this.bot.look(yaw, pitch, true).catch(() => {});
        }
      }
      // FIX: clearTimeout uchun setTimeout ishlatiladi (avval clearInterval noto'g'ri edi)
      this.antiAfkTimer = setTimeout(run, ANTI_AFK_MIN_MS + Math.random() * ANTI_AFK_JITTER_MS);
    };
    run();
  }

  _stopAntiAfk() {
    if (this.antiAfkTimer) {
      clearTimeout(this.antiAfkTimer); // FIX: clearInterval → clearTimeout
      this.antiAfkTimer = null;
    }
  }

  // ─── Farming loopi ─────────────────────────────────────────────────────────

  _stopFarmInterval() {
    if (this.farmInterval) {
      clearInterval(this.farmInterval);
      this.farmInterval = null;
    }
  }

  async _farmerLoop() {
    if (!this.bot || !this.connected || this.isWorking) return;

    this.isWorking = true;
    try {
      await this._farmCycle();
    } catch (err) {
      if (err.name !== 'NoPath' && !err.message?.includes('cancelled')) {
        this.log(`Fermer xatosi: ${err.message}`);
        this._handleAxeBug(err);
      }
    } finally {
      // FIX: finally bloki — xato bo'lsa ham flag qaytariladi
      this.isWorking = false;
    }
  }

  async _farmCycle() {
    const { inventory } = this.bot;

    // Inventar to'la — avto-sotuv
    const emptySlots = inventory.emptySlotCount();
    if (emptySlots <= 2) {
      this.log(`Inventar to'la (bo'sh: ${emptySlots}). Avto-sotuv boshlanmoqda...`);
      const ok = await executeAutoSellFlow(this.bot, true, this.log.bind(this));
      if (ok) {
        this.stats.sold_cycles += 1;
        this._saveStats();
      } else {
        this.log("Avto-sotuv muvaffaqiyatsiz. Birozdan so'ng qayta uriniladi.");
        await this.bot.waitForTicks(40);
      }
      return;
    }

    if (!this.cropManager) return;

    // 1. Pishgan ekinlarni yig'ish
    const harvested = await this.cropManager.harvestAll();
    if (harvested) {
      this.stats.harvested += 1;
      this._saveStats();
      return;
    }

    // 2. Bo'sh joylarga ekish
    const planted = await this.cropManager.plantAll();
    if (planted) {
      this.stats.planted += 1;
      this._saveStats();
    }
  }

  async _harvestCocoa(cocoaBlockId) {
    const blocks = this._findBlocksTiered(cocoaBlockId, 30, 200);
    if (blocks.length === 0) return false;

    const botPos = this.bot.entity.position;
    blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    for (const pos of blocks) {
      const block = this.bot.blockAt(pos);
      if (!block || Number(block.getProperties()?.age) !== 2) continue;

      const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
      await this.bot.pathfinder.goto(goal);

      // Qayta tekshirish (bot yurishi davomida blok o'zgargan bo'lishi mumkin)
      const fresh = this.bot.blockAt(pos);
      if (!fresh || fresh.type !== cocoaBlockId || Number(fresh.getProperties()?.age) !== 2) {
        continue;
      }

      await this.bot.lookAt(pos.offset(0.5, 0.5, 0.5), true);
      await this._equipBestAxe();

      // Enchantment bug workaround
      if (this.bot.heldItem?.enchantments && !Array.isArray(this.bot.heldItem.enchantments)) {
        this.bot.heldItem.enchantments = [];
      }

      await this.bot.dig(fresh);
      this.stats.harvested += 3;
      this._saveStats();
      await this.bot.waitForTicks(10);
      return true;
    }
    return false;
  }

  async _plantCocoa(cocoaItemId) {
    const cocoaBeans = this.bot.inventory.items().filter(i => i.type === cocoaItemId);
    const totalBeans = cocoaBeans.reduce((s, i) => s + i.count, 0);
    if (totalBeans === 0) return;

    const logNames = ['jungle_log', 'jungle_wood', 'stripped_jungle_log', 'stripped_jungle_wood'];
    const logIds = logNames
      .map(n => this.bot.registry.blocksByName[n]?.id)
      .filter(id => id !== undefined);
    if (logIds.length === 0) return;

    const logBlocks = this._findBlocksTiered(logIds, 30, 200);
    if (logBlocks.length === 0) return;

    const botPos = this.bot.entity.position;
    logBlocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

    const OFFSETS = [
      { offset: new Vec3(0, 0, 1),  face: new Vec3(0, 0, -1) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0,  1) },
      { offset: new Vec3(1, 0, 0),  face: new Vec3(-1, 0, 0) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1,  0, 0) },
    ];

    const now = Date.now();
    let targetSpot = null;
    let targetLog = null;
    let placeFace = null;

    outer:
    for (const pos of logBlocks) {
      for (const { offset, face } of OFFSETS) {
        const airPos = pos.plus(offset);
        const key = `${airPos.x},${airPos.y},${airPos.z}`;

        // Blacklist tekshirish
        const bl = this.blacklistedSpots.get(key);
        if (bl && now - bl < BLACKLIST_TTL_MS) continue;

        const airBlock = this.bot.blockAt(airPos);
        if (airBlock && (airBlock.name === 'air' || airBlock.name === 'cave_air')) {
          targetSpot = airPos;
          targetLog = this.bot.blockAt(pos);
          placeFace = face;
          break outer;
        }
      }
    }

    if (!targetSpot) return;

    const goal = new goals.GoalNear(targetSpot.x, targetSpot.y, targetSpot.z, 2);
    await this.bot.pathfinder.goto(goal);

    try {
      await this.bot.equip(cocoaItemId, 'hand');
      const checkAir = this.bot.blockAt(targetSpot);
      if (checkAir && (checkAir.name === 'air' || checkAir.name === 'cave_air')) {
        await this.bot.placeBlock(targetLog, placeFace);
        this.stats.planted += 1;
        this._saveStats();
      }
    } catch (err) {
      if (!err.message?.includes('timeout') && !err.message?.includes('cancelled')) {
        this.log(`Ekishda xatolik: ${err.message}`);
      }
      const key = `${targetSpot.x},${targetSpot.y},${targetSpot.z}`;
      this.blacklistedSpots.set(key, Date.now());
    }
  }

  // ─── Axe tanlov ───────────────────────────────────────────────────────────

  async _equipBestAxe() {
    for (const axeName of AXE_PRIORITY) {
      const maxDur = AXE_MAX_DURABILITY[axeName] || 50;
      const axeItems = this.bot.inventory.items().filter(i => i.name === axeName);
      for (const item of axeItems) {
        const remaining = maxDur - (item.durabilityUsed || 0);
        if (remaining > MIN_DURABILITY_LEFT) {
          await this.bot.equip(item, 'hand');
          return;
        }
      }
    }
    // Axe topilmasa — qo'lda qoldirish
  }

  // ─── Axe enchantment bug workaround ───────────────────────────────────────

  _handleAxeBug(err) {
    if (
      err.message?.includes('enchantments.concat') ||
      err.message?.includes('enchantments is not iterable')
    ) {
      if (this.bot?.heldItem) {
        this.bot.tossStack(this.bot.heldItem).catch(() => {});
        this.log('[Axe Bug] Xatoli axe tashlandi.');
      }
    }
  }

  // ─── Blok topish ──────────────────────────────────────────────────────────

  _findBlocksTiered(matching, maxDistance = 30, count = 200) {
    if (!this.bot || !this.connected) return [];
    const tiers = [...new Set([8, 16, maxDistance].filter(d => d <= maxDistance))];
    for (const tier of tiers) {
      const found = this.bot.findBlocks({ matching, maxDistance: tier, count });
      if (found.length > 0) return found;
    }
    return [];
  }

  // ─── Stuck detection ───────────────────────────────────────────────────────

  _startStuckCheck() {
    this._stopStuckCheck();
    this.stuckCheckTimer = setInterval(() => {
      if (!this.bot || !this.connected || !this.isWorking || !this.bot.entity) {
        this.lastPosition = null;
        this.stuckCounter = 0;
        return;
      }
      const cur = this.bot.entity.position.clone();
      if (this.lastPosition) {
        const dist = cur.distanceTo(this.lastPosition);
        if (dist < STUCK_DIST_THRESHOLD) {
          this.stuckCounter++;
          if (this.stuckCounter >= STUCK_THRESHOLD) {
            this.log('❗ Bot tiqilib qolgani aniqlandi! Qutqarish sikli boshlanmoqda...');
            this._recoverFromStuck();
          }
        } else {
          this.stuckCounter = 0;
        }
      }
      this.lastPosition = cur;
    }, STUCK_CHECK_INTERVAL_MS);
  }

  _stopStuckCheck() {
    if (this.stuckCheckTimer) {
      clearInterval(this.stuckCheckTimer);
      this.stuckCheckTimer = null;
    }
    this.lastPosition = null;
    this.stuckCounter = 0;
  }

  async _recoverFromStuck() {
    if (!this.bot || !this.connected) return;
    try {
      this.bot.pathfinder.stop();
      this.bot.setControlState('jump', true);
      await this.bot.waitForTicks(5);
      this.bot.setControlState('jump', false);
      this.bot.setControlState('back', true);
      await this.bot.waitForTicks(10);
      this.bot.setControlState('back', false);
      this.stuckCounter = 0;
      this.lastPosition = null;
    } catch (err) {
      this.log(`Stuck recovery xatosi: ${err.message}`);
    }
  }

  // ─── Blacklist cleanup ─────────────────────────────────────────────────────

  _startBlacklistCleanup() {
    this._stopBlacklistCleanup();
    this.blacklistCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, ts] of this.blacklistedSpots) {
        if (now - ts >= BLACKLIST_TTL_MS) this.blacklistedSpots.delete(key);
      }
    }, BLACKLIST_CLEANUP_INTERVAL);
  }

  _stopBlacklistCleanup() {
    if (this.blacklistCleanupTimer) {
      clearInterval(this.blacklistCleanupTimer);
      this.blacklistCleanupTimer = null;
    }
  }

  // ─── Reconnect ─────────────────────────────────────────────────────────────

  _scheduleReconnect() {
    if (!this.profile.autoReconnect || this.reconnectTimer || this.stopped || this.stoppedByBotCheck) return;
    const delay = this.profile.reconnectDelayMs || 5_000;
    this.reconnectTimer = setTimeout(() => {
      this.log('Qayta ulanishga harakat qilinmoqda...');
      this.connect();
    }, delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ─── Statistika saqlash ────────────────────────────────────────────────────

  _saveStats() {
    if (this.saveStateTimeout) return;
    this.saveStateTimeout = setTimeout(() => {
      this.saveStateTimeout = null;
      profiles.updateProfile(this.id, {
        stats: this.stats,
        enabled: !this.stopped,
      });
    }, SAVE_DEBOUNCE_MS);
  }

  // ─── Umumiy tozalash ──────────────────────────────────────────────────────

  _clearAll() {
    this._clearReconnect();
    this._stopAntiAfk();
    this._stopFarmInterval();
    this._stopStuckCheck();
    this._stopBlacklistCleanup();
    this._clearLoginFallback();
    if (this.saveStateTimeout) {
      clearTimeout(this.saveStateTimeout);
      this.saveStateTimeout = null;
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  safeChat(message) {
    if (this.bot && typeof this.bot.chat === 'function') {
      this.bot.chat(message);
    }
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = BotInstance;