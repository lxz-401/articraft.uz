/**
 * worker.js
 * Remote server uchun entry point.
 * Central serverga WebSocket/HTTP orqali ulanadi,
 * Minecraft botini ishga tushiradi va boshqaradi.
 *
 * Muhit o'zgaruvchilari:
 *   CENTRAL_WS_URL    - WebSocket URL (wss://...)
 *   CENTRAL_HTTP_URL  - HTTP fallback URL (https://...)
 *   WORKER_ID         - Ushbu worker'ning noyob ID'si
 *   WORKER_TOKEN      - Autentifikatsiya tokeni
 *   WORKER_PORT       - Local HTTP health-check porti (default: 3000)
 */

const path = require('path');
const http = require('http');
const EventEmitter = require('events');
const BotInstance = require('./bot-instance');
const profiles = require('./profiles');

// ─── .env yuklash ─────────────────────────────────────────────────────────────
function loadEnvFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));

// ─── Konfiguratsiya ───────────────────────────────────────────────────────────
const WORKER_ID     = process.env.WORKER_ID     || `worker_${Math.random().toString(36).slice(2, 7)}`;
const WORKER_TOKEN  = process.env.WORKER_TOKEN  || '';
const WS_URL        = process.env.CENTRAL_WS_URL   || '';
const HTTP_URL      = process.env.CENTRAL_HTTP_URL || '';
const WORKER_PORT   = parseInt(process.env.WORKER_PORT || '3000', 10);

const WS_RECONNECT_DELAY = 5_000;
const WS_MAX_RECONNECT   = 50;    // Necha marta qayta urinish
const HTTP_POLL_INTERVAL = 3_000; // HTTP fallback polling (ms)
const STATUS_PUSH_INTERVAL = 5_000; // Status push interval

// ─── WorkerClient sinfi ───────────────────────────────────────────────────────

class WorkerClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.statusPushTimer = null;
    this.httpPollTimer = null;
    this.useHttpFallback = false;
    this.pendingCommands = []; // HTTP fallback uchun

    this.botInst = null;
    this._setupBot();
  }

  // ─── Bot sozlash ──────────────────────────────────────────────────────────

  _setupBot() {
    const allProfiles = profiles.loadProfiles();
    let profile = allProfiles.find(p => p.enabled !== false);

    if (!profile) {
      profile = { ...profiles.DEFAULT_PROFILE };
      profiles.addProfile(profile);
    }

    // .env ustunlik qiladi
    if (process.env.MC_USERNAME) profile.username = process.env.MC_USERNAME;
    if (process.env.MC_PASSWORD) profile.password = process.env.MC_PASSWORD;
    if (process.env.MC_HOST)     profile.host     = process.env.MC_HOST;
    if (process.env.MC_PORT)     profile.port     = parseInt(process.env.MC_PORT, 10);
    if (process.env.MC_VERSION)  profile.version  = process.env.MC_VERSION;
    if (process.env.MC_AUTH)     profile.auth     = process.env.MC_AUTH;

    // Farming konfiguratsiya
    if (process.env.FARMING_CROPS) {
      profile.farmingCrops = process.env.FARMING_CROPS.split(',').map(c => c.trim());
    }

    console.log(`[Worker] Profil: ${profile.username} @ ${profile.host}:${profile.port}`);
    this.botInst = new BotInstance(profile);

    // Bot hodisalarini central'ga yuborish
    this.botInst.on('status_change', () => this._pushStatus());
    this.botInst.on('log', msg => this._sendLog(msg));

    this.botInst.start();
  }

  // ─── WebSocket ulanish ────────────────────────────────────────────────────

  connect() {
    if (!WS_URL) {
      console.warn('[Worker] CENTRAL_WS_URL yo\'q. Standalone rejimida ishlamoqda.');
      return;
    }

    this._connectWs();
  }

  _connectWs() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }

    console.log(`[Worker] Central serverga ulanmoqda: ${WS_URL}`);

    let WebSocket;
    try {
      WebSocket = require('ws');
    } catch {
      console.error('[Worker] ws paketi topilmadi! npm install ws');
      this._scheduleReconnect();
      return;
    }

    this.ws = new WebSocket(WS_URL, {
      handshakeTimeout: 10_000,
    });

    this.ws.on('open', () => {
      console.log('[Worker] WebSocket ulandi. Autentifikatsiya...');
      this.reconnectAttempts = 0;
      this.useHttpFallback = false;

      // Autentifikatsiya
      this._wsSend({
        type: 'auth',
        workerId: WORKER_ID,
        token: WORKER_TOKEN,
        info: {
          username: this.botInst?.profile?.username || '',
          host:     this.botInst?.profile?.host     || '',
          port:     this.botInst?.profile?.port     || 25565,
        },
      });
    });

    this.ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      this._handleMessage(msg);
    });

    this.ws.on('close', () => {
      console.warn('[Worker] WebSocket uzildi.');
      this.authenticated = false;
      this._stopStatusPush();
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[Worker] WebSocket xato:', err.message);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        this._activateHttpFallback();
      }
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= WS_MAX_RECONNECT) {
      console.error('[Worker] Maksimal qayta ulanish urinishlari tugadi. HTTP fallback\'ga o\'tilmoqda.');
      this._activateHttpFallback();
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(WS_RECONNECT_DELAY * this.reconnectAttempts, 60_000);
    console.log(`[Worker] ${delay / 1000}s dan keyin qayta ulanish (urinish: ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connectWs();
    }, delay);
  }

  // ─── HTTP Fallback ────────────────────────────────────────────────────────

  _activateHttpFallback() {
    if (this.useHttpFallback || !HTTP_URL) return;
    this.useHttpFallback = true;
    console.log('[Worker] HTTP fallback rejimi yoqildi.');
    this._startHttpPoll();
  }

  _startHttpPoll() {
    if (this.httpPollTimer) return;
    this.httpPollTimer = setInterval(() => this._httpPoll(), HTTP_POLL_INTERVAL);
    // Darhol bir marta yuborish
    this._httpPushStatus();
  }

  _stopHttpPoll() {
    if (this.httpPollTimer) {
      clearInterval(this.httpPollTimer);
      this.httpPollTimer = null;
    }
  }

  async _httpPoll() {
    try {
      const resp = await this._httpRequest('GET', `/workers/${WORKER_ID}/pending`);
      if (resp?.commands) {
        for (const cmd of resp.commands) {
          this._executeCommand(cmd.action, cmd.args || []);
        }
      }
    } catch (err) {
      // Polling xatosi — qayta uriniladi
    }
    this._httpPushStatus();
  }

  async _httpPushStatus() {
    if (!this.botInst) return;
    try {
      await this._httpRequest('POST', `/workers/${WORKER_ID}/status`, {
        token: WORKER_TOKEN,
        data: this._getStatusData(),
      });
    } catch (_) {}
  }

  _httpRequest(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
      const baseUrl = new URL(HTTP_URL);
      const options = {
        hostname: baseUrl.hostname,
        port: baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80),
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WORKER_TOKEN}`,
        },
      };

      const protocol = baseUrl.protocol === 'https:' ? require('https') : http;
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      });

      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // ─── Xabar yuborish ───────────────────────────────────────────────────────

  _wsSend(data) {
    if (this.ws?.readyState === this.ws?.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
        return true;
      } catch (err) {
        console.error('[Worker] WebSocket yozishda xato:', err.message);
      }
    }
    return false;
  }

  _pushStatus() {
    const data = this._getStatusData();
    if (this.authenticated) {
      this._wsSend({ type: 'status', data });
    }
  }

  _sendLog(message) {
    if (this.authenticated) {
      this._wsSend({ type: 'log', message });
    }
  }

  _getStatusData() {
    if (!this.botInst) return {};
    const bot = this.botInst.bot;
    return {
      connected: this.botInst.connected,
      username: bot?.username || this.botInst.profile.username,
      host: this.botInst.profile.host,
      port: this.botInst.profile.port,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      position: bot?.entity?.position
        ? `${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`
        : null,
      inventoryCount: bot?.inventory?.items().length ?? 0,
      isWorking: this.botInst.isWorking,
      lastKickReason: this.botInst.lastKickReason,
      stoppedByBotCheck: this.botInst.stoppedByBotCheck,
      stats: this.botInst.getStats(),
    };
  }

  // ─── Xabar qabul qilish ───────────────────────────────────────────────────

  _handleMessage(msg) {
    if (msg.type === 'auth_ok') {
      this.authenticated = true;
      console.log(`[Worker] ✅ Autentifikatsiya muvaffaqiyatli. WorkerID: ${msg.workerId}`);
      this._startStatusPush();
      this._pushStatus();
      return;
    }

    if (msg.type === 'auth_fail') {
      console.error(`[Worker] ❌ Autentifikatsiya rad etildi: ${msg.reason}`);
      if (this.ws) { this.ws.close(); this.ws = null; }
      return;
    }

    if (msg.type === 'ping') {
      this._wsSend({ type: 'pong' });
      return;
    }

    if (msg.type === 'command') {
      this._executeCommand(msg.action, msg.args || []);
      return;
    }
  }

  // ─── Buyruqlarni bajarish ─────────────────────────────────────────────────

  _executeCommand(action, args) {
    if (!this.botInst) return;
    console.log(`[Worker] Buyruq: ${action}`, args);

    switch (action) {
      case 'chat':
        this.botInst.safeChat(args[0] || '');
        break;

      case 'stop':
        if (this.botInst.bot?.pathfinder) this.botInst.bot.pathfinder.stop();
        break;

      case 'stop_all':
        if (this.botInst.bot?.pathfinder) this.botInst.bot.pathfinder.stop();
        for (const ctrl of ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint']) {
          try { this.botInst.bot?.setControlState(ctrl, false); } catch (_) {}
        }
        break;

      case 'jump':
        if (this.botInst.bot) {
          this.botInst.bot.setControlState('jump', true);
          setTimeout(() => { this.botInst.bot?.setControlState('jump', false); }, 500);
        }
        break;

      case 'move': {
        const [dir, dur] = args;
        if (this.botInst.bot) {
          this.botInst.bot.setControlState(dir, true);
          setTimeout(() => { this.botInst.bot?.setControlState(dir, false); }, dur || 1_000);
        }
        break;
      }

      case 'control': {
        const [ctrl, active] = args;
        this.botInst.bot?.setControlState(ctrl, active);
        break;
      }

      case 'inventory': {
        const chatId = args[0];
        if (this.botInst.bot?.inventory) {
          const items = this.botInst.bot.inventory.items().map(item => ({
            item: { displayName: item.displayName, name: item.name, count: item.count },
            label: 'Slot',
          }));
          this._wsSend({ type: 'inventory_response', chatId, items });
        }
        break;
      }

      case 'reconnect':
        this.botInst.stop();
        setTimeout(() => this.botInst.start(), 1_000);
        break;

      case 'bot_stop':
        this.botInst.stop();
        break;

      case 'bot_start':
        this.botInst.start();
        break;

      default:
        console.warn(`[Worker] Noma'lum buyruq: ${action}`);
    }
  }

  // ─── Status push timer ────────────────────────────────────────────────────

  _startStatusPush() {
    this._stopStatusPush();
    this.statusPushTimer = setInterval(() => this._pushStatus(), STATUS_PUSH_INTERVAL);
  }

  _stopStatusPush() {
    if (this.statusPushTimer) {
      clearInterval(this.statusPushTimer);
      this.statusPushTimer = null;
    }
  }
}

// ─── Health check HTTP server ─────────────────────────────────────────────────

function startHealthServer(workerClient) {
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/health' || url === '/') {
      const status = workerClient.botInst ? workerClient._getStatusData() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        workerId: WORKER_ID,
        connected: status.connected || false,
        uptime: process.uptime(),
      }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(WORKER_PORT, () => {
    console.log(`[Worker] Health-check server port ${WORKER_PORT} da ishlamoqda`);
  });
  return server;
}

// ─── Asosiy ishga tushirish ───────────────────────────────────────────────────

async function main() {
  console.log('=====================================================');
  console.log(`🤖 ArtiCRAFT Worker Bot — ${WORKER_ID} 🤖`);
  console.log('=====================================================');

  const client = new WorkerClient();

  // Health-check server (Railway/Render/Replit uchun)
  startHealthServer(client);

  // Central serverga ulanish
  if (WS_URL) {
    client.connect();
  } else {
    console.warn('[Worker] CENTRAL_WS_URL ko\'rsatilmagan — standalone rejimda ishlaydi.');
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT',  () => { console.log('\n[Worker] Yopilmoqda...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[Worker] SIGTERM. Yopilmoqda...'); process.exit(0); });
process.on('uncaughtException', err => console.error('[Worker] Xato:', err.stack || err.message));
process.on('unhandledRejection', reason => console.error('[Worker] Rejection:', reason));

main().catch(err => {
  console.error('[Worker] Kritik xato:', err.stack || err.message);
  process.exit(1);
});
