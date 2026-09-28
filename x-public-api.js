// Public, credential-free X imports for the static site. Only the post API and
// validated video.twimg.com MP4s are fetched; this is not an arbitrary URL proxy.
const MEDIA_LIMIT = 20 * 1024 * 1024;
const JSON_LIMIT = 1024 * 1024;
const CACHE_LIMIT = 64;
const CACHE_TTL = 5 * 60 * 1000;
const postCache = new Map();

class ImportError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
const cancelled = () => new DOMException('Import cancelled.', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw cancelled(); }

function parsePost(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new ImportError('Paste a complete public X or Twitter post link.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new ImportError('Paste a complete public X or Twitter post link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com', 'm.twitter.com'].includes(url.hostname)) {
    throw new ImportError('Use a public post link from x.com or twitter.com.');
  }
  const match = url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,30}\/status|i\/web\/status|i\/status)\/(\d{5,25})(?:\/(?:video|photo)\/\d+)?\/?$/);
  if (!match) throw new ImportError('Use a post link containing /status/ and the post number.');
  return { id: match[1], url: `https://x.com/i/status/${match[1]}` };
}

function mediaURL(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.port && !url.username && !url.password && /\.mp4$/i.test(url.pathname)) return url.href;
  } catch {}
  return null;
}

async function limitedBlob(response, limit, signal) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new ImportError(limit === MEDIA_LIMIT ? 'This video exceeds 20 MB. Download it and use Import video to trim it locally.' : 'This post returned too much data. Try another public post.', 413);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImportError('The source returned an empty response. Try again or import a video file.', 502);
  const chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new ImportError(limit === MEDIA_LIMIT ? 'This video exceeds 20 MB. Download it and use Import video to trim it locally.' : 'This post returned too much data. Try another public post.', 413);
      }
      chunks.push(value);
    }
    return new Blob(chunks);
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function download(url, { signal, video = false }) {
  checkAbort(signal);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, video ? 30000 : 12000);
  try {
    checkAbort(signal);
    const response = await fetch(url, {
      method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'error',
      referrerPolicy: 'no-referrer', headers: { Accept: video ? 'video/mp4' : 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new ImportError('X media lookup is busy. Try again shortly, or import a video file.', 429);
      if ([401, 403, 404].includes(response.status)) throw new ImportError('This post or video is private, deleted, or unavailable. Use another public post or import a video file.', 404);
      throw new ImportError('X media is temporarily unavailable. Try again or import a video file.', 502);
    }
    if (video && !['video/mp4', 'application/octet-stream'].includes((response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase())) {
      await response.body?.cancel();
      throw new ImportError('This post did not return a supported MP4 video.', 422);
    }
    return await limitedBlob(response, video ? MEDIA_LIMIT : JSON_LIMIT, controller.signal);
  } catch (error) {
    checkAbort(signal);
    if (timedOut) throw new ImportError('The X import timed out. Try again or import a video file.', 504);
    if (error instanceof ImportError) throw error;
    throw new ImportError('The browser could not reach X media. Try again, or download the clip and use Import video.', 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const dimension = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(16384, Math.trunc(Number(value)))) : 0;
const duration = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(86400, Number(value))) : 0;

async function resolvePost(post, signal) {
  checkAbort(signal);
  const cached = postCache.get(post.id);
  if (cached && cached.expires > Date.now()) return cached.post;
  postCache.delete(post.id);
  const blob = await download(`https://api.fxtwitter.com/2/status/${post.id}`, { signal });
  let data;
  try { data = JSON.parse(await blob.text()); }
  catch { throw new ImportError('This post returned an unreadable response. Try another public post.', 502); }
  checkAbort(signal);
  if ([401, 403, 404].includes(data?.code)) throw new ImportError('This post is private, deleted, or unavailable. Try another public post.', 404);
  if (data?.code === 429) throw new ImportError('X media lookup is busy. Try again shortly, or import a video file.', 429);
  if (!data || data.code && data.code !== 200 || !data.status || String(data.status.id) !== post.id) throw new ImportError('This post could not be loaded. Try again or import a video file.', 502);
  const tweet = data.status;
  const candidates = Array.isArray(tweet.media?.videos) ? tweet.media.videos :
    (Array.isArray(tweet.media?.all) ? tweet.media.all : []).filter(m => m && ['video', 'gif'].includes(m.type));
  const media = candidates.slice(0, 4).flatMap(m => {
    if (!m || typeof m !== 'object') return [];
    const variants = (Array.isArray(m.formats) ? m.formats : [])
      .filter(v => v && mediaURL(v.url) && (!v.codec || v.codec === 'h264'))
      .sort((a, b) => (Number(a.bitrate) || 0) - (Number(b.bitrate) || 0));
    const reasonable = variants.filter(v => Number(v.bitrate) <= 2500000);
    const src = mediaURL(reasonable.at(-1)?.url || variants[0]?.url || m.url);
    return src ? [{ src, kind: m.type === 'gif' ? 'gif' : 'video', width: dimension(m.width), height: dimension(m.height), duration: duration(m.duration) }] : [];
  });
  if (!media.length) throw new ImportError('No downloadable video or animated GIF was found. Try the original post containing the media.', 422);
  const resolved = { id: post.id, url: post.url, text: String(tweet.text || '').slice(0, 500), author: String(tweet.author?.screen_name || '').slice(0, 100), media };
  if (postCache.size >= CACHE_LIMIT) postCache.delete(postCache.keys().next().value);
  postCache.set(post.id, { post: resolved, expires: Date.now() + CACHE_TTL });
  return resolved;
}

/** Match the original import API's Response shape without a server or login. */
export async function requestX(path, body, signal) {
  try {
    checkAbort(signal);
    if (!['/api/import/x', '/api/import/x/media'].includes(path)) throw new ImportError('Import route not found.', 404);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ImportError('Paste a public X or Twitter post link.');
    const post = parsePost(body.url);
    if (path.endsWith('/media') && (!Number.isInteger(body.index) || body.index < 0 || body.index > 3)) throw new ImportError('Choose a video from this post.');
    const resolved = await resolvePost(post, signal);
    if (path === '/api/import/x') return json({ ...resolved, media: resolved.media.map(({ src, ...m }, index) => ({ ...m, index })) });
    if (!resolved.media[body.index]) throw new ImportError('Choose a video from this post.');
    const blob = await download(resolved.media[body.index].src, { signal, video: true });
    const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    checkAbort(signal);
    if (signature.length < 12 || String.fromCharCode(...signature.slice(4, 8)) !== 'ftyp') throw new ImportError('The source did not return a valid MP4 video.', 422);
    return new Response(blob, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(blob.size), 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw cancelled();
    return json({ error: error instanceof ImportError ? error.message : 'Import failed. Try again or choose a video file.' }, error instanceof ImportError ? error.status : 502);
  }
}
