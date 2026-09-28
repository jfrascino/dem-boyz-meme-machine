// DOM-free: use the same renderer in the preview, export loop and export worker.
export const OVERLAY_FONTS = Object.freeze({
  Impact: 'Impact, "Arial Narrow", sans-serif',
  Arial: 'Arial, sans-serif',
  Georgia: 'Georgia, serif',
});
export const OVERLAY_STICKERS = Object.freeze(['', '🤡', '💸', '🚫', '⭐']);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const number = (value, fallback) => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback;

export function overlayDefaults() {
  return {
    font: 'Impact', color: '#ffffff', size: .072, safeInset: .05,
    top: { x: .5, y: null, start: 0, end: null },
    bottom: { x: .5, y: null, start: 0, end: null },
    sticker: { value: '', x: .5, y: .5, size: .16, start: 0, end: null },
  };
}

export function normalizeOverlays(settings = {}) {
  const defaults = overlayDefaults(), raw = settings.overlays || {};
  const result = { ...defaults, ...raw };
  result.font = Object.hasOwn(OVERLAY_FONTS, raw.font) ? raw.font : defaults.font;
  result.color = /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color.toLowerCase() : defaults.color;
  result.size = clamp(number(raw.size, defaults.size), .025, .16);
  result.safeInset = clamp(number(raw.safeInset, defaults.safeInset), 0, .25);
  for (const key of ['top', 'bottom', 'sticker']) {
    const item = raw[key] || {}, fallback = defaults[key];
    const start = Math.max(0, number(item.start, fallback.start));
    result[key] = {
      ...fallback, ...item,
      x: clamp(number(item.x, fallback.x), 0, 1),
      y: item.y == null || item.y === '' ? fallback.y : clamp(number(item.y, fallback.y), 0, 1),
      start, end: item.end == null || item.end === '' ? null : Math.max(start, number(item.end, start)),
    };
  }
  result.sticker.value = OVERLAY_STICKERS.includes(result.sticker.value) ? result.sticker.value : '';
  result.sticker.size = clamp(number(result.sticker.size, .16), .04, .4);
  return result;
}

function wrap(ctx, text, maxWidth) {
  const lines = []; let line = '';
  for (const word of text.toUpperCase().trim().split(/\s+/u)) {
    if (ctx.measureText(word).width > maxWidth) {
      if (line) lines.push(line);
      let part = '';
      for (const char of word) {
        if (part && ctx.measureText(part + char).width > maxWidth) { lines.push(part); part = ''; }
        part += char;
      }
      line = part;
    } else {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; }
      else line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function place(key, width, height, boxWidth, boxHeight, item, inset) {
  const left = width * inset, top = height * inset;
  const maxWidth = Math.max(0, width - 2 * left), maxHeight = Math.max(0, height - 2 * top);
  boxWidth = Math.min(boxWidth, maxWidth); boxHeight = Math.min(boxHeight, maxHeight);
  const defaultY = key === 'top' ? top + boxHeight / 2 : key === 'bottom' ? height - top - boxHeight / 2 : height / 2;
  const centerX = clamp(item.x * width, left + boxWidth / 2, width - left - boxWidth / 2);
  const centerY = clamp(item.y == null ? defaultY : item.y * height, top + boxHeight / 2, height - top - boxHeight / 2);
  return { key, x: centerX - boxWidth / 2, y: centerY - boxHeight / 2, width: boxWidth, height: boxHeight, centerX, centerY, normalizedX: centerX / width, normalizedY: centerY / height };
}

function active(item, sourceTime) {
  return sourceTime >= item.start && (item.end == null || sourceTime < item.end);
}

// Returned bounds are in canvas pixels and include the text outline. Empty and
// inactive overlays are omitted. Timing is always absolute source-video time.
export function layoutOverlays(ctx, width, height, settings = {}, sourceTime = 0) {
  if (!(width > 0 && height > 0)) return [];
  const style = normalizeOverlays(settings), layouts = [];
  const availableWidth = width * (1 - style.safeInset * 2);
  const availableHeight = height * (1 - style.safeInset * 2);
  ctx.save();
  for (const key of ['top', 'bottom']) {
    const text = String(settings[key] || '').trim(), item = style[key];
    if (!text || !active(item, sourceTime)) continue;
    let size = Math.min(Math.max(12, width * style.size), availableHeight), lines, lineHeight, stroke;
    // Fit the complete caption, including very long words and many lines.
    for (;;) {
      ctx.font = `900 ${size}px ${OVERLAY_FONTS[style.font]}`;
      stroke = size * .11; lineHeight = size * 1.12;
      lines = wrap(ctx, text, Math.max(1, availableWidth - stroke));
      const fits = lines.length * lineHeight + stroke <= Math.min(height * .35, availableHeight)
        && lines.every(line => ctx.measureText(line).width + stroke <= availableWidth);
      if (fits || size <= 1) break;
      size = Math.max(1, size - 1);
    }
    const boxWidth = Math.max(...lines.map(line => ctx.measureText(line).width), 0) + stroke;
    const boxHeight = lines.length * lineHeight + stroke;
    layouts.push({ ...place(key, width, height, boxWidth, boxHeight, item, style.safeInset), lines, size, lineHeight, stroke, font: ctx.font, color: style.color });
  }
  if (style.sticker.value && active(style.sticker, sourceTime)) {
    const item = style.sticker;
    let size = Math.min(width * item.size, availableHeight / 1.3, availableWidth);
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    const measured = ctx.measureText(item.value).width;
    if (measured > availableWidth) size *= availableWidth / measured;
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    layouts.push({ ...place('sticker', width, height, ctx.measureText(item.value).width, size * 1.3, item, style.safeInset), value: item.value, font: ctx.font, size });
  }
  ctx.restore();
  return layouts;
}

export function drawOverlays(ctx, width, height, settings = {}, sourceTime = 0) {
  const layouts = layoutOverlays(ctx, width, height, settings, sourceTime);
  ctx.save();
  for (const item of layouts) {
    // Clip as a final guard for extreme text lengths and platform font metrics.
    const inset = normalizeOverlays(settings).safeInset;
    ctx.save(); ctx.beginPath(); ctx.rect(width * inset, height * inset, width * (1 - 2 * inset), height * (1 - 2 * inset)); ctx.clip();
    ctx.font = item.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (item.key === 'sticker') ctx.fillText(item.value, item.centerX, item.centerY);
    else {
      ctx.lineJoin = 'round'; ctx.lineWidth = item.stroke; ctx.strokeStyle = '#000000'; ctx.fillStyle = item.color;
      item.lines.forEach((line, index) => {
        const y = item.y + item.stroke / 2 + item.lineHeight * (index + .5);
        ctx.strokeText(line, item.centerX, y); ctx.fillText(line, item.centerX, y);
      });
    }
    ctx.restore();
  }
  ctx.restore();
  return layouts;
}
