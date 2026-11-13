'use strict';
// Version 3.1 tests: YouTube Music search (ytmsearch), the home screen suggestions (fixed sections, 15-minute cache,
// failure handling, setup check) and batch downloads (many links, one set of options). Runs against the fake yt-dlp.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'v31-test-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-v31-'));
const CALLS = path.join(tmp, 'ytdlp-calls.log');
process.env.VIDYRA_CONFIG = path.join(tmp, 'config.json');
process.env.DOWNLOAD_DIR = path.join(tmp, 'downloads');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, path.join(__dirname, 'fixtures', 'fake-yt-dlp'));
process.env.FAKE_YTDLP_LOG = CALLS; // the fake appends the arguments of every call here
process.env.ACCESS_TOKEN = TOKEN;
process.env.VIDYRA_NOTIFY = 'off';
delete process.env.HOST;

const { server, queue } = require('../server');
const { createSuggestions, SECTION_LIMIT, CONCURRENCY, CACHE_MS } = require('../src/suggest');
const { batchLinks, BATCH_LIMIT } = require('../src/commands');
const { searchSourceFor } = require('../src/features');
const { searchStream } = require('../src/ytdlp');

const DL = process.env.DOWNLOAD_DIR;
const MB = 1024 * 1024;
let port;

before(async () => {
  fs.mkdirSync(DL, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  for (const j of queue.list()) {
    try { queue.cancel(j.id); } catch { /* finished */ }
  }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function req(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { 'Content-Type': 'application/json', 'x-token': TOKEN, ...headers };
    h['Content-Length'] = Buffer.byteLength(payload || '');
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, buf, text: buf.toString('utf8') });
      });
    });
    r.on('error', reject);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}
const json = async (method, p, opts) => {
  const r = await req(method, p, opts);
  return { status: r.status, data: r.text ? JSON.parse(r.text) : null };
};
const getJson = async (p) => {
  const r = await req('GET', p);
  return { status: r.status, text: r.text, data: JSON.parse(r.text) };
};

async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** Every call the fake yt-dlp has received, as argument lists. */
function calls() {
  if (!fs.existsSync(CALLS)) return [];
  return fs.readFileSync(CALLS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** The search calls only, each as the search it ran (for example "ytmsearch8:top hits"). */
const searchCalls = () => calls().filter((a) => a.includes('--flat-playlist')).map((a) => a[a.length - 1]);
const ITEM_KEYS = ['channel', 'duration', 'id', 'thumbnail', 'title', 'url', 'views'];

test('music search uses YouTube Music (ytmsearch) and video search stays on ytsearch', async () => {
  const mark = searchCalls().length;
  const music = await req('GET', '/api/search?q=cats&kind=music&limit=2');
  assert.equal(music.status, 200);
  const lines = music.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.type === 'item').length, 2);
  assert.equal(lines.at(-1).type, 'done');
  assert.deepEqual(searchCalls().slice(mark), ['ytmsearch2:cats'], 'no " audio" is appended any more');

  const plain = await req('GET', '/api/search?q=cats&limit=2');
  assert.deepEqual(searchCalls().slice(mark + 1), ['ytsearch2:cats']);
  assert.match(JSON.parse(plain.text.trim().split('\n')[0]).item.title, /^cats result 1/);

  assert.equal((await json('GET', '/api/search?q=cats&kind=podcast')).status, 400);
  const cmd = await json('POST', '/api/command', { body: { line: 'search lofi --music --limit=1' } });
  assert.equal(cmd.status, 200);
  assert.equal(searchCalls().at(-1), 'ytmsearch1:lofi');
});

const MUSIC_SECTIONS = [
  ['trending-music', 'Trending music', 'top hits this week'],
  ['party', 'Party music', 'party songs mix'],
  ['bollywood', 'Bollywood hits', 'bollywood superhits songs'],
  ['ghazal', 'Ghazal and Sufi', 'ghazal sufi classics'],
  ['lofi', 'Lo-fi to study', 'lofi study beats'],
  ['workout', 'Workout energy', 'workout motivation songs'],
];
const VIDEO_SECTIONS = [
  ['trending', 'Trending', 'trending videos today'],
  ['music-videos', 'Music videos', 'official music video hits'],
  ['learning', 'Learning', 'tutorial explained'],
  ['gaming', 'Gaming highlights', 'gaming highlights'],
  ['shorts', 'Short clips', 'funny short clips'],
];

function checkFeed(data, kind, expected) {
  assert.deepEqual(Object.keys(data).sort(), ['kind', 'needsSetup', 'sections', 'updatedAt']);
  assert.equal(data.kind, kind);
  assert.equal(data.needsSetup, false);
  assert.ok(Number.isFinite(Date.parse(data.updatedAt)), 'updatedAt is a time');
  assert.deepEqual(data.sections.map((s) => [s.id, s.title, s.query]), expected);
  for (const s of data.sections) {
    assert.equal(s.error, undefined, `${s.id} loaded`);
    assert.equal(s.items.length, SECTION_LIMIT, `${s.id} has ${SECTION_LIMIT} items`);
    for (const item of s.items) {
      assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
      assert.match(item.url, /^https:\/\//);
      assert.equal(typeof item.duration, 'number');
      assert.equal(typeof item.views, 'number');
    }
  }
}

test('suggestions for music return the six fixed sections, each searched with ytmsearch', async () => {
  const mark = searchCalls().length;
  const r = await getJson('/api/suggestions?kind=music&fresh=1');
  assert.equal(r.status, 200);
  checkFeed(r.data, 'music', MUSIC_SECTIONS);
  assert.equal(r.data.sections[0].items[0].channel, 'Artist 1 - Topic');
  assert.deepEqual(searchCalls().slice(mark).sort(), MUSIC_SECTIONS.map(([, , q]) => `ytmsearch8:${q}`).sort());
  assert.equal(r.text.includes('/tmp'), false, 'no folder paths in the answer');
  assert.equal(r.text.includes('yt-dlp'), false, 'no yt-dlp command line in the answer');
});

test('suggestions for video return the five fixed sections, searched with plain ytsearch', async () => {
  const mark = searchCalls().length;
  const r = await getJson('/api/suggestions?kind=video&fresh=1');
  assert.equal(r.status, 200);
  checkFeed(r.data, 'video', VIDEO_SECTIONS);
  assert.deepEqual(searchCalls().slice(mark).sort(), VIDEO_SECTIONS.map(([, , q]) => `ytsearch8:${q}`).sort());
  assert.equal((await getJson('/api/suggestions?kind=podcast')).status, 400);
});

test('suggestions are cached: a second call runs no searches, and fresh=1 bypasses the cache', async () => {
  const first = await getJson('/api/suggestions?kind=video&fresh=1');
  const mark = searchCalls().length;
  const second = await getJson('/api/suggestions?kind=video');
  assert.equal(searchCalls().length, mark, 'the cached answer runs no yt-dlp');
  assert.equal(second.data.updatedAt, first.data.updatedAt);
  assert.deepEqual(second.data.sections.map((s) => s.id), VIDEO_SECTIONS.map(([id]) => id));
  await getJson('/api/suggestions?kind=video&fresh=1');
  assert.equal(searchCalls().length, mark + VIDEO_SECTIONS.length, 'fresh=1 runs every section again');
});

const batch = (body) => json('POST', '/api/download/batch', { body });

test('batch queues every valid link with the same options and reports the invalid ones', async () => {
  const r = await batch({
    urls: ['https://example.com/batch/a', 'ftp://example.com/nope', ' https://example.com/batch/b  ', '', 'not a url', 'https://example.com/batch/c'],
    options: { mode: 'audio', audioFormat: 'flac' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.data).sort(), ['errors', 'jobs', 'queued']);
  assert.equal(r.data.queued, 3);
  assert.deepEqual(r.data.jobs.map((j) => j.url), [
    'https://example.com/batch/a', 'https://example.com/batch/b', 'https://example.com/batch/c',
  ]);
  assert.ok(r.data.jobs.every((j) => j.mode === 'audio'));
  assert.deepEqual(r.data.errors.map((e) => e.url), ['ftp://example.com/nope', 'not a url']);
  assert.match(r.data.errors[0].message, /http\(s\)/);
  assert.match(r.data.errors[1].message, /https:\/\//);
  // The same options reached yt-dlp for each link (the link is the last argument).
  await waitFor(() => calls().some((a) => a.at(-1) === 'https://example.com/batch/a' && a.includes('flac')));
});

test('batch drops repeated links, including ones that differ only in the case of the host', async () => {
  const r = await batch({
    urls: 'https://example.com/batch/d\n  https://example.com/batch/d\n\nhttps://EXAMPLE.com/batch/d\nhttps://example.com/batch/e',
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.queued, 2);
  assert.deepEqual(r.data.jobs.map((j) => j.url), ['https://example.com/batch/d', 'https://example.com/batch/e']);
  assert.deepEqual(r.data.errors, []);
});

test('a batch of more than 50 different links is refused with 400, and exactly 50 is accepted', async () => {
  const many = Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => `https://example.com/many/${i}`);
  const over = await batch({ urls: many, options: {} });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /at most 50/);

  const ok = await batch({ urls: many.slice(0, BATCH_LIMIT) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.queued, BATCH_LIMIT);
  for (const j of ok.data.jobs) await json('POST', `/api/jobs/${j.id}/cancel`, { body: {} });
});

test('a batch where every link is invalid, or nothing is pasted, is refused with 400', async () => {
  const bad = await batch({ urls: ['nope', 'ftp://example.com/x'] });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /starts with https:\/\//, 'the first message is the one returned');
  const blank = await batch({ urls: '  \n \n' });
  assert.equal(blank.status, 400);
  assert.match(blank.data.error, /at least one link/);
  assert.equal((await batch({ urls: 5 })).status, 400);
});

test('the batch command queues links with the add flags and lists the skipped ones', async () => {
  const cmd = await json('POST', '/api/command', {
    body: { line: 'batch https://example.com/batch/cmd1 nope https://example.com/batch/cmd2 --height=720 --container=mkv' },
  });
  assert.equal(cmd.status, 200);
  assert.equal(cmd.data.data.queued, 2);
  assert.equal(cmd.data.data.errors.length, 1);
  assert.match(cmd.data.text, /Queued 2 downloads/);
  assert.match(cmd.data.text, /Skipped 1/);
  await waitFor(() => calls().some((a) => a.at(-1) === 'https://example.com/batch/cmd1'
    && a[a.indexOf('--merge-output-format') + 1] === 'mkv'));
  assert.equal((await json('POST', '/api/command', { body: { line: 'batch nope' } })).status, 400);
  assert.equal((await json('POST', '/api/command', { body: { line: 'batch' } })).status, 400);
});

test('a batch is refused with 507 when the device is nearly full, unless forced', async (t) => {
  const { data } = await json('GET', '/api/files');
  if (typeof data.freeBytes !== 'number' || data.freeBytes >= 20000 * MB) {
    return t.skip('free space is too large for the 20000 MB guard to trigger on this machine');
  }
  await json('POST', '/api/settings', { body: { minFreeMb: 20000 } });
  try {
    const refused = await batch({ urls: ['https://example.com/batch/full'] });
    assert.equal(refused.status, 507);
    assert.equal(refused.data.error, 'Not enough free space on this device');
    const forced = await batch({ urls: ['https://example.com/batch/full'], force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.data.queued, 1);
  } finally {
    await json('POST', '/api/settings', { body: { minFreeMb: 500 } });
  }
});

// ---- unit tests of the pieces (no server, injected search and tool check) ------------------------------

test('without yt-dlp every section is empty, needsSetup is true, and nothing is cached', async () => {
  let searches = 0;
  let checks = 0;
  const s = createSuggestions({
    detect: async () => { checks += 1; return { ytdlp: { installed: false } }; },
    search: () => { searches += 1; throw new Error('must not search'); },
  });
  const r = await s.get('music');
  assert.equal(r.needsSetup, true);
  assert.equal(r.sections.length, MUSIC_SECTIONS.length);
  assert.ok(r.sections.every((sec) => sec.items.length === 0 && !('error' in sec)));
  await s.get('music');
  assert.equal(checks, 2, 'the tool check runs again, so an install is seen at once');
  assert.equal(searches, 0);
});

test('a failing section comes back empty with an error text, and the other sections still load', async () => {
  const s = createSuggestions({
    detect: async () => ({ ytdlp: { installed: true } }),
    search: (query, limit, h) => {
      setTimeout(() => {
        if (query === 'gaming highlights') {
          h.onError('SECRET /opt/yt-dlp --cookies /home/me/cookies.txt');
          return;
        }
        if (query === 'tutorial explained') {
          h.onItem({ id: 'a', title: 'T', url: 'https://x.example/a', duration: 5, uploader: 'U', thumbnail: '', view_count: 9 });
        }
        h.onDone({ count: 0, timedOut: false });
      }, 1);
    },
  });
  const r = await s.get('video', { fresh: true });
  assert.equal(r.needsSetup, false);
  const gaming = r.sections.find((x) => x.id === 'gaming');
  assert.deepEqual(gaming.items, []);
  assert.equal(gaming.error, 'Could not load this section. Try again later.');
  assert.equal(JSON.stringify(r).includes('SECRET'), false, 'the raw yt-dlp message is not sent');
  assert.equal(JSON.stringify(r).includes('/home/me'), false);
  const learning = r.sections.find((x) => x.id === 'learning');
  assert.deepEqual(learning.items, [{
    id: 'a', title: 'T', url: 'https://x.example/a', duration: 5, channel: 'U', thumbnail: '', views: 9,
  }]);
  assert.equal(learning.error, undefined);
});

test('sections run two at a time, keep their order, and use ytmsearch with eight results for music', async () => {
  let running = 0;
  let peak = 0;
  const sources = new Set();
  const limits = new Set();
  const s = createSuggestions({
    detect: async () => ({ ytdlp: { installed: true } }),
    search: (query, limit, h, opts) => {
      sources.add(opts.source);
      limits.add(limit);
      running += 1;
      peak = Math.max(peak, running);
      setTimeout(() => { running -= 1; h.onDone({ count: 0, timedOut: false }); }, 10);
    },
  });
  const r = await s.get('music');
  assert.equal(CONCURRENCY, 2);
  assert.equal(peak, 2, 'never more than two searches at once');
  assert.deepEqual(r.sections.map((x) => x.id), MUSIC_SECTIONS.map(([id]) => id));
  assert.deepEqual([...sources], ['ytmsearch']);
  assert.deepEqual([...limits], [SECTION_LIMIT]);
});

test('the cache lasts 5 minutes, and a request during a running fetch shares it', async () => {
  let clock = 1_000_000;
  let searches = 0;
  const s = createSuggestions({
    now: () => clock,
    detect: async () => ({ ytdlp: { installed: true } }),
    search: (q, l, h) => { searches += 1; setTimeout(() => h.onDone({ count: 0, timedOut: false }), 5); },
  });
  const [a, b] = await Promise.all([s.get('video'), s.get('video')]);
  assert.equal(a, b, 'the second request gets the same running fetch');
  assert.equal(searches, 5);
  assert.equal(CACHE_MS, 5 * 60_000);
  clock += CACHE_MS - 1;
  await s.get('video');
  assert.equal(searches, 5, 'still cached just before 5 minutes');
  clock += 1;
  await s.get('video');
  assert.equal(searches, 10, 'refetched once 5 minutes have passed');
});

test('search sources and the batch link list follow their rules', () => {
  assert.equal(searchSourceFor('music'), 'ytmsearch');
  assert.equal(searchSourceFor('video'), 'ytsearch');
  assert.throws(() => searchStream('cats', 1, { onItem() {}, onDone() {}, onError() {} }, { source: 'bogus' }), /Unknown search source/);
  assert.deepEqual(batchLinks('https://a.example/1\r\n\r\n https://a.example/2 \n'), ['https://a.example/1', 'https://a.example/2']);
  assert.throws(() => batchLinks(' \n '), (e) => e.status === 400);
});
