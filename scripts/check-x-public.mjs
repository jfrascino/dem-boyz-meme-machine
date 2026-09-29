import assert from 'node:assert/strict';
import { requestX } from '../x-public-api.js';

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let nextId = 90000, assertions = 0;
const fresh = () => String(nextId++);
const link = id => `https://x.com/example/status/${id}`;
const api = id => `https://api.fxtwitter.com/2/status/${id}`;
const mediaURL = 'https://video.twimg.com/test/clip.mp4?tag=1';
const photoURL = 'https://pbs.twimg.com/media/example_photo.jpg?name=orig';
const photo = (url = photoURL) => ({ type: 'photo', url, width: 1200, height: 800 });
const fixture = (id, extra = {}) => ({ code: 200, status: { id, text: 'Cowboys reaction', author: { screen_name: 'example' }, media: { videos: [{ type: 'video', url: mediaURL, width: 1280, height: 720, duration: 4, ...extra }] } } });
const response = (id, extra) => Response.json(fixture(id, extra));
const mp4 = () => new Response(new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]), { headers: { 'Content-Type': 'video/mp4' } });
const imageBytes = {
  'image/jpeg': new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]),
  'image/png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  'image/webp': new Uint8Array([82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80])
};
const photoResponse = (id, photos = [photo()]) => Response.json({ ...fixture(id), status: { ...fixture(id).status, media: { photos } } });
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const ok = value => { assert.ok(value); assertions++; };
const status = async (result, expected, message) => { equal(result.status, expected); const data = await result.json(); ok(data.error.includes(message)); };

try {
  // Invalid user URLs cannot cause arbitrary network requests.
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected request'); };
  for (const url of ['http://x.com/u/status/12345', 'https://x.com.evil.test/u/status/12345', 'https://user:pass@x.com/u/status/12345', 'https://x.com:444/u/status/12345', 'https://x.com/u', 'https://x.com/u/status/1234', 'https://twitter.com/u/status/1e500', 'https://example.com/u/status/12345', 'x'.repeat(2049)]) {
    equal((await requestX('/api/import/x', { url })).status, 400);
  }
  equal((await requestX('/api/other', { url: link(fresh()) })).status, 404);
  equal((await requestX('/api/import/x', null)).status, 400);
  equal((await requestX('/api/import/x/media', { url: link(fresh()), index: 4 })).status, 400);
  equal(calls, 0);

  // Canonical post identity, manageable H.264 variant, and simple CORS requests.
  const id = fresh(), requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === api(id)) return response(id, { formats: [
      { url: 'https://evil.test/clip.mp4', bitrate: 2000000, codec: 'h264' },
      { url: 'https://video.twimg.com/test/small.mp4', bitrate: 256000, codec: 'h264' },
      { url: mediaURL, bitrate: 2000000, codec: 'h264' },
      { url: 'https://video.twimg.com/test/huge.mp4', bitrate: 10000000, codec: 'h264' }
    ] });
    equal(url, mediaURL);
    return mp4();
  };
  const post = await (await requestX('/api/import/x', { url: `https://mobile.twitter.com/example/status/${id}/video/1?foo=bar` })).json();
  equal(post.id, id); equal(post.url, `https://x.com/i/status/${id}`); equal(post.media[0].index, 0); equal(post.media[0].src, undefined);
  const clip = await requestX('/api/import/x/media', { url: post.url, index: 0 });
  equal(clip.status, 200); equal(clip.headers.get('content-type'), 'video/mp4'); equal((await clip.blob()).size, 16);
  equal(requests.length, 2);
  for (const { options } of requests) {
    equal(options.method, 'GET'); equal(options.credentials, 'omit'); equal(options.mode, 'cors'); equal(options.redirect, 'error');
    equal(Object.keys(options.headers), ['Accept']); equal(options.referrerPolicy, 'no-referrer');
  }

  // Mixed posts use `all` ordering, without duplicating the typed arrays.
  {
    const id = fresh(), video = fixture(id).status.media.videos[0];
    const all = [photo(), { ...video, type: 'gif' }, photo('https://pbs.twimg.com/media/second?format=png&name=orig'), video];
    const mixed = fixture(id); mixed.status.media = { all, photos: [all[0], all[2]], videos: [all[1], all[3]] };
    const fetched = [];
    globalThis.fetch = async (url, options) => {
      fetched.push(url);
      if (url === api(id)) return Response.json(mixed);
      if (url === photoURL) {
        equal(options.mode, 'cors'); equal(options.credentials, 'omit'); equal(options.redirect, 'error');
        return new Response(imageBytes['image/jpeg'], { headers: { 'Content-Type': 'image/jpeg' } });
      }
      if (url.endsWith('format=png&name=orig')) return new Response(imageBytes['image/png'], { headers: { 'Content-Type': 'application/octet-stream' } });
      equal(url, mediaURL); return mp4();
    };
    const mixedPost = await (await requestX('/api/import/x', { url: link(id) })).json();
    equal(mixedPost.media.map(m => [m.kind, m.index]), [['photo', 0], ['gif', 1], ['photo', 2], ['video', 3]]);
    equal(mixedPost.media[0], { kind: 'photo', width: 1200, height: 800, duration: 0, index: 0 });
    for (const [index, mime] of [[0, 'image/jpeg'], [1, 'video/mp4'], [2, 'image/png'], [3, 'video/mp4']]) {
      const media = await requestX('/api/import/x/media', { url: link(id), index });
      equal(media.status, 200); equal(media.headers.get('content-type'), mime); equal((await media.blob()).type, mime);
    }
    equal(fetched.length, 5);
  }

  // Photos-only and legacy typed-array responses support all allowed image formats.
  for (const [url, mime] of [
    [photoURL, 'image/jpeg'],
    ['https://pbs.twimg.com/media/example_photo?format=png&name=orig', 'image/png'],
    ['https://pbs.twimg.com/media/example_photo.webp', 'image/webp']
  ]) {
    const id = fresh();
    globalThis.fetch = async address => address === api(id) ? photoResponse(id, [photo(url)]) : new Response(imageBytes[mime], { headers: { 'Content-Type': mime } });
    const metadata = await (await requestX('/api/import/x', { url: `https://twitter.com/example/status/${id}/photo/1?s=20` })).json();
    equal(metadata.media.length, 1); equal(metadata.media[0].kind, 'photo'); equal(metadata.author, 'example');
    const image = await requestX('/api/import/x/media', { url: link(id), index: 0 });
    equal(image.status, 200); equal(image.headers.get('content-type'), mime); equal(image.headers.get('content-length'), '12');
  }

  // An empty `all` must not hide usable media from an older typed-array response.
  {
    const id = fresh(), data = fixture(id); data.status.media.all = []; data.status.media.photos = [photo()];
    globalThis.fetch = async () => Response.json(data);
    const result = await (await requestX('/api/import/x', { url: link(id) })).json();
    equal(result.media.map(m => m.kind), ['video', 'photo']);
  }

  // Only original Twitter raster photos can trigger an image request.
  for (const url of [
    'https://pbs.twimg.com.evil.test/media/id.jpg', 'https://evil.test/media/id.jpg',
    'http://pbs.twimg.com/media/id.jpg', 'https://user:pass@pbs.twimg.com/media/id.jpg',
    'https://pbs.twimg.com:444/media/id.jpg', 'https://pbs.twimg.com/profile_images/id.jpg',
    'https://pbs.twimg.com/media/id.svg', 'https://pbs.twimg.com/media/id?format=svg',
    'https://pbs.twimg.com/media/id.jpg?format=svg', 'https://pbs.twimg.com/media/id',
    'https://pbs.twimg.com/media/../id.jpg', 'https://pbs.twimg.com/media/id.jpg/extra'
  ]) {
    const id = fresh(); let requests = 0;
    globalThis.fetch = async () => { requests++; return photoResponse(id, [photo(url)]); };
    await status(await requestX('/api/import/x/media', { url: link(id), index: 0 }), 422, 'No downloadable');
    equal(requests, 1);
  }

  // Reject HTML/SVG, mislabeled bytes, and excessive images before handing them to a decoder.
  for (const [type, bytes] of [
    ['text/html', new TextEncoder().encode('<html>not an image</html>')],
    ['image/svg+xml', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['image/jpeg', new TextEncoder().encode('not an image')],
    ['image/jpeg', imageBytes['image/png']],
    ['application/octet-stream', new TextEncoder().encode('not an image')]
  ]) {
    const id = fresh(); globalThis.fetch = async url => url === api(id) ? photoResponse(id) : new Response(bytes, { headers: { 'Content-Type': type } });
    equal((await requestX('/api/import/x/media', { url: link(id), index: 0 })).status, 422);
  }
  for (const declared of [true, false]) {
    const id = fresh();
    globalThis.fetch = async url => url === api(id) ? photoResponse(id) : new Response(new Uint8Array(declared ? 12 : 15 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg', ...(declared ? { 'Content-Length': String(16 * 1024 * 1024) } : {}) } });
    await status(await requestX('/api/import/x/media', { url: link(id), index: 0 }), 413, 'exceeds 15 MB');
  }

  // Cancelling a photo body does not return a partial image or a generic failure.
  {
    const id = fresh(), controller = new AbortController();
    globalThis.fetch = async url => {
      if (url === api(id)) return photoResponse(id);
      queueMicrotask(() => controller.abort());
      return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'image/jpeg' } });
    };
    await assert.rejects(requestX('/api/import/x/media', { url: link(id), index: 0 }, controller.signal), { name: 'AbortError' }); assertions++;
  }

  // Reject mismatched/malformed metadata and unsafe resolved media.
  for (const data of [null, { code: 200, status: { id: 'different' } }, { code: 200, status: [] }]) {
    globalThis.fetch = async () => Response.json(data);
    await status(await requestX('/api/import/x', { url: link(fresh()) }), 502, 'could not be loaded');
  }
  for (const url of ['https://evil.test/clip.mp4', 'https://video.twimg.com.evil.test/clip.mp4', 'http://video.twimg.com/clip.mp4', 'https://user:pass@video.twimg.com/clip.mp4', 'https://video.twimg.com/clip.m3u8']) {
    const id = fresh(); globalThis.fetch = async () => response(id, { url });
    await status(await requestX('/api/import/x', { url: link(id) }), 422, 'No downloadable');
  }
  globalThis.fetch = async () => new Response('{invalid');
  await status(await requestX('/api/import/x', { url: link(fresh()) }), 502, 'unreadable');
  for (const code of [401, 403, 404, 429, 500]) {
    globalThis.fetch = async () => new Response('', { status: code });
    equal((await requestX('/api/import/x', { url: link(fresh()) })).status, code === 429 ? 429 : code === 500 ? 502 : 404);
  }
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await status(await requestX('/api/import/x', { url: link(fresh()) }), 502, 'browser could not reach');

  // Both declared and streamed payload limits are enforced; metadata is bounded too.
  for (const declared of [true, false]) {
    const id = fresh();
    globalThis.fetch = async url => url === api(id) ? response(id) : new Response(new Uint8Array(declared ? 16 : 20 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'video/mp4', ...(declared ? { 'Content-Length': String(21 * 1024 * 1024) } : {}) } });
    await status(await requestX('/api/import/x/media', { url: link(id), index: 0 }), 413, 'exceeds 20 MB');
  }
  globalThis.fetch = async () => new Response(new Uint8Array(1024 * 1024 + 1));
  await status(await requestX('/api/import/x', { url: link(fresh()) }), 413, 'too much data');
  for (const type of ['text/html', 'video/mp4']) {
    const id = fresh(); globalThis.fetch = async url => url === api(id) ? response(id) : new Response('not an MP4 video', { headers: { 'Content-Type': type } });
    equal((await requestX('/api/import/x/media', { url: link(id), index: 0 })).status, 422);
  }
  { const id = fresh(); globalThis.fetch = async () => response(id); equal((await requestX('/api/import/x/media', { url: link(id), index: 1 })).status, 400); }

  // Cache is fresh for five minutes and bounded at 64 post records.
  let now = originalNow(); Date.now = () => now; calls = 0;
  globalThis.fetch = async url => { calls++; return response(url.split('/').at(-1)); };
  const cachedId = fresh();
  await requestX('/api/import/x', { url: link(cachedId) }); await requestX('/api/import/x', { url: link(cachedId) }); equal(calls, 1);
  now += 5 * 60 * 1000 + 1; await requestX('/api/import/x', { url: link(cachedId) }); equal(calls, 2);
  for (let i = 0; i < 65; i++) await requestX('/api/import/x', { url: link(fresh()) });
  const before = calls; await requestX('/api/import/x', { url: link(cachedId) }); equal(calls, before + 1);
  Date.now = originalNow;

  // User cancellation remains AbortError, including mid-body streams and cached lookups.
  const preAborted = new AbortController(); preAborted.abort();
  await assert.rejects(requestX('/api/import/x', { url: link(cachedId) }, preAborted.signal), { name: 'AbortError' }); assertions++;
  for (const stream of [false, true]) {
    const controller = new AbortController();
    globalThis.fetch = async (_url, { signal }) => {
      queueMicrotask(() => controller.abort());
      if (stream) return new Response(new ReadableStream({ start() {} }));
      return await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    };
    await assert.rejects(requestX('/api/import/x', { url: link(fresh()) }, controller.signal), { name: 'AbortError' }); assertions++;
  }

  // The production time limit covers response bodies as well as request headers.
  globalThis.setTimeout = fn => { queueMicrotask(fn); return 123; };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async () => new Response(new ReadableStream({ start() {} }));
  await status(await requestX('/api/import/x', { url: link(fresh()) }), 504, 'timed out');

  console.log(`PASS public X importer: ${assertions} assertions (CORS options, validation, media, limits, cache, cancellation, timeouts).`);
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
}
