/**
 * utils.js
 * Umumiy yordamchi funksiyalar.
 */

/**
 * Vec3 pozitsiyasini o'qilishi qulay string'ga aylantiradi.
 * @param {object|null} position
 * @returns {string|null}
 */
function formatPosition(position) {
  if (!position) return null;
  return `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
}

/**
 * Mineflayer kick sababini inson o'qiy oladigan string'ga aylantiradi.
 * JSON yoki string bo'lishi mumkin.
 * @param {any} reason
 * @returns {string}
 */
function formatReason(reason) {
  if (!reason) return '';
  if (typeof reason === 'string') return stripControlCodes(reason);
  const parts = [];
  collectTextParts(reason, parts);
  const result = parts.join('').trim();
  return result.length > 0 ? stripControlCodes(result) : stripControlCodes(JSON.stringify(reason));
}

/**
 * Minecraft §-rang kodlarini va boshqa control code'larni olib tashlaydi.
 * @param {any} value
 * @returns {string}
 */
function stripControlCodes(value) {
  if (typeof value !== 'string') return String(value || '');
  // §x va &x rang kodlari
  return value
    .replace(/\u00a7[0-9a-fk-or]/gi, '')  // §x
    .replace(/&[0-9a-fk-or]/gi, '');       // &x (ba'zi serverlar ishlataditadi)
}

/**
 * Mineflayer NBT yoki JSON text ob'ektidan text qismlarini yig'adi.
 * Faqat haqiqiy text qiymatlarini oladi, rang va format kalitlarini o'tkazib yuboradi.
 * @param {any} node
 * @param {string[]} parts
 * @param {string} key - Joriy kalit nomi (rang kalitlarini filtrlash uchun)
 */
function collectTextParts(node, parts, key = '') {
  if (!node || typeof node !== 'object') return;

  // Rang yoki format kalitlari — matn emas
  const skipKeys = new Set(['color', 'bold', 'italic', 'underlined', 'strikethrough', 'obfuscated']);
  if (skipKeys.has(key)) return;

  // NBT string node
  if (node.type === 'string' && typeof node.value === 'string') {
    parts.push(node.value);
    return;
  }

  // Array
  if (Array.isArray(node)) {
    for (const item of node) collectTextParts(item, parts);
    return;
  }

  // NBT list
  if (node.type === 'list' && node.value?.value) {
    collectTextParts(node.value.value, parts);
    return;
  }

  // NBT compound
  if (node.type === 'compound' && node.value) {
    for (const [childKey, child] of Object.entries(node.value)) {
      collectTextParts(child, parts, childKey);
    }
    return;
  }

  // JSON chat component: { text: '...', extra: [...] }
  if (typeof node.text === 'string') {
    parts.push(node.text);
    if (Array.isArray(node.extra)) {
      for (const item of node.extra) collectTextParts(item, parts);
    }
    return;
  }

  // { translate: '...', with: [...] }
  if (typeof node.translate === 'string') {
    if (Array.isArray(node.with)) {
      for (const item of node.with) collectTextParts(item, parts);
    }
    return;
  }

  // node.value ob'ekt bo'lsa
  if (node.value && typeof node.value === 'object') {
    collectTextParts(node.value, parts, key);
    return;
  }

  // Umumiy fallback
  for (const [childKey, child] of Object.entries(node)) {
    collectTextParts(child, parts, childKey);
  }
}

/**
 * Turli xil text formatlarini string'ga aylantiradi.
 * @param {any} text
 * @returns {string}
 */
function formatRawText(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (typeof text.toMotd === 'function') return text.toMotd();
  if (typeof text.toString === 'function') return text.toString();
  return JSON.stringify(text);
}

/**
 * String ichida Unicode apostrophe va shunga o'xshash belgilarni normallashtiradi.
 * Masalan: \u2018 (') → ' (oddiy apostrof)
 * @param {string} str
 * @returns {string}
 */
function normalizeQuotes(str) {
  if (typeof str !== 'string') return String(str || '');
  return str
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")  // Turli apostrof shakllari
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');  // Turli qo'shtirnoq shakllari
}

module.exports = {
  formatPosition,
  formatReason,
  stripControlCodes,
  collectTextParts,
  formatRawText,
  normalizeQuotes,
};
