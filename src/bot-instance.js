const EventEmitter = require('events');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const profiles = require('./profiles');
const { formatPosition, formatReason, stripControlCodes } = require('./utils');
const { executeAutoSellFlow } = require('./auto-sell');

class BotInstance extends EventEmitter {
  constructor(profile) {
    super();
    this.profile = profile;
    this.id = profile.id;
    this.name = profile.name;
    
    this.bot = null;
    this.isWorking = false;
    this.connected = false;
    this.stopped = true; // Manual stop state
    
    this.reconnectTimer = null;
    this.antiAfkTimer = null;
    this.farmInterval = null;
    this.lastKickReason = '';
    this.stoppedByBotCheck = false;
    this.registerSent = false;
    this.loginSent = false;
    
    // Farm stats
    this.stats = profile.stats || {
      harvested: 0,
      planted: 0,
      sold_cycles: 0
    };
    
    this.blacklistedSpots = new Map();
    this.logs = [];
    this.stopped = profile.enabled === false;
    this.connectionFailures = 0;
    this.lastPosition = null;
    this.stuckCounter = 0;
    this.stuckCheckTimer = null;
    this.saveStateTimeout = null;
  }

  log(message) {
    const timeStr = new Date().toLocaleTimeString();
    const formatted = `[${new Date().toISOString()}] [${this.name}] ${message}`;
    console.log(formatted);
    this.logs.push(`[${timeStr}] ${message}`);
    if (this.logs.length > 30) {
      this.logs.shift();
    }
    this.emit('log', message);
  }

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
    this.clearReconnect();
    this.stopAntiAfk();
    this.stopFarmInterval();
    this.stopStuckCheck();
    this.saveStatsAndState();
    
    if (this.bot) {
      try {
        this.bot.removeAllListeners();
        this.bot.end();
      } catch (err) {}
      this.bot = null;
    }
    this.connected = false;
    this.log('Bot to\'liq to\'xtatildi.');
    this.emit('status_change');
  }

  connect() {
    this.clearReconnect();
    this.registerSent = false;
    this.loginSent = false;
    this.lastKickReason = '';
    this.isWorking = false;

    this.log(`Ulanmoqda: ${this.profile.host}:${this.profile.port}...`);
    
    this.bot = mineflayer.createBot({
      host: this.profile.host,
      port: this.profile.port,
      username: this.profile.username,
      version: this.profile.version !== 'auto' && this.profile.version !== 'false' ? this.profile.version : false,
      auth: this.profile.auth || 'offline'
    });

    this.bot.loadPlugin(pathfinder);

    this.bot.once('spawn', () => {
      this.connected = true;
      this.connectionFailures = 0;
      this.log(`Serverga muvaffaqiyatli ulandi (${this.bot.username})`);
      this.emit('status_change');

      const movements = new Movements(this.bot);
      if (this.bot.registry.blocksByName.cocoa) {
        movements.blocksToAvoid.add(this.bot.registry.blocksByName.cocoa.id);
      }
      movements.canDig = false; // Hosilni tasodifan qazib buzmaslik uchun
      this.bot.pathfinder.setMovements(movements);

      this.setupEntityFilters();

      this.loginIfNeeded();
      this.startAntiAfk();
      this.startStuckCheck();
      
      setTimeout(() => {
        if (this.bot && this.bot.entity) {
          this.bot.chat('/anarxiya');
          this.log('/anarxiya yuborildi');
        }
      }, 1500);

      this.stopFarmInterval();
      this.farmInterval = setInterval(() => this.farmerLoop(), 2000);
      
      this.emit('started');
    });

    this.bot.on('messagestr', message => {
      this.handleAuthPrompt(message);
    });

    this.bot.on('kicked', reason => {
      this.lastKickReason = formatReason(reason);
      const isBotCheck = this.lastKickReason.toLowerCase().includes('проверку на бота') || this.lastKickReason.toLowerCase().includes('bot');
      this.stoppedByBotCheck = this.profile.stopOnBotCheckKick && isBotCheck;
      
      this.log(`Serverdan chiqarildi: ${this.lastKickReason}`);
      
      if (this.lastKickReason.includes('ko‘p akkaunt') || this.lastKickReason.includes('ko\\u2018p akkaunt')) {
        this.log('XATOLIK: IP manzilingizdan ko\'p akkaunt ochilgan. Avtomatik reconnection o\'chirildi.');
        this.stoppedByBotCheck = true;
      }
      
      this.emit('kick', this.lastKickReason);
    });

    this.bot.on('error', error => {
      this.log(`Xato: ${error.message}`);
    });

    this.bot.on('end', () => {
      this.log('Ulanish uzildi.');
      this.connected = false;
      this.stopAntiAfk();
      this.stopFarmInterval();
      this.stopStuckCheck();
      this.emit('stopped');
      this.connectionFailures++;
      this.scheduleReconnect();
    });
  }

  setupEntityFilters() {
    const ignoredEntities = ['text_display', 'item_display', 'block_display', 'interaction', 'display', 'marker', 'armor_stand', 'falling_block'];
    for (const id in this.bot.entities) {
      if (this.bot.entities[id] && ignoredEntities.includes(this.bot.entities[id].name)) {
        delete this.bot.entities[id];
      }
    }
    const originalEmit = this.bot.emit;
    const self = this;
    this.bot.emit = function (event, ...args) {
      if (event === 'entitySpawn' || event === 'entityUpdate') {
        const entity = args[0];
        if (entity && ignoredEntities.includes(entity.name)) {
          if (self.bot.entities[entity.id]) {
            delete self.bot.entities[entity.id];
          }
          return;
        }
      }
      return originalEmit.apply(this, [event, ...args]);
    };
  }

  stopFarmInterval() {
    if (this.farmInterval) {
      clearInterval(this.farmInterval);
      this.farmInterval = null;
    }
  }

  startAntiAfk() {
    this.stopAntiAfk();
    const runAntiAfk = () => {
      if (this.stopped || !this.bot) return;
      if (this.bot.entity) {
        const rand = Math.random();
        if (rand < 0.6) {
          this.bot.setControlState('jump', true);
          setTimeout(() => { if (this.bot) this.bot.setControlState('jump', false); }, 350);
        } else if (rand < 0.8) {
          this.bot.setControlState('sneak', true);
          setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 1000);
        } else {
          const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.5;
          const pitch = this.bot.entity.pitch + (Math.random() - 0.5) * 0.3;
          this.bot.look(yaw, pitch, true).catch(() => {});
        }
      }
      this.antiAfkTimer = setTimeout(runAntiAfk, 30000 + Math.random() * 50000);
    };
    runAntiAfk();
  }

  stopAntiAfk() {
    if (this.antiAfkTimer) {
      clearInterval(this.antiAfkTimer);
      this.antiAfkTimer = null;
    }
  }

  loginIfNeeded() {
    if (!this.profile.autoLogin || !this.profile.password) return;
    setTimeout(() => {
      if (this.bot && this.connected) {
        this.bot.chat(`/register ${this.profile.password} ${this.profile.password}`);
        this.registerSent = true;
      }
    }, 1500);
    setTimeout(() => {
      if (this.bot && this.connected) {
        this.bot.chat(`/login ${this.profile.password}`);
        this.loginSent = true;
      }
    }, 3500);
  }

  handleAuthPrompt(message) {
    if (!this.profile.autoLogin || !this.profile.password) return;
    const normalized = stripControlCodes(String(message)).toLowerCase().replace(/[‘’`]/g, "'");

    if (normalized.includes("ro'yxatdan") || normalized.includes('register')) {
      setTimeout(() => {
        if (this.bot && this.connected) {
          this.bot.chat(`/register ${this.profile.password} ${this.profile.password}`);
          this.registerSent = true;
        }
      }, 500);
      return;
    }

    if (normalized.includes('login') || normalized.includes('kirish')) {
      setTimeout(() => {
        if (this.bot && this.connected) {
          this.bot.chat(`/login ${this.profile.password}`);
          this.loginSent = true;
        }
      }, 500);
    }
  }

  async farmerLoop() {
    if (!this.bot || !this.connected || this.isWorking) return;

    try {
      const cocoaItemId = this.bot.registry.itemsByName.cocoa_beans?.id;
      if (!cocoaItemId) return;

      const emptySlots = this.bot.inventory.emptySlotCount();

      // Check if inventory is almost full to trigger auto-sell
      if (emptySlots <= 2) {
        this.isWorking = true;
        this.log(`Inventar to'la (bo'sh: ${emptySlots}). Avto-sotuv boshlanmoqda...`);
        
        const success = await executeAutoSellFlow(this.bot, true, this.log.bind(this));
        if (success) {
          this.stats.sold_cycles += 1;
          this.saveStatsAndState();
        } else {
          this.log("Avto-sotuv jarayonida xatolik yuz berdi. Birozdan so'ng qayta urinib ko'riladi.");
          await this.bot.waitForTicks(40);
        }
        
        this.isWorking = false;
        return;
      }

      const cocoaId = this.bot.registry.blocksByName.cocoa?.id;
      if (!cocoaId) return;

      // 1. Try to harvest mature cocoa
      let harvested = false;
      const blocks = this.findBlocksTiered(cocoaId, 30, 200);
      if (blocks.length > 0) {
        const botPos = this.bot.entity.position;
        blocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

        let targetPos = null;
        let targetBlock = null;

        for (const pos of blocks) {
          const block = this.bot.blockAt(pos);
          if (block && block.getProperties() && Number(block.getProperties().age) === 2) {
            targetPos = pos;
            targetBlock = block;
            break;
          }
        }

        if (targetBlock) {
          this.isWorking = true;
          const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
          await this.bot.pathfinder.goto(goal);

          const blockToBreak = this.bot.blockAt(targetPos);
          if (blockToBreak && blockToBreak.type === cocoaId && Number(blockToBreak.getProperties().age) === 2) {
            await this.bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
            
            const axes = ['netherite_axe', 'diamond_axe', 'golden_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];
            const maxDurabilityMap = {
              netherite_axe: 2031, diamond_axe: 1561, iron_axe: 250, golden_axe: 32, stone_axe: 131, wooden_axe: 59
            };
            let bestAxe = null;
            for (const axeName of axes) {
              const axeItems = this.bot.inventory.items().filter(item => item.name === axeName);
              for (const item of axeItems) {
                const maxDur = maxDurabilityMap[axeName] || 50;
                const remaining = maxDur - (item.durabilityUsed || 0);
                if (remaining > 5) {
                  bestAxe = item;
                  break;
                }
              }
              if (bestAxe) break;
            }
            if (bestAxe) {
              await this.bot.equip(bestAxe, 'hand');
            }

            if (this.bot.heldItem && this.bot.heldItem.enchantments && !Array.isArray(this.bot.heldItem.enchantments)) {
              this.bot.heldItem.enchantments = [];
            }
            
            await this.bot.dig(blockToBreak);
            this.stats.harvested += 3;
            this.saveStatsAndState();
            
            await this.bot.waitForTicks(10);
            harvested = true;
          }
          this.isWorking = false;
        }
      }

      if (harvested) return;

      // 2. Try to plant cocoa seeds
      const cocoaBeansItems = this.bot.inventory.items().filter(item => item.type === cocoaItemId);
      const totalCocoaCount = cocoaBeansItems.reduce((acc, item) => acc + item.count, 0);

      if (totalCocoaCount > 0) {
        this.isWorking = true;
        const logIds = ['jungle_log', 'jungle_wood', 'stripped_jungle_log', 'stripped_jungle_wood']
          .map(name => this.bot.registry.blocksByName[name]?.id)
          .filter(id => id !== undefined);

        if (logIds.length > 0) {
          const logBlocks = this.findBlocksTiered(logIds, 30, 200);
          if (logBlocks.length > 0) {
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

            for (const pos of logBlocks) {
              const logBlock = this.bot.blockAt(pos);
              for (const { offset, face } of offsets) {
                const airPos = pos.plus(offset);
                const spotKey = `${airPos.x},${airPos.y},${airPos.z}`;

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

            if (targetSpot) {
              const goal = new goals.GoalNear(targetSpot.x, targetSpot.y, targetSpot.z, 2);
              await this.bot.pathfinder.goto(goal);

              try {
                await this.bot.equip(cocoaItemId, 'hand');
                const checkAir = this.bot.blockAt(targetSpot);
                if (checkAir && (checkAir.name === 'air' || checkAir.name === 'cave_air')) {
                  await this.bot.placeBlock(targetLog, placeFace);
                  this.stats.planted += 1;
                  this.saveStatsAndState();
                }
              } catch (err) {
                if (err && err.message && !err.message.includes('timeout')) {
                  this.log(`Ekishda xatolik: ${err.message}`);
                }
                const spotKey = `${targetSpot.x},${targetSpot.y},${targetSpot.z}`;
                this.blacklistedSpots.set(spotKey, Date.now());
              }
            }
          }
        }
        this.isWorking = false;
      }
    } catch (error) {
      if (error.name !== 'NoPath') {
        this.log(`Fermer xatosi: ${error.message}`);
        this.handleAxeBug(error);
      }
      this.isWorking = false;
    }
  }

  handleAxeBug(error) {
    if (error.message && (error.message.includes('enchantments.concat') || error.message.includes('enchantments is not iterable'))) {
      if (this.bot.heldItem) {
        this.bot.tossStack(this.bot.heldItem).catch(() => {});
      }
    }
  }

  scheduleReconnect() {
    if (!this.profile.autoReconnect || this.reconnectTimer || this.stopped || this.stoppedByBotCheck) return;

    this.reconnectTimer = setTimeout(() => {
      this.log('Qayta ulanishga harakat qilinmoqda...');
      this.connect();
    }, this.profile.reconnectDelayMs || 5000);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  safeChat(message) {
    if (this.bot && typeof this.bot.chat === 'function') {
      this.bot.chat(message);
    }
  }

  findBlocksTiered(matching, maxDistance = 30, count = 200) {
    if (!this.bot || !this.connected) return [];
    
    const tiers = [8, 16, maxDistance].filter(d => d <= maxDistance);
    const uniqueTiers = [...new Set(tiers)];
    
    for (const tier of uniqueTiers) {
      const blocks = this.bot.findBlocks({ matching, maxDistance: tier, count });
      if (blocks.length > 0) {
        return blocks;
      }
    }
    return [];
  }

  startStuckCheck() {
    this.stopStuckCheck();
    this.stuckCheckTimer = setInterval(() => {
      if (!this.bot || !this.connected || !this.isWorking || !this.bot.entity) {
        this.lastPosition = null;
        this.stuckCounter = 0;
        return;
      }

      const currentPos = this.bot.entity.position.clone();
      if (this.lastPosition) {
        const dist = currentPos.distanceTo(this.lastPosition);
        if (dist < 0.5) {
          this.stuckCounter++;
          if (this.stuckCounter >= 3) {
            this.log('❗️ Bot tiqilib qolgani aniqlandi! Qutqarish sikli boshlanmoqda...');
            this.recoverFromStuck();
          }
        } else {
          this.stuckCounter = 0;
        }
      }
      this.lastPosition = currentPos;
    }, 5000);
  }

  stopStuckCheck() {
    if (this.stuckCheckTimer) {
      clearInterval(this.stuckCheckTimer);
      this.stuckCheckTimer = null;
    }
    this.lastPosition = null;
    this.stuckCounter = 0;
  }

  async recoverFromStuck() {
    if (!this.bot || !this.connected) return;

    try {
      this.bot.pathfinder.stop();
      this.bot.setControlState('jump', true);
      await this.bot.waitForTicks(5);
      this.bot.setControlState('jump', false);
      
      this.bot.setControlState('back', true);
      await this.bot.waitForTicks(10);
      this.bot.setControlState('back', false);
      
      this.isWorking = false;
      this.stuckCounter = 0;
      this.lastPosition = null;
    } catch (err) {
      this.log(`Stuck recovery error: ${err.message}`);
    }
  }

  saveStatsAndState() {
    if (this.saveStateTimeout) return;
    this.saveStateTimeout = setTimeout(() => {
      this.saveStateTimeout = null;
      profiles.updateProfile(this.id, {
        stats: this.stats,
        enabled: !this.stopped
      });
    }, 2000);
  }
}

module.exports = BotInstance;