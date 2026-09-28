import { decompressFrame } from './gifuct-js-2.1.2.mjs';

// Limits are per source/cycle. The pixel budget includes retained RGBA frames,
// canvases and composition scratch; JS/parser/decoder overhead is additional.
export const GIF_LIMITS = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxFrames: 300,
  maxSeconds: 30,
  maxPixels: 2_000_000,
  maxDimension: 2048,
  maxDecodedPixels: 100_000_000,
  maxBlocks: 100_000,
  pixelBytes: 64 * 1024 * 1024,
  maxWorkingEdge: 720,
});

const abortError = () => new DOMException('GIF loading cancelled.', 'AbortError');
const invalid = detail => new Error(`This GIF cannot be opened: ${detail}`);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

// A strict, bounded scan precedes gifuct's intentionally forgiving decoder.
// Carry the GCE across comments/app extensions until its image, as GIF requires.
async function scanGif(bytes, signal) {
  let pos = 0, blocks = 0, durationMs = 0, decodedPixels = 0;
  const need = n => { if (pos + n > bytes.length) throw invalid('the file is truncated.'); };
  const byte = () => { need(1); return bytes[pos++]; };
  const uint16 = () => { need(2); const n = bytes[pos] | bytes[pos + 1] << 8; pos += 2; return n; };
  const skip = n => { need(n); pos += n; };
  const block = () => { if (++blocks > GIF_LIMITS.maxBlocks) throw invalid('the file contains too many data blocks.'); };
  const palette = count => {
    need(count * 3);
    return Array.from({ length: count }, () => [byte(), byte(), byte()]);
  };
  async function subblocks(collect) {
    const spans = []; let length = 0;
    for (;;) {
      block(); const size = byte(); if (!size) break;
      need(size); if (collect) spans.push([pos, size]); length += size; pos += size;
      if (blocks % 4096 === 0) { await yieldTask(); checkAbort(signal); }
    }
    if (!collect) return;
    const data = new Uint8Array(length); let offset = 0;
    for (const [start, size] of spans) { data.set(bytes.subarray(start, start + size), offset); offset += size; }
    return data;
  }
  need(13);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') throw invalid('choose a valid GIF87a or GIF89a file.');
  pos = 6;
  const width = uint16(), height = uint16(), packed = byte();
  if (!width || !height || width > GIF_LIMITS.maxDimension || height > GIF_LIMITS.maxDimension || width * height > GIF_LIMITS.maxPixels) {
    throw invalid('use an image up to 2048 pixels per side and 2 million pixels total.');
  }
  skip(2); // Background index / pixel aspect. Browser composition starts clear.
  const globalPalette = packed & 128 ? palette(1 << ((packed & 7) + 1)) : null;
  const frames = []; let gce = null, trailer = false;
  while (pos < bytes.length) {
    checkAbort(signal); block(); const kind = byte();
    if (kind === 0x3b) { trailer = true; break; }
    if (kind === 0x21) {
      const label = byte();
      if (label === 0xf9) {
        if (byte() !== 4) throw invalid('its graphic control block is malformed.');
        const flags = byte(), delay = uint16(), transparentColorIndex = byte();
        if (byte() !== 0 || (flags >> 2 & 7) > 3) throw invalid('its disposal settings are unsupported.');
        if (flags & 2) throw invalid('interactive GIF frames are not supported.');
        gce = { delay, transparentColorIndex, extras: { disposal: flags >> 2 & 7, transparentColorGiven: !!(flags & 1) } };
      } else if (label === 0x01) {
        throw invalid('plain-text GIF frames are not supported.');
      } else {
        // Comments, application extensions and future non-rendering extensions.
        await subblocks(false);
      }
      continue;
    }
    if (kind !== 0x2c) throw invalid('the file contains an invalid block.');
    if (frames.length >= GIF_LIMITS.maxFrames) throw invalid('use a GIF with no more than 300 frames.');
    const left = uint16(), top = uint16(), patchWidth = uint16(), patchHeight = uint16(), flags = byte();
    if (!patchWidth || !patchHeight || left + patchWidth > width || top + patchHeight > height) throw invalid('a frame extends outside the image.');
    decodedPixels += patchWidth * patchHeight;
    if (decodedPixels > GIF_LIMITS.maxDecodedPixels) throw invalid('the animation is too complex; use a smaller or shorter GIF.');
    const localPalette = flags & 128 ? palette(1 << ((flags & 7) + 1)) : null;
    const colors = localPalette || globalPalette;
    if (!colors) throw invalid('a frame has no color palette.');
    if (gce?.extras.transparentColorGiven && gce.transparentColorIndex >= colors.length) throw invalid('a transparency index is outside the palette.');
    const minCodeSize = byte();
    if (minCodeSize < 2 || minCodeSize > 8) throw invalid('its LZW code size is invalid.');
    const data = await subblocks(true);
    if (!data.length) throw invalid('a frame has no image data.');
    const rawDelayMs = (gce?.delay ?? 0) * 10;
    // Preserve every positive encoded delay. A missing/zero delay gets 100 ms.
    const delayMs = rawDelayMs || 100;
    const startMs = durationMs; durationMs += delayMs;
    if (durationMs > GIF_LIMITS.maxSeconds * 1000) throw invalid('use a GIF no longer than 30 seconds per loop.');
    const descriptor = { left, top, width: patchWidth, height: patchHeight, lct: { exists: !!localPalette, interlaced: !!(flags & 64) } };
    frames.push({ encoded: { image: { descriptor, lct: localPalette, data: { minCodeSize, blocks: data } }, gce }, colors, startMs, delayMs, rawDelayMs });
    gce = null;
  }
  if (!trailer || !frames.length) throw invalid('the file has no complete animation.');
  return { width, height, globalPalette, frames, duration: durationMs / 1000 };
}

// Validate dictionary references and output length before passing untrusted LZW
// to gifuct. Increasing dictionary references cannot create a prefix cycle.
// The upstream decoder otherwise tolerates truncated/invalid bit streams.
async function validateLzw(frame, signal) {
  const { minCodeSize, blocks: data } = frame.encoded.image.data;
  const expected = frame.encoded.image.descriptor.width * frame.encoded.image.descriptor.height;
  const clear = 1 << minCodeSize, end = clear + 1;
  const lengths = new Uint32Array(4096);
  for (let i = 0; i < clear; i++) lengths[i] = 1;
  let size = minCodeSize + 1, next = clear + 2, previous = -1;
  let bit = 0, output = 0, codes = 0, complete = false;
  while (bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= (data[bit >> 3] >> (bit & 7) & 1) << i;
    if (++codes % 16384 === 0) { await yieldTask(); checkAbort(signal); }
    if (code === clear) { size = minCodeSize + 1; next = clear + 2; previous = -1; continue; }
    if (code === end) { complete = true; break; }
    let length;
    if (code < clear) {
      if (code >= frame.colors.length) throw invalid('an image index is outside its color palette.');
      length = 1;
    } else if (previous !== -1 && code < next) {
      length = lengths[code];
    } else if (previous !== -1 && code === next && next < 4096) {
      length = lengths[previous] + 1;
    } else throw invalid('its image data contains an invalid LZW reference.');
    output += length;
    if (output > expected) throw invalid('a frame expands beyond its declared size.');
    if (previous !== -1 && next < 4096) {
      lengths[next++] = lengths[previous] + 1;
      if (next === 1 << size && next < 4096) size++;
    }
    previous = code;
  }
  if (!complete || output !== expected) throw invalid('a frame has incomplete image data.');
}

function canvas(width, height) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  return element;
}

function context(element) {
  const ctx = element.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas rendering is unavailable in this browser.');
  return ctx;
}

function findFrame(frames, time) {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (frames[mid].start <= time) lo = mid; else hi = mid - 1; }
  return lo;
}

class GifSource extends EventTarget {
  constructor(decoded, images, drawable, pixelBytes) {
    super();
    this.kind = 'gif'; this.drawable = drawable;
    this.videoWidth = drawable.width; this.videoHeight = drawable.height;
    this.originalWidth = decoded.width; this.originalHeight = decoded.height;
    this.duration = decoded.duration; this.readyState = 4; this.seeking = false;
    this.frames = Object.freeze(decoded.frames.map((f, index) => Object.freeze({
      index, start: f.startMs / 1000, delay: f.delayMs / 1000,
      duration: f.delayMs / 1000, end: (f.startMs + f.delayMs) / 1000,
      rawDelayMs: f.rawDelayMs, disposal: f.encoded.gce?.extras.disposal ?? 0,
    })));
    this.frameStarts = Object.freeze(this.frames.map(f => f.start));
    this.frameDelays = Object.freeze(this.frames.map(f => f.delay));
    this.frameCount = images.length; this.pixelBytes = pixelBytes;
    this._images = images; this._ctx = context(drawable); this._index = -1;
    this._time = 0; this._rate = 1; this._paused = true; this._raf = 0;
    this._destroyed = false; this._seekToken = 0; this._lastTick = 0;
    this._tick = this._tick.bind(this); this._draw(0);
  }
  get paused() { return this._paused; }
  get ended() { return this._time >= this.duration; }
  get currentTime() { return this._time; }
  set currentTime(value) {
    this._assertAlive(); const time = Number(value);
    if (!Number.isFinite(time)) throw new TypeError('GIF seek time must be finite.');
    const token = ++this._seekToken;
    this.seeking = true; this._emit('seeking');
    if (this._destroyed || token !== this._seekToken) return;
    this._time = clamp(time, 0, this.duration); this._lastTick = performance.now(); this._draw(this._time);
    queueMicrotask(() => {
      if (this._destroyed || token !== this._seekToken) return;
      this.seeking = false; this._emit('timeupdate');
      if (!this._destroyed && token === this._seekToken) this._emit('seeked');
    });
  }
  get playbackRate() { return this._rate; }
  set playbackRate(value) {
    this._assertAlive(); const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 16) throw new RangeError('GIF playback rate must be greater than 0 and at most 16.');
    this._rate = rate; this._lastTick = performance.now(); this._emit('ratechange');
  }
  _assertAlive() { if (this._destroyed) throw new DOMException('This GIF source has been destroyed.', 'InvalidStateError'); }
  _emit(type) { this.dispatchEvent(new Event(type)); }
  _draw(time) {
    const index = findFrame(this.frames, time);
    if (index !== this._index) { this._ctx.putImageData(this._images[index], 0, 0); this._index = index; }
  }
  async play() {
    this._assertAlive(); if (!this._paused) return;
    if (this.ended) this.currentTime = 0;
    this._paused = false; this._lastTick = performance.now(); this._emit('play');
    if (!this._paused && !this._destroyed) this._emit('playing');
    if (!this._paused && !this._destroyed && !this._raf) this._raf = requestAnimationFrame(this._tick);
  }
  pause() {
    cancelAnimationFrame(this._raf); this._raf = 0;
    if (!this._paused) { this._paused = true; this._emit('pause'); }
  }
  _tick(now) {
    this._raf = 0; if (this._paused || this._destroyed) return;
    this._time = Math.min(this.duration, this._time + Math.max(0, now - this._lastTick) / 1000 * this._rate);
    this._lastTick = now; this._draw(this._time);
    const reachedEnd = this.ended;
    if (reachedEnd) this._paused = true;
    this._emit('timeupdate');
    if (this._destroyed) return;
    // A timeupdate listener may seek or restart playback at the loop boundary.
    if (reachedEnd && this.ended && this._paused) { this._emit('pause'); if (!this._destroyed) this._emit('ended'); return; }
    if (!this._paused && !this._raf) this._raf = requestAnimationFrame(this._tick);
  }
  getThumbnail(time, width = 160) {
    this._assertAlive();
    if (!Number.isFinite(Number(time))) throw new TypeError('GIF thumbnail time must be finite.');
    width = Math.round(Number(width));
    if (!Number.isFinite(width) || width < 1 || width > 720) throw new RangeError('Thumbnail width must be between 1 and 720.');
    width = Math.max(1, Math.round(Math.min(width, 720 * this.videoWidth / this.videoHeight)));
    const height = Math.max(1, Math.min(720, Math.round(width * this.videoHeight / this.videoWidth)));
    const thumb = canvas(width, height), ctx = context(thumb);
    const frame = canvas(this.videoWidth, this.videoHeight);
    try {
      context(frame).putImageData(this._images[findFrame(this.frames, clamp(Number(time), 0, this.duration))], 0, 0);
      ctx.fillStyle = '#061426'; ctx.fillRect(0, 0, width, height); ctx.drawImage(frame, 0, 0, width, height);
      return thumb.toDataURL('image/jpeg', .75);
    } finally { frame.width = frame.height = thumb.width = thumb.height = 0; }
  }
  destroy() {
    if (this._destroyed) return;
    this._destroyed = true; this._seekToken++; this.pause(); this._unsubscribe?.();
    this.seeking = false; this.readyState = 0; this._images.length = 0;
    this.drawable.width = this.drawable.height = 0; this._ctx = null;
  }
}

/** Decode one GIF cycle into a bounded, seekable, media-like canvas source. */
export async function createGifSource(file, { signal } = {}) {
  checkAbort(signal);
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size < 13) throw invalid('choose a GIF file.');
  if (file.size > GIF_LIMITS.maxBytes) throw invalid('choose a GIF smaller than 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()); checkAbort(signal);
  if (bytes.byteLength > GIF_LIMITS.maxBytes) throw invalid('choose a GIF smaller than 20 MB.');
  const decoded = await scanGif(bytes, signal); checkAbort(signal);
  // Four source-size RGBA surfaces cover composition, disposal restore, patch
  // canvas and patch ImageData. Leave room for cached frames + two working-size
  // canvases + one thumbnail. Decoder index arrays are transient JS overhead.
  const scratchBytes = decoded.width * decoded.height * 16;
  const available = GIF_LIMITS.pixelBytes - scratchBytes - 720 * 720 * 4;
  const scale = Math.min(1, GIF_LIMITS.maxWorkingEdge / Math.max(decoded.width, decoded.height),
    Math.sqrt(available / (4 * decoded.width * decoded.height * (decoded.frames.length + 3))));
  const width = Math.max(1, Math.floor(decoded.width * scale)), height = Math.max(1, Math.floor(decoded.height * scale));
  const composite = canvas(decoded.width, decoded.height), ctx = context(composite);
  const patch = canvas(1, 1), patchCtx = context(patch), working = canvas(width, height), workingCtx = context(working);
  const images = []; let previous, restore, source;
  try {
    for (const frame of decoded.frames) {
      checkAbort(signal); await validateLzw(frame, signal); checkAbort(signal);
      if (previous?.disposalType === 2) {
        const d = previous.dims; ctx.clearRect(d.left, d.top, d.width, d.height);
      } else if (previous?.disposalType === 3 && restore) {
        ctx.putImageData(restore, previous.dims.left, previous.dims.top);
      }
      restore = null;
      let unpacked = decompressFrame(frame.encoded, decoded.globalPalette, true);
      const d = unpacked.dims;
      if (unpacked.disposalType === 3) restore = ctx.getImageData(d.left, d.top, d.width, d.height);
      patch.width = d.width; patch.height = d.height;
      patchCtx.putImageData(new ImageData(unpacked.patch, d.width, d.height), 0, 0);
      ctx.drawImage(patch, d.left, d.top);
      workingCtx.clearRect(0, 0, width, height); workingCtx.drawImage(composite, 0, 0, width, height);
      images.push(workingCtx.getImageData(0, 0, width, height));
      previous = { dims: d, disposalType: unpacked.disposalType };
      unpacked = null; frame.encoded.image.data.blocks = null;
      await yieldTask();
    }
    checkAbort(signal);
    const pixelBytes = scratchBytes + (images.length + 3) * width * height * 4 + 720 * 720 * 4;
    source = new GifSource(decoded, images, working, pixelBytes);
    if (signal) {
      const abort = () => source.destroy(); signal.addEventListener('abort', abort, { once: true });
      source._unsubscribe = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) { source.destroy(); throw abortError(); }
    }
    return source;
  } finally {
    composite.width = composite.height = patch.width = patch.height = 0;
    restore = null;
    if (!source) { images.length = 0; working.width = working.height = 0; }
  }
}
