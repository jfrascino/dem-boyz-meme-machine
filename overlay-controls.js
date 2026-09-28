import { layoutOverlays, normalizeOverlays, OVERLAY_FONTS, OVERLAY_STICKERS } from './overlay-render.js';

let instance = 0;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function mountOverlayControls(container, canvas, { getSettings, onChange, getDuration, getSourceTime = () => 0 }) {
  const prefix = `overlay-${++instance}`, controller = new AbortController();
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: controller.signal });
  let state = normalizeOverlays(getSettings()), selected = 'top', dragging = null, disabled = false;
  const previous = { tabindex: canvas.getAttribute('tabindex'), role: canvas.getAttribute('role'), description: canvas.getAttribute('aria-describedby'), touchAction: canvas.style.touchAction, cursor: canvas.style.cursor };
  const field = (label, html) => `<label class="overlay-field"><span>${label}</span>${html}</label>`;
  const number = (name, label, extra = '') => field(label, `<input data-overlay="${name}" type="number" step="0.01" min="0" ${extra}>`);
  container.classList.add('overlay-controls');
  container.innerHTML = `<fieldset class="overlay-settings"><legend>Caption style & placement</legend>
    <div class="overlay-row">${field('Font', `<select data-overlay="font">${Object.keys(OVERLAY_FONTS).map(font => `<option>${font}</option>`).join('')}</select>`)}${field('Text color', '<input data-overlay="color" type="color" aria-label="Caption text color">')}${field('Hex color', '<input data-overlay="hex" type="text" maxlength="7" spellcheck="false" pattern="#[0-9a-fA-F]{6}" aria-describedby="'+prefix+'-hex-hint">')}</div>
    <span class="overlay-hint" id="${prefix}-hex-hint">Use a six-digit hex color, such as #ffffff.</span>
    <div class="overlay-row">${field('Text size', '<input data-overlay="size" type="range" min="0.025" max="0.16" step="0.001"><output data-overlay-output="size"></output>')}${field('Safe margin', '<select data-overlay="safeInset"><option value="0.05">Standard · 5%</option><option value="0.12">Extra space · 12%</option></select>')}</div>
    <div class="overlay-row">${field('Move overlay', '<select data-overlay="selected"><option value="top">Top caption</option><option value="bottom">Bottom caption</option><option value="sticker">Sticker</option></select>')}${number('x', 'Horizontal position (%)', 'max="100" step="1"')}${number('y', 'Vertical position (%)', 'max="100" step="1"')}</div>
    <div class="overlay-actions"><button type="button" data-overlay-action="reset">Reset selected position</button></div>
    <p class="overlay-hint" id="${prefix}-help">Drag a caption or sticker in the preview. With the preview focused, use arrow keys to move the selected overlay; hold Shift for larger steps. Positions stay inside the safe margin.</p>
    <div class="overlay-row">${field('Sticker', `<select data-overlay="sticker">${OVERLAY_STICKERS.map((value, i) => `<option value="${value}">${['None', '🤡 Clown', '💸 Money', '🚫 No entry', '⭐ Star'][i]}</option>`).join('')}</select>`)}${field('Sticker size', '<input data-overlay="stickerSize" type="range" min="0.04" max="0.4" step="0.01">')}</div>
    <fieldset class="overlay-timing"><legend>Show overlays at source-video times</legend><p class="overlay-hint">Seconds in the original video. Leave “Until” blank to show through the end.</p>${['top', 'bottom', 'sticker'].map(key => `<div class="overlay-time-row"><span>${key === 'top' ? 'Top caption' : key === 'bottom' ? 'Bottom caption' : 'Sticker'}</span>${number(`${key}-start`, `${key === 'top' ? 'Top caption' : key === 'bottom' ? 'Bottom caption' : 'Sticker'} from (s)`) }${number(`${key}-end`, `${key === 'top' ? 'Top caption' : key === 'bottom' ? 'Bottom caption' : 'Sticker'} until (s)`, 'placeholder="End"')}</div>`).join('')}</fieldset>
    <p class="overlay-hint" data-overlay-status role="status" aria-live="polite"></p>
  </fieldset>`;
  const $ = name => container.querySelector(`[data-overlay="${name}"]`), status = container.querySelector('[data-overlay-status]');
  const duration = () => Number.isFinite(Number(getDuration())) ? Math.max(0, Number(getDuration())) : 0;
  const isDisabled = () => disabled || !!container.closest('fieldset[disabled]');
  const read = (base = getSettings()) => ({ ...base, overlays: normalizeOverlays({ overlays: state }) });
  const layouts = () => layoutOverlays(canvas.getContext('2d'), canvas.width, canvas.height, read(), getSourceTime());
  const selectedLayout = () => layouts().find(item => item.key === selected);
  function positions() {
    const item = selectedLayout(), fallback = state[selected];
    $('x').value = ((item?.normalizedX ?? fallback.x) * 100).toFixed(1);
    $('y').value = ((item?.normalizedY ?? fallback.y ?? (selected === 'top' ? state.safeInset : 1 - state.safeInset)) * 100).toFixed(1);
  }
  function sync() {
    for (const key of ['font', 'color', 'size']) $(key).value = state[key];
    $('hex').value = state.color; $('hex').setCustomValidity('');
    // Preserve custom saved safe margins even though the usual choices are 5/12%.
    const safe = $('safeInset'); safe.querySelector('[data-custom]')?.remove();
    if (![.05, .12].includes(state.safeInset)) { const option = document.createElement('option'); option.value = String(state.safeInset); option.textContent = `Custom · ${Math.round(state.safeInset * 100)}%`; option.dataset.custom = ''; safe.append(option); }
    safe.value = String(state.safeInset);
    $('selected').value = selected; $('sticker').value = state.sticker.value; $('stickerSize').value = state.sticker.size;
    container.querySelector('[data-overlay-output="size"]').textContent = `${(state.size * 100).toFixed(1)}% of width`;
    for (const key of ['top', 'bottom', 'sticker']) for (const point of ['start', 'end']) {
      const input = $(`${key}-${point}`); input.value = state[key][point] ?? '';
      if (duration()) input.max = duration(); else input.removeAttribute('max');
    }
    positions();
  }
  function changed(message = '') { state = normalizeOverlays({ overlays: state }); sync(); onChange(read()); status.textContent = message; }
  function move(x, y) {
    state[selected] = { ...state[selected], x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    // Persist the clamped visible center so saved X/Y agree with what is shown.
    const item = selectedLayout();
    if (item) { state[selected].x = item.normalizedX; state[selected].y = item.normalizedY; }
    changed();
  }
  listen(container, 'input', event => {
    if (isDisabled()) return;
    const key = event.target.dataset.overlay;
    if (['font', 'color', 'size', 'safeInset'].includes(key)) {
      state[key] = ['size', 'safeInset'].includes(key) ? Number(event.target.value) : event.target.value; changed();
    } else if (key === 'hex') {
      const valid = /^#[0-9a-f]{6}$/i.test(event.target.value);
      event.target.setCustomValidity(valid ? '' : 'Enter # followed by six hexadecimal digits.');
      if (valid) { state.color = event.target.value.toLowerCase(); $('color').value = state.color; onChange(read()); }
    } else if (key === 'stickerSize') { state.sticker.size = Number(event.target.value); changed(); }
  });
  listen(container, 'change', event => {
    if (isDisabled()) return;
    const key = event.target.dataset.overlay;
    if (key === 'selected') { selected = event.target.value; positions(); status.textContent = `${event.target.selectedOptions[0].textContent} selected. Drag it in the preview or use position controls.`; }
    else if (key === 'sticker') { state.sticker.value = event.target.value; selected = 'sticker'; changed(); }
    else if (key === 'x' || key === 'y') {
      const item = selectedLayout(), fallback = state[selected];
      const x = key === 'x' ? Number(event.target.value) / 100 : item?.normalizedX ?? fallback.x;
      const y = key === 'y' ? Number(event.target.value) / 100 : item?.normalizedY ?? fallback.y ?? .5;
      move(x, y);
    } else if (/^(top|bottom|sticker)-(start|end)$/.test(key || '')) {
      const [which, point] = key.split('-'), value = event.target.value;
      state[which][point] = point === 'end' && value === '' ? null : Math.max(0, Number(value) || 0);
      const max = duration();
      if (max) { state[which].start = Math.min(state[which].start, Math.max(0, max - .01)); if (state[which].end != null) state[which].end = Math.min(state[which].end, max); }
      let message = '';
      if (state[which].end != null && state[which].end <= state[which].start) { state[which].end = Math.min(max || Infinity, state[which].start + .01); message = 'Until was moved just after From so the overlay has a visible interval.'; }
      changed(message);
    }
  });
  listen(container.querySelector('[data-overlay-action="reset"]'), 'click', () => {
    if (isDisabled()) return;
    state[selected] = { ...state[selected], x: .5, y: selected === 'sticker' ? .5 : null }; changed('Position reset.');
  });
  canvas.setAttribute('tabindex', '0'); canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-describedby', [previous.description, `${prefix}-help`].filter(Boolean).join(' '));
  canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab';
  const point = event => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height }; };
  listen(canvas, 'pointerdown', event => {
    if (isDisabled() || event.button !== 0) return;
    const p = point(event), item = layouts().reverse().find(item => p.x >= item.x && p.x <= item.x + item.width && p.y >= item.y && p.y <= item.y + item.height);
    if (!item) return;
    selected = item.key; dragging = { id: event.pointerId, dx: p.x - item.centerX, dy: p.y - item.centerY };
    canvas.setPointerCapture(event.pointerId); canvas.focus(); canvas.style.cursor = 'grabbing'; sync(); event.preventDefault();
  });
  listen(canvas, 'pointermove', event => {
    if (!dragging || dragging.id !== event.pointerId || isDisabled()) return;
    const p = point(event); move((p.x - dragging.dx) / canvas.width, (p.y - dragging.dy) / canvas.height);
  });
  const release = event => { if (dragging?.id !== event.pointerId) return; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); dragging = null; canvas.style.cursor = 'grab'; positions(); };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, event, release);
  listen(canvas, 'keydown', event => {
    if (isDisabled() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const item = selectedLayout();
    if (!item) { status.textContent = 'Add text or a sticker and preview a time when it is visible to move it.'; return; }
    const step = event.shiftKey ? .05 : .01;
    move(item.normalizedX + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), item.normalizedY + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
    status.textContent = `${selected === 'sticker' ? 'Sticker' : selected + ' caption'} position: ${$('x').value}% across, ${$('y').value}% down.`;
    event.preventDefault();
  });
  sync();
  return {
    read,
    apply(settings) { state = normalizeOverlays(settings); sync(); },
    refresh: sync,
    setDisabled(value) { disabled = !!value; container.querySelector('.overlay-settings').disabled = disabled; },
    destroy() { controller.abort(); if (dragging && canvas.hasPointerCapture(dragging.id)) canvas.releasePointerCapture(dragging.id); for (const [name, value] of [['tabindex', previous.tabindex], ['role', previous.role], ['aria-describedby', previous.description]]) { if (value == null) canvas.removeAttribute(name); else canvas.setAttribute(name, value); } canvas.style.touchAction = previous.touchAction; canvas.style.cursor = previous.cursor; container.replaceChildren(); container.classList.remove('overlay-controls'); },
  };
}
