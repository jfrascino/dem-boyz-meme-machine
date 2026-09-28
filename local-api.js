// The public app keeps each visitor's workspace in their own browser. Blob URLs
// are session-only; IndexedDB retains the original Blobs, never their URLs.
const DB_NAME = 'dem-boyz-public-workspace';
const STORES = ['ratings', 'favorites', 'removals', 'tags', 'collections', 'memberships', 'creations', 'projects'];
const itemPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const creationPattern = /^custom-[a-zA-Z0-9-]{1,80}$/;
const folderPattern = /^folder-[a-zA-Z0-9-]{1,80}$/;
const projectPattern = /^project-[a-zA-Z0-9-]{1,80}$/;
const objectURLs = new Map();
let databasePromise;

function invalid(message) { throw new Error(message); }
function storageError(error) {
  if (error?.name === 'QuotaExceededError') return new Error('This browser’s storage is full. Download your creation to keep a copy, or free browser storage and try again.');
  if (['SecurityError', 'InvalidStateError', 'UnknownError'].includes(error?.name)) return new Error('Browser storage is unavailable. Allow site storage or use a regular browser window, then try again.');
  if (error?.name === 'ConstraintError') return new Error('That item already exists. Choose another name or reopen the existing item.');
  return error instanceof Error ? error : new Error('Could not save to this browser. Please try again.');
}
function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error('This browser does not support local storage for this app. Use a current browser.'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => reject(new Error('Close other DEM BOYZ tabs, then reload to update browser storage.'));
    }).catch(error => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

// Every request is queued synchronously or from an IndexedDB success callback.
// File decoding and validation happen before opening a write transaction.
async function transaction(names, mode, work) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let output, failure;
    const fail = error => { failure = error; try { tx.abort(); } catch { reject(storageError(error)); } };
    const done = value => { output = value; };
    const read = (request, callback) => {
      request.onsuccess = () => { try { callback(request.result); } catch (error) { fail(error); } };
    };
    tx.oncomplete = () => resolve(output);
    tx.onabort = () => reject(storageError(failure || tx.error));
    tx.onerror = () => { failure ||= tx.error; };
    try { work(tx, done, read, fail); } catch (error) { fail(error); }
  });
}
const allRows = names => transaction(names, 'readonly', (tx, done, read) => {
  const rows = {}; let left = names.length;
  for (const name of names) read(tx.objectStore(name).getAll(), value => { rows[name] = value; if (!--left) done(rows); });
});
const writeRow = (store, row, response) => transaction([store], 'readwrite', (tx, done) => { tx.objectStore(store).put(row); done(response); });
function objectURL(key, blob, revision) {
  if (!(blob instanceof Blob)) return '';
  const cached = objectURLs.get(key);
  if (cached?.revision === revision) return cached.url;
  const url = URL.createObjectURL(blob);
  if (cached) URL.revokeObjectURL(cached.url);
  objectURLs.set(key, { revision, url });
  return url;
}
function creationRecord(row) {
  const src = objectURL(`${row.id}/media`, row.media, row.mediaRevision);
  const poster = objectURL(`${row.id}/poster`, row.poster, row.posterRevision) || src;
  return { id: row.id, title: row.title, type: row.type, caption: row.caption, width: row.width, height: row.height,
    src, poster, preview: poster, category: 'My creation', sourceUrl: row.sourceUrl || '',
    sourceName: row.sourceUrl ? (/^https:\/\/(www\.)?(x\.com|twitter\.com)\//.test(row.sourceUrl) ? 'X / Twitter' : new URL(row.sourceUrl).hostname.replace(/^www\./, '')) : '',
    author: row.author || '', cloud: true, local: true, createdAt: row.createdAt };
}
function projectSummary(row) {
  return { id: row.id, title: row.title, kind: row.kind, poster: objectURL(`${row.id}/poster`, row.poster, row.posterRevision),
    createdAt: row.createdAt, updatedAt: row.updatedAt, archived: !!row.archived };
}
function readJSON(body, limit = 8192) {
  if (typeof body !== 'string' || body.length > limit) invalid('Invalid request data.');
  let value; try { value = JSON.parse(body); } catch { invalid('Invalid request data.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an object.');
  return value;
}
function text(value, max, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) invalid('Invalid text.');
  return value;
}
function validId(value, pattern = itemPattern) { return typeof value === 'string' && pattern.test(value); }
function sourceAttribution(value) {
  if (typeof value !== 'string' || value.length > 2048) invalid('Invalid source link.');
  let url; try { url = new URL(value); } catch { invalid('Invalid source link.'); }
  const host = url.hostname.replace(/^www\./, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'twitter.com', 'pinterest.com', 'imgflip.com', 'lolalambchops.com', 'thunderdungeon.com', 'athlonsports.com', 'dallasnews.com', 'tenor.com', 'giphy.com'].includes(host)) invalid('Use an original source link from a supported meme library.');
  if (['x.com', 'twitter.com'].includes(host)) {
    const match = url.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,25})(?:\/.*)?$/);
    if (!match) invalid('Use a public X post link.');
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }
  return url.href;
}
function projectSettings(kind, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) invalid('Unsupported project settings.');
  const number = (value, min, max, fallback) => { if (value === undefined) return fallback; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid('Invalid project setting.'); return value; };
  const choice = (value, options, fallback) => { if (value === undefined) return fallback; if (!options.includes(value)) invalid('Invalid project setting.'); return value; };
  const settings = { version: 1, top: text(input.top, 120), bottom: text(input.bottom, 120), jerry: input.jerry === true };
  if (kind === 'image') return { ...settings, size: number(input.size, 4, 11, 7), color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#ffffff', layout: choice(input.layout, ['classic', 'banner'], 'classic'), shape: choice(input.shape, ['original', 'square', 'story', 'wide'], 'original') };
  let overlays;
  if (input.overlays !== undefined) {
    const raw = input.overlays;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Invalid caption styles.');
    overlays = { font: choice(raw.font, ['Impact', 'Arial', 'Georgia'], 'Impact'), color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#ffffff', size: number(raw.size, .025, .16, .072), safeInset: number(raw.safeInset, 0, .25, .05) };
    for (const name of ['top', 'bottom', 'sticker']) {
      const item = raw[name] || {};
      if (typeof item !== 'object' || Array.isArray(item)) invalid('Invalid overlay.');
      const start = number(item.start, 0, 86400, 0), end = item.end == null ? null : number(item.end, start, 86400, null);
      overlays[name] = { x: number(item.x, 0, 1, .5), y: item.y == null ? (name === 'sticker' ? .5 : null) : number(item.y, 0, 1, .5), start, end };
    }
    overlays.sticker.value = choice(raw.sticker?.value, ['', '🤡', '💸', '🚫', '⭐'], '');
    overlays.sticker.size = number(raw.sticker?.size, .04, .4, .16);
  }
  const start = number(input.start, 0, 86400, 0), end = number(input.end, .2, 86400, 4);
  if (end - start < .199 || end - start > 8.001) invalid('Project clip must be between 0.2 and 8 seconds.');
  return { ...settings, ...(overlays ? { overlays } : {}), start, end, edge: choice(input.edge, [320, 480, 720], 480), fps: choice(input.fps, [0, 5, 10, 15, 30], 10), format: choice(input.format, ['gif', 'mp4'], 'gif'), aspect: choice(input.aspect, ['original', '1:1', '4:5', '9:16', '16:9'], 'original'), zoom: number(input.zoom, 1, 3, 1), panX: number(input.panX, -1, 1, 0), panY: number(input.panY, -1, 1, 0), speed: choice(input.speed, [.5, 1, 2], 1), playback: choice(input.playback, ['forward', 'reverse', 'pingpong'], 'forward'), sourceUrl: input.sourceUrl ? sourceAttribution(input.sourceUrl) : '', author: text(input.author, 100) };
}
async function mediaType(blob) {
  const sig = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => sig[index] === value)) return 'image/png';
  if (sig[0] === 255 && sig[1] === 216 && sig[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(String.fromCharCode(...sig.slice(0, 6)))) return 'image/gif';
  if (String.fromCharCode(...sig.slice(0, 4)) === 'RIFF' && String.fromCharCode(...sig.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...sig.slice(4, 8)) === 'ftyp') return 'video/mp4';
  if ([26, 69, 223, 163].every((value, index) => sig[index] === value)) return 'video/webm';
  return '';
}
async function validatedPoster(value) {
  if (!(value instanceof Blob) || !value.size) return null;
  if (value.size > 2 * 1024 * 1024) invalid('Preview is too large.');
  if (await mediaType(value) !== 'image/jpeg') invalid('Invalid preview image.');
  return value.slice(0, value.size, 'image/jpeg');
}

export async function localApi(path, options = {}) {
  try { return await route(path, options); } catch (error) { throw storageError(error); }
}
async function route(path, options) {
  if (typeof path !== 'string' || !path.startsWith('/api/')) invalid('Unknown browser storage request.');
  const method = String(options.method || 'GET').toUpperCase(), now = new Date().toISOString();
  if (path === '/api/library' && method === 'GET') {
    const rows = await allRows(['tags', 'creations', 'removals']);
    return { tags: Object.fromEntries(rows.tags.map(row => [row.id, row.tagged])), creations: rows.creations.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(creationRecord), removed: rows.removals.filter(row => row.removed).map(row => row.id) };
  }
  if (path === '/api/workspace' && method === 'GET') {
    const rows = await allRows(['ratings', 'favorites', 'collections', 'memberships', 'projects']);
    return { ratings: Object.fromEntries(rows.ratings.map(row => [row.id, row.value])), favorites: rows.favorites.filter(row => row.favorite).map(row => row.id), collections: rows.collections.filter(row => !row.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(({ id, name }) => ({ id, name })), memberships: rows.memberships.map(({ collectionId, itemId }) => ({ collectionId, itemId })), projects: rows.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(projectSummary) };
  }
  if (path === '/api/favorites/import' && method === 'POST') {
    const data = readJSON(options.body, 220000);
    if (!Array.isArray(data.ids) || data.ids.length > 2000 || data.ids.some(id => !validId(id))) invalid('Invalid favorites.');
    return transaction(['favorites'], 'readwrite', (tx, done, read) => {
      const store = tx.objectStore('favorites');
      for (const id of new Set(data.ids)) read(store.get(id), previous => { if (!previous) store.put({ id, favorite: true, updatedAt: now }); });
      done({ imported: true });
    });
  }
  const simple = { '/api/ratings': ['ratings', 'value', value => [-1, 0, 1].includes(value), 'rating'], '/api/favorites': ['favorites', 'favorite', value => typeof value === 'boolean', 'favorite'], '/api/removals': ['removals', 'removed', value => typeof value === 'boolean', 'removal'], '/api/tags': ['tags', 'tagged', value => typeof value === 'boolean', 'tag'] };
  if (simple[path] && method === 'PUT') {
    const [store, field, validate, label] = simple[path], data = readJSON(options.body);
    if (!validId(data.id) || !validate(data[field])) invalid(`Invalid ${label}.`);
    return writeRow(store, { id: data.id, [field]: data[field], updatedAt: now }, { id: data.id, [field]: data[field] });
  }
  if (path === '/api/collections' && method === 'POST') {
    const data = readJSON(options.body), name = text(data.name, 60).trim();
    if (!validId(data.id, folderPattern) || !name) invalid('Enter a collection name.');
    return transaction(['collections'], 'readwrite', (tx, done) => { tx.objectStore('collections').add({ id: data.id, name, archived: false, createdAt: now }); done({ id: data.id, name }); });
  }
  const folderMatch = path.match(/^\/api\/collections\/([^/]+)(?:\/(items))?$/);
  if (folderMatch && method === 'PUT') {
    const [, id, part] = folderMatch, data = readJSON(options.body);
    if (!validId(id, folderPattern)) invalid('Collection not found.');
    return transaction(['collections', 'memberships'], 'readwrite', (tx, done, read) => {
      const store = tx.objectStore('collections');
      read(store.get(id), folder => {
        if (!folder) invalid('Collection not found.');
        if (!part) {
          const name = text(data.name, 60, folder.name).trim();
          if (!name || (data.archived !== undefined && typeof data.archived !== 'boolean')) invalid('Invalid collection.');
          const archived = data.archived ?? folder.archived;
          store.put({ ...folder, name, archived }); done({ id, name, archived });
        } else {
          if (folder.archived) invalid('Restore this collection before adding items.');
          if (!validId(data.itemId) || typeof data.included !== 'boolean') invalid('Invalid collection item.');
          const memberships = tx.objectStore('memberships'), membershipId = `${id}/${data.itemId}`;
          if (data.included) memberships.put({ id: membershipId, collectionId: id, itemId: data.itemId }); else memberships.delete(membershipId);
          done({ collectionId: id, itemId: data.itemId, included: data.included });
        }
      });
    });
  }
  if (path === '/api/creations' && method === 'POST') {
    const form = options.body;
    if (!(form instanceof FormData)) invalid('Invalid creation data.');
    const id = form.get('id'), title = text(form.get('title'), 100).trim(), caption = text(form.get('caption') || '', 500), width = Number(form.get('width')), height = Number(form.get('height')), file = form.get('file');
    if (!validId(id, creationPattern) || !title || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096) invalid('Invalid creation details.');
    if (!(file instanceof Blob) || !file.size || file.size > 20 * 1024 * 1024) invalid('Choose a PNG, GIF, or MP4 smaller than 20 MB.');
    const mime = await mediaType(file);
    if (!['image/png', 'image/gif', 'video/mp4'].includes(mime)) invalid('Only PNG, GIF, and MP4 creations are supported.');
    const poster = await validatedPoster(form.get('poster'));
    if (mime === 'video/mp4' && !poster) invalid('A video preview image is required. Open the video and try saving again.');
    const row = { id, title, caption, width, height, type: mime === 'image/gif' ? 'gif' : mime === 'video/mp4' ? 'video' : 'meme', sourceUrl: form.get('sourceUrl') ? sourceAttribution(form.get('sourceUrl')) : '', author: text(form.get('author') || '', 100), media: file.slice(0, file.size, mime), mediaRevision: crypto.randomUUID(), poster, posterRevision: crypto.randomUUID(), createdAt: now }, tagged = form.get('jerry') === 'true';
    const saved = await transaction(['creations', 'tags', 'removals'], 'readwrite', (tx, done, read) => {
      const store = tx.objectStore('creations');
      read(store.get(id), previous => { row.createdAt = previous?.createdAt || now; store.put(row); tx.objectStore('tags').put({ id, tagged, updatedAt: now }); tx.objectStore('removals').put({ id, removed: false, updatedAt: now }); done(row); });
    });
    return { item: creationRecord(saved), tagged };
  }
  if (path === '/api/projects' && method === 'POST') {
    const form = options.body;
    if (!(form instanceof FormData)) invalid('Invalid project data.');
    const id = form.get('id'), kind = form.get('kind'), title = text(form.get('title'), 100).trim();
    if (!validId(id, projectPattern) || !['image', 'video'].includes(kind) || !title) invalid('Invalid project.');
    let input; try { input = JSON.parse(String(form.get('settings'))); } catch { invalid('Invalid project settings.'); }
    const settings = projectSettings(kind, input), source = form.get('source'), poster = await validatedPoster(form.get('poster'));
    let sourceBlob, sourceName, sourceMime;
    if (source instanceof Blob && source.size) {
      if (source.size > 20 * 1024 * 1024) invalid('Editable projects support source files up to 20 MB.');
      sourceMime = await mediaType(source);
      if (!(kind === 'image' ? ['image/png', 'image/jpeg', 'image/webp'] : ['image/gif', 'video/mp4', 'video/webm']).includes(sourceMime)) invalid('Use PNG, JPG or WebP images, or GIF/MP4/WebM files for saved projects.');
      sourceBlob = source.slice(0, source.size, sourceMime); sourceName = String(source.name || (kind === 'image' ? 'source.png' : 'source.mp4')).slice(0, 160);
    }
    const row = await transaction(['projects'], 'readwrite', (tx, done, read) => {
      const store = tx.objectStore('projects');
      read(store.get(id), previous => {
        if (!sourceBlob && (!previous || previous.kind !== kind)) invalid('A source file is required for a new project.');
        const row = { id, kind, title, settings, source: sourceBlob || previous.source, sourceName: sourceName || previous.sourceName, sourceMime: sourceMime || previous.sourceMime, sourceRevision: sourceBlob ? crypto.randomUUID() : previous.sourceRevision, poster: poster || previous?.poster || null, posterRevision: poster ? crypto.randomUUID() : previous?.posterRevision || '', archived: false, createdAt: previous?.createdAt || now, updatedAt: now };
        store.put(row); done(row);
      });
    });
    return { project: projectSummary(row) };
  }
  const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && ['GET', 'PUT'].includes(method)) {
    const id = projectMatch[1];
    if (!validId(id, projectPattern)) invalid('Project not found.');
    const data = method === 'PUT' ? readJSON(options.body) : null;
    if (data && typeof data.archived !== 'boolean') invalid('Invalid project status.');
    const row = await transaction(['projects'], data ? 'readwrite' : 'readonly', (tx, done, read) => {
      const store = tx.objectStore('projects');
      read(store.get(id), row => { if (!row) invalid('Project not found.'); if (data) { row.archived = data.archived; row.updatedAt = now; store.put(row); } done(row); });
    });
    if (data) return { id, archived: row.archived };
    return { ...projectSummary(row), settings: row.settings, sourceSrc: objectURL(`${id}/source`, row.source, row.sourceRevision), sourceName: row.sourceName, sourceMime: row.sourceMime };
  }
  invalid('This action is not available in browser storage.');
}
