/**
 * worker-registry.js
 * Central server'dagi barcha ulanigan worker'larni boshqaradi.
 * Worker ulanishi, o'chishi, status yangilanishi va buyruq yuborishni qo'llab-quvvatlaydi.
 */

const EventEmitter = require('events');

// Worker holatlari
const WorkerState = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
};

class WorkerRegistry extends EventEmitter {
  constructor() {
    super();
    // workerId => WorkerEntry
    this.workers = new Map();
  }

  // ─── Worker qo'shish/olib tashlash ─────────────────────────────────────────

  /**
   * Yangi worker'ni ro'yxatdan o'tkazadi.
   * @param {string} workerId
   * @param {object} ws - WebSocket connection
   * @param {object} initialInfo - { username, host, port, ... }
   */
  register(workerId, ws, initialInfo = {}) {
    const existing = this.workers.get(workerId);

    // Eski ulanish bor bo'lsa, yopish
    if (existing?.ws && existing.ws !== ws) {
      try { existing.ws.close(); } catch (_) {}
    }

    const entry = {
      id: workerId,
      ws,
      state: WorkerState.CONNECTED,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      info: { ...initialInfo },
      botStatus: {
        connected: false,
        username: initialInfo.username || workerId,
        host: initialInfo.host || '',
        port: initialInfo.port || 25565,
        health: null,
        food: null,
        position: null,
        inventoryCount: 0,
        isWorking: false,
        lastKickReason: '',
        stats: { harvested: 0, planted: 0, sold_cycles: 0 },
      },
      logs: [],
    };

    this.workers.set(workerId, entry);
    this.emit('worker_connected', entry);
    return entry;
  }

  /**
   * Worker'ni o'chirilgan deb belgilaydi (ulanish uzildi).
   * @param {string} workerId
   */
  markDisconnected(workerId) {
    const entry = this.workers.get(workerId);
    if (!entry) return;
    entry.state = WorkerState.DISCONNECTED;
    entry.ws = null;
    entry.botStatus.connected = false;
    entry.lastSeen = Date.now();
    this.emit('worker_disconnected', entry);
  }

  /**
   * Worker'ni ro'yxatdan butunlay o'chiradi.
   * @param {string} workerId
   */
  remove(workerId) {
    const entry = this.workers.get(workerId);
    if (!entry) return false;
    if (entry.ws) {
      try { entry.ws.close(); } catch (_) {}
    }
    this.workers.delete(workerId);
    this.emit('worker_removed', { id: workerId });
    return true;
  }

  // ─── Status yangilash ───────────────────────────────────────────────────────

  /**
   * Worker'ning bot statusini yangilaydi.
   * @param {string} workerId
   * @param {object} statusData
   */
  updateStatus(workerId, statusData) {
    const entry = this.workers.get(workerId);
    if (!entry) return;
    entry.lastSeen = Date.now();
    entry.botStatus = { ...entry.botStatus, ...statusData };
    this.emit('status_updated', { id: workerId, status: entry.botStatus });
  }

  /**
   * Worker'ning log tarixiga yangi yozuv qo'shadi.
   * @param {string} workerId
   * @param {string} message
   */
  addLog(workerId, message) {
    const entry = this.workers.get(workerId);
    if (!entry) return;
    const time = new Date().toLocaleTimeString();
    entry.logs.push(`[${time}] ${message}`);
    if (entry.logs.length > 100) entry.logs.shift();
    entry.lastSeen = Date.now();
  }

  // ─── So'rovlar ──────────────────────────────────────────────────────────────

  /**
   * Barcha worker'lar ro'yxatini qaytaradi.
   */
  getAll() {
    return [...this.workers.values()].map(entry => this._sanitize(entry));
  }

  /**
   * Bitta worker'ni ID bo'yicha topadi.
   * @param {string} workerId
   */
  get(workerId) {
    const entry = this.workers.get(workerId);
    return entry ? this._sanitize(entry) : null;
  }

  /**
   * Worker'ning log tarixini qaytaradi.
   * @param {string} workerId
   * @param {number} [limit=50]
   */
  getLogs(workerId, limit = 50) {
    const entry = this.workers.get(workerId);
    if (!entry) return [];
    return entry.logs.slice(-limit);
  }

  /**
   * Ulanish holati bor worker'larni qaytaradi.
   */
  getConnected() {
    return [...this.workers.values()]
      .filter(e => e.state === WorkerState.CONNECTED)
      .map(e => this._sanitize(e));
  }

  // ─── Buyruq yuborish ────────────────────────────────────────────────────────

  /**
   * Worker'ga buyruq yuboradi (WebSocket orqali).
   * @param {string} workerId
   * @param {string} action
   * @param {any[]} args
   * @returns {boolean} - Yuborildi/yuborilmadi
   */
  sendCommand(workerId, action, args = []) {
    const entry = this.workers.get(workerId);
    if (!entry || !entry.ws || entry.state !== WorkerState.CONNECTED) {
      return false;
    }

    try {
      entry.ws.send(JSON.stringify({
        type: 'command',
        action,
        args,
        timestamp: Date.now(),
      }));
      return true;
    } catch (err) {
      console.error(`[Registry] ${workerId} ga buyruq yuborishda xato:`, err.message);
      return false;
    }
  }

  /**
   * Barcha ulanigan worker'larga broadcast qiladi.
   * @param {string} action
   * @param {any[]} args
   */
  broadcast(action, args = []) {
    let sent = 0;
    for (const [id] of this.workers) {
      if (this.sendCommand(id, action, args)) sent++;
    }
    return sent;
  }

  // ─── Monitoring ─────────────────────────────────────────────────────────────

  /**
   * Uzoq vaqt xabar yubormaganworker'larni aniqlaydi.
   * @param {number} timeoutMs - Bu vaqtdan ko'p o'tsa — o'lik hisob
   */
  getStaleWorkers(timeoutMs = 30_000) {
    const now = Date.now();
    return [...this.workers.values()].filter(e =>
      e.state === WorkerState.CONNECTED && (now - e.lastSeen) > timeoutMs
    );
  }

  /**
   * Umumiy statistikani hisoblaydi.
   */
  getTotalStats() {
    const total = { harvested: 0, planted: 0, sold_cycles: 0 };
    for (const entry of this.workers.values()) {
      const st = entry.botStatus.stats || {};
      total.harvested += st.harvested || 0;
      total.planted += st.planted || 0;
      total.sold_cycles += st.sold_cycles || 0;
    }
    return total;
  }

  // ─── Yordamchi ──────────────────────────────────────────────────────────────

  /**
   * WebSocket ob'ektini chiqarmasdan entry'ni qaytaradi.
   */
  _sanitize(entry) {
    const { ws, ...safe } = entry;
    return safe;
  }
}

module.exports = { WorkerRegistry, WorkerState };
