/**
 * profiles.js
 * Bot profil(lar)ini profiles.json faylida saqlaydi va o'qiydi.
 * Hozirgi arxitektura: bitta asosiy bot, kelajakda ko'paytirish imkoniyati bor.
 */

const fs = require('fs');
const path = require('path');

const PROFILES_FILE = path.join(__dirname, '..', 'profiles.json');

// ─── Default profil ───────────────────────────────────────────────────────────
// Agar profiles.json bo'lmasa, shu profil ishlatiladi.
// Asosiy qiymatlar .env orqali override qilinadi.

const DEFAULT_PROFILE = {
  id: 'farmer_seller',
  name: 'Farmer & Seller',
  role: 'farmer',
  host: process.env.MC_HOST || 'articraft.uz',
  port: parseInt(process.env.MC_PORT || '25565', 10),
  username: process.env.MC_USERNAME || 'ArticraftBot',
  password: process.env.MC_PASSWORD || '',
  version: process.env.MC_VERSION || '1.21.1',
  auth: process.env.MC_AUTH || 'offline',
  autoLogin: process.env.AUTO_LOGIN !== 'false',
  autoReconnect: process.env.AUTO_RECONNECT !== 'false',
  reconnectDelayMs: parseInt(process.env.RECONNECT_DELAY_MS || '5000', 10),
  stopOnBotCheckKick: process.env.STOP_ON_BOT_CHECK_KICK !== 'false',
  enabled: true,
  stats: {
    harvested: 0,
    planted: 0,
    sold_cycles: 0,
  },
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Diskka har safar murojaat qilmaslik uchun kichik cache.
let _cachedProfiles = null;

// ─── Funksiyalar ──────────────────────────────────────────────────────────────

/**
 * Profil ro'yxatini yuklaydi. Avval cache'dan, bo'lmasa diskdan.
 * @returns {object[]}
 */
function loadProfiles() {
  if (_cachedProfiles) return _cachedProfiles;

  try {
    if (fs.existsSync(PROFILES_FILE)) {
      const data = fs.readFileSync(PROFILES_FILE, 'utf8');
      _cachedProfiles = JSON.parse(data);
      return _cachedProfiles;
    }
  } catch (err) {
    console.error(`[Profiles] profiles.json o'qishda xato: ${err.message}`);
  }

  // Fayl yo'q — default profil bilan boshlash
  _cachedProfiles = [DEFAULT_PROFILE];
  saveProfiles(_cachedProfiles);
  return _cachedProfiles;
}

/**
 * Profil ro'yxatini diskka yozadi va cache'ni yangilaydi.
 * @param {object[]} profiles
 * @returns {boolean}
 */
function saveProfiles(profiles) {
  try {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
    _cachedProfiles = profiles; // cache'ni yangilash
    return true;
  } catch (err) {
    console.error(`[Profiles] profiles.json yozishda xato: ${err.message}`);
    return false;
  }
}

/**
 * Cache'ni tozalaydi (keyingi loadProfiles diskdan o'qiydi).
 */
function invalidateCache() {
  _cachedProfiles = null;
}

/**
 * ID bo'yicha profil topadi.
 * @param {string} id
 * @returns {object|null}
 */
function getProfile(id) {
  return loadProfiles().find(p => p.id === id) || null;
}

/**
 * Yangi profil qo'shadi. Agar shu ID allaqachon mavjud bo'lsa, false qaytaradi.
 * @param {object} profile
 * @returns {boolean}
 */
function addProfile(profile) {
  const profiles = loadProfiles();
  if (profiles.some(p => p.id === profile.id)) {
    return false;
  }
  profiles.push(profile);
  saveProfiles(profiles);
  return true;
}

/**
 * Mavjud profilni yangilaydi (faqat ko'rsatilgan maydonlarni).
 * @param {string} id
 * @param {object} updatedFields
 * @returns {boolean}
 */
function updateProfile(id, updatedFields) {
  const profiles = loadProfiles();
  const index = profiles.findIndex(p => p.id === id);
  if (index === -1) return false;

  profiles[index] = { ...profiles[index], ...updatedFields };
  saveProfiles(profiles);
  return true;
}

/**
 * Profil o'chiradi.
 * @param {string} id
 * @returns {boolean}
 */
function deleteProfile(id) {
  const profiles = loadProfiles();
  const filtered = profiles.filter(p => p.id !== id);
  if (filtered.length === profiles.length) return false;

  saveProfiles(filtered);
  return true;
}

module.exports = {
  DEFAULT_PROFILE,
  loadProfiles,
  saveProfiles,
  invalidateCache,
  getProfile,
  addProfile,
  updateProfile,
  deleteProfile,
};
