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
const fixture = (id, extra = {}) => ({ code: 200, status: { id, text: 'Cowboys reaction', author: { screen_name: 'example' }, media: { videos: [{ type: 'video', url: mediaURL, width: 1280, height: 720, duration: 4, ...extra }] } } });
const response = (id, extra) => Response.json(fixture(id, extra));
const mp4 = () => new Response(new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]), { headers: { 'Content-Type': 'video/mp4' } });
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
