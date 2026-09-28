import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { archiveMedia } from '../catalog.js';
import { media, templates } from '../data.js';
import { weeklyPicks } from '../weekly-picks.js';
import { bestEligible, isFresh, qualityLabel } from '../quality.js';

const root = fileURLToPath(new URL('..', import.meta.url));
let references = 0;
async function checkReference(value, from) {
  if (!value || /^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(value)) return;
  assert.ok(!value.startsWith('/'), `${from}: site-local URL must be relative for GitHub Pages: ${value}`);
  const path = resolve(dirname(from), decodeURIComponent(value.split(/[?#]/)[0]));
  assert.ok(!relative(root, path).startsWith('..'), `${from}: reference leaves the site: ${value}`);
  assert.ok((await stat(path).catch(() => null))?.isFile(), `${from}: missing file: ${value}`);
  references++;
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

let modules = 0;
for await (const path of walk(root)) {
  const extension = extname(path);
  if (!['.html', '.css', '.js', '.mjs', '.json'].includes(extension)) continue;
  const source = await readFile(path, 'utf8');
  if (extension === '.html') {
    for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) await checkReference(match[1], path);
  }
  if (extension === '.css') {
    for (const match of source.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) await checkReference(match[1], path);
  }
  if (extension === '.js' || extension === '.mjs') {
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative(root, path)} has invalid JavaScript:\n${result.stderr}`);
    for (const match of source.matchAll(/(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|\bimport\s*\(\s*)["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith('.') || /^https?:/.test(match[1]), `${path}: unsupported bare module import: ${match[1]}`);
      await checkReference(match[1], path);
    }
    modules++;
  }
}

const all = [...media, ...archiveMedia];
assert.equal(new Set(all.map(item => item.id)).size, all.length, 'Catalog media IDs must be unique');
for (const item of [...all, ...templates]) {
  assert.ok(item.id, 'Every catalog entry needs an ID');
  for (const key of ['src', 'preview', 'poster', 'originalSrc']) {
    if (item[key]) await checkReference(item[key], join(root, 'catalog.js'));
  }
}
for (const item of weeklyPicks) {
  assert.ok(item.author && item.sourceName, `${item.id}: retain creator/source attribution`);
  assert.ok(/^https:\/\//.test(item.sourceUrl), `${item.id}: source must be a public HTTPS URL`);
  assert.ok(Number.isFinite(Date.parse(item.sourcePostDate)), `${item.id}: invalid original post date`);
  assert.ok(item.type && item.title && item.src, `${item.id}: missing media metadata`);
}

// Dates are fixed to ensure the test remains meaningful as real posts age.
const now = Date.parse('2026-09-28T12:00:00Z');
const recent = { id: 'recent', type: 'meme', bestRoast: true, sourcePostDate: '2026-09-27T12:00:00Z' };
assert.ok(isFresh(recent, now));
assert.ok(bestEligible(recent, {}, now));
assert.equal(bestEligible(recent, { recent: -1 }, now), false, 'Lame votes must leave Best Roasts');
assert.equal(isFresh({ sourcePostDate: '2026-09-29' }, now), false, 'Future posts must not be labeled fresh');
assert.equal(isFresh({ sourcePostDate: '2026-08-01' }, now), false, 'Old posts must age out');
assert.ok(bestEligible({ id: 'classic', type: 'meme', bestRoast: true, classic: true }, {}, now));
assert.match(qualityLabel({ classic: true }, now), /Classic/);

console.log(`PASS: ${modules} browser modules, ${references} local references, ${all.length} catalog items, attribution, and freshness rules.`);
