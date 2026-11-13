'use strict';
// Version 3 tests: rename, priority, pause/resume all, file name pattern, music search, history, stats,
// the free-space guard, settings export/import. Runs against the fake yt-dlp fixture like server.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOKEN = 'v3-test-token';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-v3-'));
process.env.VIDYRA_CONFIG = path.join(tmp, 'config.json');
process.env.DOWNLOAD_DIR = path.join(tmp, 'downloads');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, path.join(__dirname, 'fixtures', 'fake-yt-dlp'));
process.env.ACCESS_TOKEN = TOKEN; // every /api request below must carry it
process.env.VIDYRA_NOTIFY = 'off';
delete process.env.HOST;

const { server, queue } = require('../server');
const { buildArgs, checkNameTemplate } = require('../src/ytdlp');
const { JobQueue } = require('../src/jobs');
const { lowSpace, ensureFreeSpace, historyOf, statsOf } = require('../src/features');
const { DEFAULT_NAME_TEMPLATE } = require('../src/config');

const DL = process.env.DOWNLOAD_DIR;
const MB = 1024 * 1024;
const VALID_TEMPLATE = '%(uploader)s - %(title).50B [%(id)s].%(ext)s';
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

async function waitFor(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 60));
  }
}

const jobById = (id) => queue.list().find((j) => j.id === id);
const isDone = (id) => ['done', 'error'].includes(jobById(id)?.status);
const download = async (url, extra = {}) => (await json('POST', '/api/download', { body: { url, mode: 'video', ...extra } })).data;

test('new routes keep the token and JSON-only checks', async () => {
  const badToken = await req('POST', '/api/jobs/pause-all', { body: {}, headers: { 'x-token': 'wrong' } });
  assert.equal(badToken.status, 401);
  assert.equal((await req('GET', '/api/stats', { headers: { 'x-token': 'wrong' } })).status, 401);
  const plain = { 'Content-Type': 'text/plain' };
  assert.equal((await req('POST', '/api/files/rename', { body: 'from=a&to=b', headers: plain })).status, 415);
  assert.equal((await req('POST', '/api/jobs/resume-all', { body: '{}', headers: plain })).status, 415);
  assert.equal((await req('POST', '/api/settings/import', { body: '{}', headers: plain })).status, 415);
});

test('rename changes a finished file, keeps its extension and never overwrites', async () => {
  fs.writeFileSync(path.join(DL, 'Rename me [rn1].mp4'), 'x');
  fs.writeFileSync(path.join(DL, 'Taken [rn2].mp4'), 'x');
  const ok = await json('POST', '/api/files/rename', { body: { from: 'Rename me [rn1].mp4', to: 'Renamed [rn1].mp4' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data, { name: 'Renamed [rn1].mp4' });
  assert.ok(fs.existsSync(path.join(DL, 'Renamed [rn1].mp4')));
  assert.equal(fs.existsSync(path.join(DL, 'Rename me [rn1].mp4')), false);
  const taken = await json('POST', '/api/files/rename', { body: { from: 'Renamed [rn1].mp4', to: 'Taken [rn2].mp4' } });
  assert.equal(taken.status, 409);
  const same = await json('POST', '/api/files/rename', { body: { from: 'Renamed [rn1].mp4', to: 'Renamed [rn1].mp4' } });
  assert.equal(same.status, 409);
  const ext = await json('POST', '/api/files/rename', { body: { from: 'Renamed [rn1].mp4', to: 'Renamed [rn1].mkv' } });
  assert.equal(ext.status, 400);
  assert.match(ext.data.error, /extension/);
  const missing = await json('POST', '/api/files/rename', { body: { from: 'Nope [zz9].mp4', to: 'Nope2 [zz9].mp4' } });
  assert.equal(missing.status, 404);
});

test('rename refuses paths, "..", hidden and control-character names', async () => {
  const bad = ['../escape.mp4', 'sub/x.mp4', 'sub\\x.mp4', '..x.mp4', '.hidden.mp4', 'bad\u0001.mp4', '  .mp4', ''];
  for (const to of bad) {
    const r = await json('POST', '/api/files/rename', { body: { from: 'Renamed [rn1].mp4', to } });
    assert.equal(r.status, 400, JSON.stringify(to));
  }
  const fromBad = await json('POST', '/api/files/rename', { body: { from: '../Renamed [rn1].mp4', to: 'x.mp4' } });
  assert.equal(fromBad.status, 400);
  assert.ok(fs.existsSync(path.join(DL, 'Renamed [rn1].mp4')), 'nothing was moved');
});

test('a waiting download can be moved to the front; a running one cannot', async () => {
  await json('POST', '/api/settings', { body: { maxParallel: 1 } });
  const a = await download('https://example.com/slow/p1');
  const b = await download('https://example.com/slow/p2');
  const c = await download('https://example.com/slow/p3');
  await waitFor(() => jobById(a.id)?.status === 'downloading' && jobById(a.id).percent > 0);
  assert.equal(jobById(b.id).status, 'queued');
  const moved = await json('POST', `/api/jobs/${c.id}/prioritise`, { body: {} });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.id, c.id);
  assert.equal(queue.queue[0].id, c.id, 'the moved download is first in line');
  assert.equal((await json('POST', `/api/jobs/${a.id}/prioritise`, { body: {} })).status, 409);
  assert.equal((await json('POST', '/api/jobs/nope0000000/prioritise', { body: {} })).status, 404);
  for (const j of [a, b, c]) await json('POST', `/api/jobs/${j.id}/cancel`);
  await json('POST', '/api/settings', { body: { maxParallel: 2 } });
});

test('pause-all and resume-all act on every running download and report how many', async () => {
  const x = await download('https://example.com/slow/p4');
  const y = await download('https://example.com/slow/p5');
  await waitFor(() => jobById(x.id)?.percent > 0 && jobById(y.id)?.percent > 0);
  const paused = await json('POST', '/api/jobs/pause-all', { body: {} });
  assert.deepEqual(paused.data, { count: 2 });
  assert.equal(jobById(x.id).status, 'paused');
  assert.equal(jobById(y.id).status, 'paused');
  const resumed = await json('POST', '/api/jobs/resume-all', { body: {} });
  assert.deepEqual(resumed.data, { count: 2 });
  assert.equal(jobById(x.id).status, 'downloading');
  assert.deepEqual((await json('POST', '/api/jobs/resume-all', { body: {} })).data, { count: 0 });
  for (const j of [x, y]) await json('POST', `/api/jobs/${j.id}/cancel`);
});

test('the file name pattern defaults to the built-in one and is strict when changed', async () => {
  const cur = await json('GET', '/api/settings');
  assert.equal(cur.data.nameTemplate, DEFAULT_NAME_TEMPLATE);
  assert.equal(cur.data.minFreeMb, 500);
  const bad = [
    '%(title)s.%(ext)s', // no [%(id)s]
    '%(title)s [%(id)s]', // no %(ext)s
    '%(duration)s [%(id)s].%(ext)s', // field not allowed
    '%(title)s [%(id)s] %(filesize)s.%(ext)s',
    '%(title).1000B [%(id)s].%(ext)s', // width too large
    '%(title) [%(id)s].%(ext)s', // malformed field
    '%(title).100B [%(id)s].%(ext)s%%', // literal percent
    '../%(title)s [%(id)s].%(ext)s', // folder
    'sub/%(title)s [%(id)s].%(ext)s', // folder
    '%(title).100B [%(id)s].%(ext)s..', // ".."
  ];
  for (const nameTemplate of bad) {
    const r = await json('POST', '/api/settings', { body: { nameTemplate } });
    assert.equal(r.status, 400, nameTemplate);
    assert.match(r.data.error, /name pattern|Only these fields/, nameTemplate);
  }
  const ok = await json('POST', '/api/settings', { body: { nameTemplate: VALID_TEMPLATE } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.nameTemplate, VALID_TEMPLATE);
  assert.equal((await json('GET', '/api/settings')).data.nameTemplate, VALID_TEMPLATE);
});

test('the name pattern reaches the -o path of yt-dlp, and a custom title still wins', () => {
  const url = 'https://example.com/v';
  const a = buildArgs({ url, mode: 'video', outDir: DL, nameTemplate: VALID_TEMPLATE });
  assert.equal(a[a.indexOf('-o') + 1], path.join(DL, VALID_TEMPLATE));
  const b = buildArgs({ url, mode: 'video', outDir: DL, nameTemplate: 'broken' });
  assert.equal(b[b.indexOf('-o') + 1], path.join(DL, DEFAULT_NAME_TEMPLATE), 'an invalid saved pattern falls back');
  const c = buildArgs({ url, mode: 'video', outDir: DL, nameTemplate: VALID_TEMPLATE, customTitle: 'My clip' });
  assert.equal(c[c.indexOf('-o') + 1], path.join(DL, 'My clip [%(id)s].%(ext)s'));
  assert.equal(checkNameTemplate(''), DEFAULT_NAME_TEMPLATE);
});

test('set name and set minfree work from the command line, and bad values are refused', async () => {
  const set = await json('POST', '/api/command', { body: { line: 'set name "%(title).60B [%(id)s].%(ext)s"' } });
  assert.equal(set.status, 200);
  assert.equal((await json('GET', '/api/settings')).data.nameTemplate, '%(title).60B [%(id)s].%(ext)s');
  assert.equal((await json('POST', '/api/command', { body: { line: 'set name "%(duration)s [%(id)s].%(ext)s"' } })).status, 400);
  await json('POST', '/api/settings', { body: { nameTemplate: '' } });
  assert.equal((await json('GET', '/api/settings')).data.nameTemplate, DEFAULT_NAME_TEMPLATE, 'empty means the default');

  assert.equal((await json('POST', '/api/command', { body: { line: 'set minfree 300' } })).status, 200);
  assert.equal((await json('GET', '/api/settings')).data.minFreeMb, 300);
  assert.equal((await json('POST', '/api/command', { body: { line: 'set minfree lots' } })).status, 400);
  await json('POST', '/api/settings', { body: { minFreeMb: 500 } });
});

test('minimum free space is clamped to 0 to 20000 MB', async () => {
  assert.equal((await json('POST', '/api/settings', { body: { minFreeMb: 99999 } })).data.minFreeMb, 20000);
  assert.equal((await json('POST', '/api/settings', { body: { minFreeMb: -5 } })).data.minFreeMb, 0);
  await json('POST', '/api/settings', { body: { minFreeMb: 500 } });
});

test('lowSpace refuses only when free space is known, below the minimum and not forced', () => {
  assert.equal(lowSpace(null, 500), false, 'unknown free space never blocks');
  assert.equal(lowSpace(100 * MB, 500), true);
  assert.equal(lowSpace(100 * MB, 500, true), false, 'force gets past the check');
  assert.equal(lowSpace(1000 * MB, 500), false);
  assert.equal(lowSpace(0, 0), false, 'a minimum of 0 turns the check off');
});

test('the free-space guard throws 507 below the minimum and passes when forced or when space is unknown', async () => {
  const huge = 1e9; // MB: far more than any disk has, so the check always refuses
  await assert.rejects(ensureFreeSpace(DL, huge, false), (e) => e.status === 507 && /Not enough free space/.test(e.message));
  await ensureFreeSpace(DL, huge, true);
  await ensureFreeSpace(DL, 0, false);
  await ensureFreeSpace(path.join(tmp, 'no-such-folder'), huge, false);
});

test('a download is refused with 507 when the device is nearly full, unless forced', async (t) => {
  const { data } = await json('GET', '/api/files');
  if (typeof data.freeBytes !== 'number' || data.freeBytes >= 20000 * MB) {
    return t.skip('free space is too large for the 20000 MB guard to trigger on this machine');
  }
  await json('POST', '/api/settings', { body: { minFreeMb: 20000 } });
  try {
    const refused = await json('POST', '/api/download', { body: { url: 'https://example.com/v/full', mode: 'video' } });
    assert.equal(refused.status, 507);
    assert.equal(refused.data.error, 'Not enough free space on this device');
    const refusedCmd = await json('POST', '/api/command', { body: { line: 'add https://example.com/v/full' } });
    assert.equal(refusedCmd.status, 507);
    const forced = await json('POST', '/api/download', { body: { url: 'https://example.com/v/full', mode: 'video', force: true } });
    assert.equal(forced.status, 200);
    await waitFor(() => isDone(forced.data.id));
  } finally {
    await json('POST', '/api/settings', { body: { minFreeMb: 500 } });
  }
});

test('music search adds "audio" to the query and keeps the same result shape', async () => {
  const r = await req('GET', '/api/search?q=cats&kind=music&limit=1');
  assert.equal(r.status, 200);
  const lines = r.text.trim().split('\n').map((l) => JSON.parse(l));
  const items = lines.filter((l) => l.type === 'item').map((l) => l.item);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /^cats audio result 1/);
  assert.equal(lines.at(-1).type, 'done');
  const plain = await req('GET', '/api/search?q=cats&limit=1');
  assert.match(JSON.parse(plain.text.trim().split('\n')[0]).item.title, /^cats result 1/);
  assert.equal((await json('GET', '/api/search?q=cats&kind=podcast')).status, 400);
  const cmd = await json('POST', '/api/command', { body: { line: 'search lofi --music --limit=1' } });
  assert.equal(cmd.status, 200);
  assert.match(cmd.data.data[0].title, /^lofi audio result 1/);
});

test('finished downloads go to the history with their time and size; failed ones do not', async () => {
  const ok = await download('https://example.com/v/history1', { title: 'History one' });
  await waitFor(() => jobById(ok.id)?.status === 'done');
  const bad = await download('https://example.com/fail/history');
  await waitFor(() => isDone(bad.id));
  const h = await json('GET', '/api/history');
  assert.equal(h.status, 200);
  const row = h.data.find((x) => x.id === ok.id);
  assert.ok(row, 'the finished download is listed');
  assert.equal(row.title, 'History one');
  assert.match(row.file, /\.mp4$/);
  assert.equal(row.mode, 'video');
  assert.equal(row.size, 4096);
  assert.ok(row.finishedAt > 0);
  assert.deepEqual(Object.keys(row).sort(), ['file', 'finishedAt', 'id', 'mode', 'size', 'title']);
  assert.equal(h.data.some((x) => x.id === bad.id), false);
  const times = h.data.map((x) => x.finishedAt);
  assert.deepEqual(times, [...times].sort((x, y) => y - x), 'newest first');
  const cmd = await json('POST', '/api/command', { body: { line: 'history' } });
  assert.match(cmd.data.text, /History one/);
  assert.ok(cmd.data.text.split('\n').length <= 20);
});

test('stats count the library, finished and failed downloads, and the average speed', async () => {
  const ok = await download('https://example.com/v/stats1');
  await waitFor(() => jobById(ok.id)?.status === 'done');
  const bad = await download('https://example.com/fail/stats1');
  await waitFor(() => isDone(bad.id));
  const s = await json('GET', '/api/stats');
  assert.equal(s.status, 200);
  assert.deepEqual(Object.keys(s.data).sort(), ['activeCount', 'averageSpeedKbps', 'doneCount', 'failedCount', 'totalBytes', 'totalFiles']);
  assert.ok(s.data.doneCount >= 1);
  assert.ok(s.data.failedCount >= 1);
  assert.ok(s.data.totalFiles >= 1);
  assert.ok(s.data.totalBytes >= 4096);
  assert.ok(s.data.averageSpeedKbps > 0, 'a finished download has a speed');
  const cmd = await json('POST', '/api/command', { body: { line: 'stats' } });
  assert.match(cmd.data.text, /Done:/);
  assert.match(cmd.data.text, /Average:/);
});

test('statsOf and historyOf work on plain rows, with empty input and the 200 limit', () => {
  assert.deepEqual(statsOf([], []), {
    totalFiles: 0, totalBytes: 0, doneCount: 0, failedCount: 0, activeCount: 0, averageSpeedKbps: 0,
  });
  const jobs = Array.from({ length: 205 }, (_, i) => ({
    id: `j${i}`, status: 'done', finishedAt: i + 1, title: 't', file: 'f', mode: 'video', bytes: 1,
  }));
  jobs.push({ id: 'err', status: 'error', finishedAt: 999999 });
  const rows = historyOf(jobs);
  assert.equal(rows.length, 200);
  assert.equal(rows[0].id, 'j204');
  assert.equal(rows.some((r) => r.id === 'err'), false);
});

test('an older jobs.json without the new fields still loads, and its finished time is used', () => {
  const file = path.join(tmp, 'old-jobs.json');
  fs.writeFileSync(file, JSON.stringify([{
    id: 'old00001', url: 'https://example.com/old', title: 'Old', status: 'done', percent: 100,
    file: '/x/Old [old00001].mp4', created: 1, finished: 5000, opts: { url: 'https://example.com/old', mode: 'video' },
    dests: [], log: [],
  }]));
  const q = new JobQueue({ getOutDir: () => tmp, getMaxParallel: () => 0, persistFile: file });
  const [row] = q.list();
  assert.equal(row.status, 'done');
  assert.equal(row.finishedAt, 5000);
  assert.equal(row.bytes, 0);
  assert.deepEqual(historyOf(q.list()).map((h) => h.id), ['old00001']);
  q.persistNow();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal(saved.finishedAt, 5000);
  assert.equal(saved.bytes, 0);
});

test('settings export leaves out cookies and secrets, and import reports what it applied', async () => {
  const cookie = path.join(tmp, 'cookies-v3.txt');
  fs.writeFileSync(cookie, '# Netscape HTTP Cookie File\n');
  await json('POST', '/api/settings', { body: { cookiesFile: cookie, extraArgs: '--password=hunter2', maxParallel: 3 } });
  const raw = await req('GET', '/api/settings/export');
  assert.equal(raw.status, 200);
  const exp = { data: JSON.parse(raw.text) };
  assert.equal('cookiesFile' in exp.data, false);
  assert.equal('extraArgs' in exp.data, false, 'token-like extra arguments are not shared');
  assert.equal(exp.data.maxParallel, 3);
  assert.equal(exp.data.minFreeMb, 500);
  assert.equal(raw.text.includes('hunter2'), false);
  assert.equal(raw.text.includes(cookie), false);

  const imp = await json('POST', '/api/settings/import', { body: {
    maxParallel: 2, retries: 2, bogus: 'x', cookiesFile: '/etc/passwd', extraArgs: '--password=zzz', nameTemplate: 'no id here',
  } });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.data.applied, ['maxParallel', 'retries']);
  assert.deepEqual([...imp.data.ignored].sort(), ['bogus', 'cookiesFile', 'extraArgs']);
  assert.equal(imp.data.rejected.length, 1);
  assert.equal(imp.data.rejected[0].key, 'nameTemplate');
  assert.match(imp.data.rejected[0].error, /\[%\(id\)s\]/);
  const now = await json('GET', '/api/settings');
  assert.equal(now.data.maxParallel, 2);
  assert.equal(now.data.retries, 2);
  assert.equal(now.data.cookiesFile, cookie, 'import never changes the cookies file');
  await json('POST', '/api/settings', { body: { cookiesFile: '', extraArgs: '', maxParallel: 2, retries: 1 } });
});
