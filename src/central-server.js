/**
 * central-server.js
 * Central server: WebSocket + HTTP API
 * Worker'larni qabul qiladi, Telegram bilan bog'laydi.
 *
 * Protokol (JSON messages):
 *   Worker → Central:
 *     { type: 'auth', workerId, token, info: {...} }
 *     { type: 'status', data: { connected, health, food, ... } }
 *     { type: 'log', message: '...' }
 *     { type: 'ping' }
 *
 *   Central → Worker:
 *     { type: 'auth_ok' }
 *     { type: 'auth_fail', reason: '...' }
 *     { type: 'command', action: '...', args: [...] }
 *     { type: 'pong' }
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { WorkerRegistry } = require('./worker-registry');

// ─── Singleton ────────────────────────────────────────────────────────────────
let registry = null;
let wss = null;
let httpServer = null;
let notifyCallback = null; // Telegram bildirish uchun callback

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Central serverni ishga tushiradi.
 * @param {object} opts
 * @param {string} opts.token - Autentifikatsiya tokeni
 * @param {number} opts.wsPort - WebSocket port
 * @param {number} opts.httpPort - HTTP API port
 * @param {function} [opts.onNotify] - (event, data) => void — Telegram notification callback
 * @returns {{ registry: WorkerRegistry, wss, httpServer }}
 */
function startCentralServer({ token, wsPort = 8765, httpPort = 8766, onNotify }) {
  if (registry) {
    console.log('[Central] Server allaqachon ishlamoqda.');
    return { registry, wss, httpServer };
  }

  notifyCallback = onNotify || (() => {});
  registry = new WorkerRegistry();

  // ─── Registry hodisalari ─────────────────────────────────────────────────
  registry.on('worker_connected', entry => {
    console.log(`[Central] ✅ Worker ulandi: ${entry.id}`);
    notifyCallback('worker_connected', entry);
  });

  registry.on('worker_disconnected', entry => {
    console.log(`[Central] ❌ Worker uzildi: ${entry.id}`);
    notifyCallback('worker_disconnected', entry);
  });

  registry.on('status_updated', ({ id }) => {
    // Statusni Telegram'ga katta chiqarmaymiz (faqat muhim o'zgarishlar)
  });

  // ─── WebSocket Server ────────────────────────────────────────────────────
  wss = new WebSocketServer({ port: wsPort });
  console.log(`[Central] WebSocket server port ${wsPort} da ishlamoqda`);

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[Central] Yangi ulanish: ${ip}`);

    let workerId = null;
    let authenticated = false;
    let pingTimer = null;

    // Ping/pong monitoring
    const startPing = () => {
      pingTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25_000);
    };

    const cleanup = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
      if (workerId && authenticated) {
        registry.markDisconnected(workerId);
      }
    };

    ws.on('message', (rawData) => {
      let msg;
      try {
        msg = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      // ── Autentifikatsiya ──────────────────────────────────────────────────
      if (msg.type === 'auth') {
        if (msg.token !== token) {
          ws.send(JSON.stringify({ type: 'auth_fail', reason: 'Noto\'g\'ri token.' }));
          ws.close();
          return;
        }

        workerId = msg.workerId || `worker_${Date.now()}`;
        authenticated = true;
        registry.register(workerId, ws, msg.info || {});
        ws.send(JSON.stringify({ type: 'auth_ok', workerId }));
        startPing();
        console.log(`[Central] Worker autentifikatsiyalandi: ${workerId}`);
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Avval autentifikatsiya qiling.' }));
        return;
      }

      // ── Ping/Pong ─────────────────────────────────────────────────────────
      if (msg.type === 'pong' || msg.type === 'ping') {
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        registry.updateStatus(workerId, {}); // lastSeen yangilash
        return;
      }

      // ── Status yangilash ──────────────────────────────────────────────────
      if (msg.type === 'status' && msg.data) {
        registry.updateStatus(workerId, msg.data);
        return;
      }

      // ── Log ───────────────────────────────────────────────────────────────
      if (msg.type === 'log' && msg.message) {
        registry.addLog(workerId, msg.message);
        // Muhim xabarlarni Telegram'ga yuborish
        const text = String(msg.message);
        if (
          text.includes('Serverdan chiqarildi') ||
          text.includes('Muvaffaqiyatli') ||
          text.includes('tiqilib qolgani')
        ) {
          notifyCallback('log', { workerId, message: text });
        }
        return;
      }

      // ── Inventar javobi ───────────────────────────────────────────────────
      if (msg.type === 'inventory_response') {
        notifyCallback('inventory_response', { workerId, chatId: msg.chatId, items: msg.items });
        return;
      }
    });

    ws.on('close', () => {
      cleanup();
    });

    ws.on('error', (err) => {
      console.error(`[Central] WebSocket xato (${workerId || ip}):`, err.message);
      cleanup();
    });
  });

  // ─── HTTP API Server ─────────────────────────────────────────────────────
  httpServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Oddiy token tekshiruvi
    const authHeader = req.headers['authorization'] || '';
    const reqToken = authHeader.replace('Bearer ', '').trim();
    const isAuth = reqToken === token;

    const url = new URL(req.url, `http://localhost:${httpPort}`);
    const path = url.pathname;

    // GET /health — ochiq, token shart emas
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        workers: registry.getAll().length,
        connected: registry.getConnected().length,
        uptime: process.uptime(),
      }));
      return;
    }

    if (!isAuth) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // GET /workers — barcha worker'lar
    if (req.method === 'GET' && path === '/workers') {
      res.writeHead(200);
      res.end(JSON.stringify({ workers: registry.getAll() }));
      return;
    }

    // GET /workers/:id — bitta worker
    const workerMatch = path.match(/^\/workers\/([^/]+)$/);
    if (req.method === 'GET' && workerMatch) {
      const worker = registry.get(workerMatch[1]);
      if (!worker) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Worker topilmadi' }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(worker));
      return;
    }

    // POST /workers/:id/command — buyruq yuborish
    const cmdMatch = path.match(/^\/workers\/([^/]+)\/command$/);
    if (req.method === 'POST' && cmdMatch) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { action, args } = JSON.parse(body);
          const sent = registry.sendCommand(cmdMatch[1], action, args || []);
          res.writeHead(sent ? 200 : 503);
          res.end(JSON.stringify({ success: sent }));
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Noto\'g\'ri JSON' }));
        }
      });
      return;
    }

    // GET /stats — umumiy statistika
    if (req.method === 'GET' && path === '/stats') {
      res.writeHead(200);
      res.end(JSON.stringify({ stats: registry.getTotalStats() }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Topilmadi' }));
  });

  httpServer.listen(httpPort, () => {
    console.log(`[Central] HTTP API port ${httpPort} da ishlamoqda`);
  });

  // ─── Stale worker monitoring ─────────────────────────────────────────────
  setInterval(() => {
    const stale = registry.getStaleWorkers(60_000);
    for (const entry of stale) {
      console.warn(`[Central] Worker ${entry.id} 60s dan beri xabar bermadi, uzilgan deb belgilanmoqda.`);
      registry.markDisconnected(entry.id);
    }
  }, 30_000);

  return { registry, wss, httpServer };
}

/**
 * Registry'ni qaytaradi (Telegram bot uchun).
 */
function getRegistry() {
  return registry;
}

module.exports = { startCentralServer, getRegistry };
