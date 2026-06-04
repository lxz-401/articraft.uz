function formatPosition(position) {
  if (!position) return null;
  return `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`;
}

function formatReason(reason) {
  if (typeof reason === 'string') return reason;
  const parts = [];
  collectTextParts(reason, parts);
  return parts.length > 0 ? parts.join('').trim() : JSON.stringify(reason);
}

function stripControlCodes(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\u00a7[0-9a-fk-or]/gi, '');
}

function collectTextParts(node, parts, key = '') {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'string' && typeof node.value === 'string') {
    if (key !== 'color') parts.push(node.value);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectTextParts(item, parts);
    return;
  }
  if (node.type === 'list' && node.value?.value) {
    collectTextParts(node.value.value, parts);
    return;
  }
  if (node.type === 'compound' && node.value) {
    for (const [childKey, child] of Object.entries(node.value)) {
      collectTextParts(child, parts, childKey);
    }
    return;
  }
  if (node.value && typeof node.value === 'object') {
    collectTextParts(node.value, parts, key);
    return;
  }
  for (const [childKey, child] of Object.entries(node)) {
    collectTextParts(child, parts, childKey);
  }
}

function formatRawText(text) {
  if (!text) return '';
  if (typeof text === 'string') return text;
  if (text.toMotd) return text.toMotd();
  if (text.toString) return text.toString();
  return JSON.stringify(text);
}

module.exports = {
  formatPosition,
  formatReason,
  stripControlCodes,
  collectTextParts,
  formatRawText
};
