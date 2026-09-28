import test from 'node:test';
import assert from 'node:assert/strict';
import { drawOverlays, layoutOverlays, normalizeOverlays, overlayDefaults } from '../overlay-render.js';

// Deliberately variable glyph widths exercise wrapping rather than exact pixels.
function context() {
  let depth = 0; const calls = [];
  return { font: '', save() { depth++; }, restore() { depth--; }, beginPath() {}, rect() {}, clip() {},
    measureText(text) { const size = Number(this.font.match(/([\d.]+)px/)[1]); return { width: [...text].reduce((sum, char) => sum + (char === 'W' ? .9 : char === 'I' ? .25 : .55) * size, 0) }; },
    fillText(...args) { calls.push(args); }, strokeText() {}, get depth() { return depth; }, calls };
}

test('legacy captions keep default top and bottom margins without requiring new settings', () => {
  const ctx = context(), items = layoutOverlays(ctx, 480, 270, { top: 'top', bottom: 'bottom' });
  assert.equal(items[0].centerX, 240); assert.ok(Math.abs(items[0].y - 270 * .05) < 1e-8);
  assert.ok(Math.abs(items[1].y + items[1].height - 270 * .95) < 1e-8); assert.equal(ctx.depth, 0);
});

test('long text and moved overlays stay inside both safe margin presets in all common aspects', () => {
  for (const safeInset of [.05, .12]) for (const [width, height] of [[720, 1280], [1280, 720], [480, 480], [320, 180]]) {
    const items = layoutOverlays(context(), width, height, {
      top: 'W'.repeat(120), bottom: 'LONG CAPTION '.repeat(10),
      overlays: { safeInset, size: .16, top: { x: 0, y: 0 }, bottom: { x: 1, y: 1 }, sticker: { value: '🤡', x: 1, y: 0, size: .4 } },
    });
    assert.equal(items.length, 3);
    for (const item of items) {
      assert.ok(item.x >= width * safeInset - 1e-8); assert.ok(item.y >= height * safeInset - 1e-8);
      assert.ok(item.x + item.width <= width * (1 - safeInset) + 1e-8);
      assert.ok(item.y + item.height <= height * (1 - safeInset) + 1e-8);
    }
  }
});

test('absolute timing works when source frames run backward or ping-pong', () => {
  const settings = { top: 'NOW', bottom: 'LATER', overlays: { top: { start: 12, end: 14 }, bottom: { start: 14, end: null } } };
  const keys = [15, 14, 13, 12, 11, 12, 13, 14].map(time => layoutOverlays(context(), 480, 270, settings, time).map(x => x.key));
  assert.deepEqual(keys, [['bottom'], ['bottom'], ['top'], ['top'], [], ['top'], ['top'], ['bottom']]);
});

test('settings normalize invalid values and preserve forward-compatible overlay data', () => {
  const saved = { overlays: { font: 'bogus', color: 'red', size: Infinity, future: 'keep', top: { x: -1, y: 2, start: -2, extra: true } } };
  const state = normalizeOverlays(saved); assert.equal(state.font, 'Impact'); assert.equal(state.color, '#ffffff');
  assert.equal(state.size, .072); assert.equal(state.future, 'keep'); assert.equal(state.top.extra, true);
  assert.equal(state.top.x, 0); assert.equal(state.top.y, 1); assert.equal(state.top.start, 0);
  assert.notEqual(overlayDefaults().top, overlayDefaults().top);
});

test('rendering applies selected font/color and restores context balance', () => {
  const ctx = context(); const items = drawOverlays(ctx, 480, 270, { top: 'caption', overlays: { font: 'Georgia', color: '#abcdef' } });
  assert.equal(ctx.depth, 0); assert.ok(items[0].font.includes('Georgia')); assert.equal(items[0].color, '#abcdef');
  assert.equal(ctx.calls[0][0], 'CAPTION');
});
