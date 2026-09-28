# Pinned GIF decoder fallback

Prepared 2026-09-28. The four `.mjs` files are a local browser ESM distribution of `gifuct-js@2.1.2` with its pinned `js-binary-schema-parser@2.0.3` dependency. Total JS: 11,802 bytes. Copy all four files together, and retain both LICENSE files. Import `parseGIF` and `decompressFrame` from `./gifuct-js-2.1.2.mjs`. No network, package install, WASM, or runtime build is required.

`provenance.json` records the exact jsDelivr URLs, original SHA-256 hashes, final SHA-256 hashes, and transformations. Only import URLs, sourcemap comments, and attribution headers changed; decoder logic is unchanged. Both packages are MIT, Copyright (c) 2015 Matt Way.

Upstream: https://github.com/matt-way/gifuct-js and https://github.com/matt-way/jsBinarySchemaParser

## Standalone implemented adapter

`gif-source.js` exports `createGifSource(file, {signal})` and `GIF_LIMITS`. It uses the fallback decoder consistently in every browser; it does not require ImageDecoder. It is authored integration code, separate from the unchanged vendored modules.

```js
import {createGifSource} from './gif-source.js';
const source = await createGifSource(file, {signal});
source.currentTime = 1.2; // drawable updates immediately; seeked follows in a microtask
ctx.drawImage(source.drawable, 0, 0);
await source.play();
source.pause();
const thumbnail = source.getThumbnail(.5); // JPEG data URL, does not seek source
source.destroy();
```

The EventTarget source has `videoWidth`, `videoHeight` (working resolution), `originalWidth`, `originalHeight`, `duration`, `readyState`, `seeking`, `paused`, `ended`, `playbackRate`, `currentTime`, and `drawable`. Events: seeking, timeupdate, seeked, play, playing, pause, ended, ratechange. It stops at the end of one cycle; the editor owns looping. `play()` at the end restarts from zero. `frameStarts`, `frameDelays` and `frames` use seconds; each frame additionally preserves `rawDelayMs`. Positive delays, including 10 ms, are preserved; missing or zero delays use 100 ms. The original GIF loop count is deliberately not used to limit editing/playback.

The adapter performs a strict bounded GIF structural scan before decompression and validates the LZW stream before entering the vendor decoder. It validates palettes, offsets, complete pixel count, dictionary references, subblock lengths and trailer. It rejects user-interactive/plain-text rendering extensions, unsupported disposal, invalid or truncated data, >100,000 structural blocks, and >100 million total patch pixels in addition to the published byte/frame/duration/dimension limits. Decompression is sequential and the loop yields between frames; the LZW validator also yields periodically. Cancellation takes effect at those task boundaries.

The 64 MiB budget covers owned RGBA caches, canvases and composition scratch. It is not a promise that the entire browser heap stays below 64 MiB: compressed data, transient vendor JS index arrays, renderer copies, and browser overhead are additional. Every source allocation is dimension-bounded; working resolution is downscaled dynamically. `source.pixelBytes` exposes the conservative pixel-storage estimate.

`test-gif-source.cjs` has 53 passing isolated Chromium checks, including disposal 2/3, transparent/offset patches, interlacing, preserved control metadata through multiple comments, asynchronous seek events, thumbnails, replay/ended/pause, cancellation, malformed LZW and other resource limits. Five synthetic frames and first/middle/last frames of a real compressed GIF match native ImageDecoder pixels exactly. The real-GIF regression uses an existing local fixture when available; all synthetic tests are self-contained. Tests do not contact the site or network. Run `node work/gif-decode-vendor/test-gif-source.cjs` from the workspace root (the script uses the installed Playwright runtime).

## Recommended studio integration

Use a common timed-source abstraction for videos and GIFs: source dimensions, duration, currentTime, ready/seeking state, and a canvas/image at a requested time. The existing `renderVideoFrame` already has the right crop/caption pipeline; generalize its dimension lookup and `drawImage` argument. `video-trimmer.js` currently directly owns an HTMLVideoElement and separately decodes thumbnails with another video element; make the source adapter and thumbnail provider replaceable. Keep the same source-time timeline and binary-search GIF frame boundaries during scrubbing, reverse and ping-pong. Keep the original GIF Blob in editable projects.

Native path, when feature detection succeeds:

```js
const useNative = typeof ImageDecoder !== 'undefined' &&
  await ImageDecoder.isTypeSupported('image/gif');
const decoder = new ImageDecoder({type:'image/gif', data:bytes, preferAnimation:true});
await decoder.tracks.ready;
await decoder.completed;
const count = decoder.tracks.selectedTrack.frameCount;
const {image} = await decoder.decode({frameIndex:i, completeFramesOnly:true});
// image is a drawImage-compatible VideoFrame; duration/timestamp are microseconds.
try {
  ctx.clearRect(0, 0, cacheWidth, cacheHeight);
  ctx.drawImage(image, 0, 0, cacheWidth, cacheHeight);
}
finally { image.close(); }
// When loading, cancellation, or source lifetime finishes:
decoder.close();
```

Decode sequentially for bounded native cache behavior, snapshot/downscale every completed frame, then close each VideoFrame immediately. Native output already includes the dependencies of that frame; do not apply GIF disposal a second time. `desiredWidth`/`desiredHeight` are best-effort hints, not memory limits. Catch unsupported/native decode failures and use fallback. Do not mistake a static ImageBitmap or img element for a seekable decoded GIF.

Safari stable requires fallback: current MDN browser compatibility data lists ImageDecoder for Chrome 94+, Firefox 133+, and Safari preview only. Always feature-detect instead of browser sniffing.

## Fallback composition

```js
const parsed = parseGIF(arrayBuffer);
const encodedFrames = parsed.frames.filter(f => f.image);
// Validate dimensions, patch rectangles, frame count, total duration, and decoded
// memory budget here, before allocating/decompressing frame pixels.
for (const encoded of encodedFrames) {
  const frame = decompressFrame(encoded, parsed.gct, true);
  // frame.dims: {left,top,width,height}; frame.patch is RGBA;
  // frame.disposalType: 0/1 retain, 2 restore patch area, 3 restore pre-patch image.
}
```

Process frames sequentially, not `decompressFrames(parsed,true)`, which allocates every patch and pixel-index array together. Maintain one full logical-screen composite canvas. BEFORE drawing the current frame, apply the PREVIOUS frame's disposal. For disposal 2, clear only its patch rectangle (browser-compatible transparent background); do not clear the whole logical screen. For disposal 3, restore the pre-previous-frame snapshot. If the CURRENT frame's disposal is 3, save the affected region before drawing it. Put RGBA into a temporary patch canvas, then `drawImage` it over the composite with source-over. Do not `putImageData` patches directly onto the composite: transparent patch pixels must retain the previous canvas pixels. Capture the resulting full composite for seeking, then release the patch/pixel arrays.

The GIF spec describes disposal 2 as restoring the logical background color. Chromium-compatible rendering uses transparent restoration; Chromium/Skia historically ignore the palette background. Test transparent, offset-patch, disposal-2 and disposal-3 fixtures against native ImageDecoder. Do not copy upstream's minimal demo compositor without fixing disposal behavior.

Timing: raw `encoded.gce.delay` is centiseconds; multiply by 10 for milliseconds. gifuct itself changes delay 0 to 100 ms but leaves 10 ms unchanged. Choose one policy shared by both paths: preserve positive encoded delays exactly and use an explicit 100 ms default for absent/zero delay, or normalize 0/10 ms to 100 ms for browser-playback parity. Do not silently use a uniform FPS timeline for preview. Keep raw delay metadata separately if normalization is used.

## Exports

The current `framePlan()` resamples uniformly. To preserve GIF timing, generate source-frame spans intersected with the trim interval, divide each duration by speed, then reorder the spans for reverse/ping-pong. GIF supports variable per-frame delays: pass each span's duration to `gifenc.writeFrame`. Round CUMULATIVE boundaries to 10 ms and derive individual delays, avoiding rounding drift; extremely short durations after 2x may require merging frames. MP4 can use cumulative microsecond VideoFrame timestamps/durations; if the existing exporter deliberately resamples to selected FPS, use the original variable-delay frame lookup for each sample, preserve total duration, and make the resampling behavior explicit. Render full opaque output frames over the existing navy studio matte for stable GIF/MP4 exports.

## Suggested app limits (product choices, not codec guarantees)

- GIF upload: 20 MiB maximum, matching editable project source storage.
- Logical dimensions: at most 2048 per axis and 2 million total pixels. Validate each patch rectangle and LZW input before decode; never allocate from unchecked dimensions.
- Source: at most 300 frames, 30 seconds per cycle; edit selection remains 0.2–8 seconds. Reject oversized input with a clear message rather than silently truncating its animation.
- Frame cache: budget 64 MiB RGBA and choose cache scale <= min(1, 720/max(width,height), sqrt(64MiB/(4*width*height*frameCount))). Show actual working resolution when scaling is needed. This budget excludes parser bytes, transient patch arrays, canvases, GPU copies, and encoder buffers.
- Decompress one frame at a time, preferably in one dedicated worker with cancellation via terminate. Main-thread fallback must yield between frames; one large malformed/complex frame can still block, so worker isolation is preferable.
- Close all VideoFrame/ImageBitmap resources and decoder on source replacement/cancel. Release cached frames and object URLs. Keep an abort/generation token so stale loads cannot replace a newer source.

## Verification performed

Node ESM import succeeds using only the local files. Parsed and decompressed a local 480x270, 21-frame GIF; all 21 patches were exactly width*height*4 bytes and source cycle duration was 840 ms. Every vendored hash was verified and no remote module imports remain. This is a decoder asset smoke check, not an end-to-end compositor or Safari test.

## Primary references

- API: https://developer.mozilla.org/en-US/docs/Web/API/ImageDecoder
- Support data: https://github.com/mdn/browser-compat-data/blob/main/api/ImageDecoder.json
- WebCodecs: https://w3c.github.io/webcodecs/#imagedecoder-interface
- Native duration/random-access tests: https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/refs/tags/merge_pr_38114/webcodecs/image-decoder.https.any.js
- GIF89a disposal/timing/transparency: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
- Fallback API and patch structure: https://github.com/matt-way/gifuct-js
- Native resource/cache implementation: https://chromium.googlesource.com/chromium/src/+/c3756773b1039618747068cee1080fd09f75f24e/third_party/blink/renderer/modules/webcodecs/image_decoder_core.cc
- Chromium-compatible transparent disposal: https://skia.googlesource.com/skia/+/19b91531e912283d237435d94516575b28713cba/src/codec/SkGifCodec.cpp
