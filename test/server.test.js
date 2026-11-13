'use strict';
// Server tests: the full API against the fake yt-dlp fixture, plus a real ffmpeg-made MP4 for playback.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-server-'));
process.env.VIDYRA_CONFIG = path.join(tmp, 'config.json');
process.env.DOWNLOAD_DIR = path.join(tmp, 'downloads');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, path.join(__dirname, 'fixtures', 'fake-yt-dlp'));
delete process.env.ACCESS_TOKEN;
process.env.VIDYRA_NOTIFY = 'off'; // no Android notification processes while testing
delete process.env.HOST;

const { server, queue } = require('../server');
const DL = process.env.DOWNLOAD_DIR;
let port;

before(async () => {
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
    // The app always sends JSON, even for bodiless POST/DELETE; the server requires it.
    const h = { 'Content-Type': 'application/json', ...headers };
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

test('health is public and reports the brand', async () => {
  const { status, data } = await json('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.name, 'Vidyra');
  assert.equal(data.tokenRequired, false);
});

test('settings report detected tools and the download folder', async () => {
  const { status, data } = await json('GET', '/api/settings?refresh=1');
  assert.equal(status, 200);
  assert.equal(data.tools.ytdlp.installed, true);
  assert.equal(data.tools.ytdlp.version, '2025.10.22');
  assert.equal(data.downloadDir, DL);
  assert.deepEqual(data.fragmentOptions, [1, 2, 4, 8, 16, 24, 32]);
});

test('state-changing requests must be JSON (blocks cross-site form posts)', async () => {
  const { status } = await req('POST', '/api/settings', { body: 'maxParallel=3', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(status, 415);
});

test('a foreign Host header is refused on loopback (DNS rebinding guard)', async () => {
  const r = await req('GET', '/api/health', { headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
});

test('paths cannot escape the public folder or the downloads folder', async () => {
  assert.equal((await req('GET', '/files/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await req('GET', '/../server.js')).status, 404);
  assert.equal((await req('GET', '/../package.json')).status, 404);
  assert.equal((await req('GET', '/%2e%2e/config.json')).status, 404);
});

test('static app shell is served with the right types', async () => {
  const index = await req('GET', '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.match(index.text, /<title>Vidyra/);
  const css = await req('GET', '/css/app.css');
  assert.match(css.headers['content-type'], /text\/css/);
  assert.equal((await req('GET', '/icons/icon-192.png')).headers['content-type'], 'image/png');
});

test('info rejects bad links with a readable message', async () => {
  const { status, data } = await json('POST', '/api/info', { body: { url: 'ftp://example.com/x' } });
  assert.equal(status, 400);
  assert.match(data.error, /http/);
});

test('info summarises formats from yt-dlp -J', async () => {
  const { status, data } = await json('POST', '/api/info', { body: { url: 'https://example.com/watch/info1' } });
  assert.equal(status, 200);
  assert.equal(data.heights[0].height, 1080);
  assert.ok(data.audioLanguages.some((l) => l.code === 'hi'));
});

test('info failures carry the site error in plain words', async () => {
  const { status, data } = await json('POST', '/api/info', { body: { url: 'https://example.com/fail/me' } });
  assert.equal(status, 422);
  assert.match(data.error, /not supported|Could not|unavailable|signed-in|rate/i);
});

test('search streams results as NDJSON and ends with a done line', async () => {
  const r = await req('GET', '/api/search?q=cats&limit=3');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /ndjson/);
  const lines = r.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.type === 'item').length, 3);
  assert.equal(lines.at(-1).type, 'done');
  assert.equal(lines.find((l) => l.item && l.item.id === 'vid00000002').item.title, 'Tabbed title line');
});

test('search rejects an empty query before streaming', async () => {
  const { status, data } = await json('GET', '/api/search?q=%20%20');
  assert.equal(status, 400);
  assert.match(data.error, /Type something/);
});

test('download → queue done → library lists the file → delete', async () => {
  const { status, data } = await json('POST', '/api/download', {
    body: { url: 'https://example.com/v/one', title: 'Flow video', mode: 'video', height: 720, container: 'mp4' },
  });
  assert.equal(status, 200);
  const id = data.id;
  await waitFor(() => jobById(id).status === 'done');
  const files = await json('GET', '/api/files');
  const file = files.data.files.find((f) => f.kind === 'video');
  assert.ok(file, 'library shows the downloaded video');
  const removed = await json('DELETE', `/api/files/${encodeURIComponent(file.name)}`);
  assert.equal(removed.status, 200);
  assert.equal((await json('DELETE', `/api/files/${encodeURIComponent(file.name)}`)).status, 404);
  await json('DELETE', `/api/jobs/${id}`);
});

test('an invalid download request is refused before queueing', async () => {
  const { status, data } = await json('POST', '/api/download', { body: { url: 'ftp://nope', mode: 'video' } });
  assert.equal(status, 400);
  assert.match(data.error, /http/);
});

test('a failing download is marked failed with the reason', async () => {
  const { data } = await json('POST', '/api/download', { body: { url: 'https://example.com/fail/x', mode: 'video' } });
  const job = await waitFor(() => {
    const j = jobById(data.id);
    return j && j.status === 'error' ? j : null;
  });
  assert.match(job.error, /403|Forbidden|ERROR/i);
  const retry = await json('POST', `/api/jobs/${data.id}/retry`);
  assert.equal(retry.status, 200);
  assert.equal(jobById(data.id), undefined, 'the failed entry is replaced by the retried one');
  await json('POST', '/api/jobs/clear-finished');
});

test('pause, resume and cancel control a running download', async () => {
  const { data } = await json('POST', '/api/download', { body: { url: 'https://example.com/slow/one', mode: 'video' } });
  const id = data.id;
  await waitFor(() => jobById(id) && jobById(id).status === 'downloading' && jobById(id).percent > 0);
  const paused = await json('POST', `/api/jobs/${id}/pause`);
  assert.equal(paused.data.status, 'paused');
  const resumed = await json('POST', `/api/jobs/${id}/resume`);
  assert.equal(resumed.data.status, 'downloading');
  const cancelled = await json('POST', `/api/jobs/${id}/cancel`);
  assert.equal(cancelled.data.status, 'cancelled');
  await waitFor(() => jobById(id).status === 'cancelled' && jobById(id).child == null);
  assert.equal((await json('DELETE', `/api/jobs/${id}`)).status, 200);
});

test('a paused download can be cancelled (SIGCONT before SIGTERM)', async () => {
  const { data } = await json('POST', '/api/download', { body: { url: 'https://example.com/slow/two', mode: 'video' } });
  const id = data.id;
  await waitFor(() => jobById(id) && jobById(id).status === 'downloading' && jobById(id).percent > 0);
  await json('POST', `/api/jobs/${id}/pause`);
  const c = await json('POST', `/api/jobs/${id}/cancel`);
  assert.equal(c.status, 200);
  await waitFor(() => jobById(id).child == null, 8000);
  assert.equal(jobById(id).status, 'cancelled');
});

test('settings accept safe changes and refuse relative or unusable folders', async () => {
  const ok = await json('POST', '/api/settings', { body: { maxParallel: 3, concurrentFragments: 16 } });
  assert.equal(ok.data.maxParallel, 3);
  assert.equal(ok.data.concurrentFragments, 16);
  const clamped = await json('POST', '/api/settings', { body: { maxParallel: 99 } });
  assert.equal(clamped.data.maxParallel, 6);
  const rel = await json('POST', '/api/settings', { body: { downloadDir: 'relative/dir' } });
  assert.equal(rel.status, 400);
  const newDir = path.join(tmp, 'other-downloads');
  const moved = await json('POST', '/api/settings', { body: { downloadDir: newDir } });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.downloadDir, newDir);
  assert.ok(fs.existsSync(newDir));
  const saved = JSON.parse(fs.readFileSync(process.env.VIDYRA_CONFIG, 'utf8'));
  assert.equal(saved.downloadDir, newDir, 'choices persist to config.json');
  await json('POST', '/api/settings', { body: { downloadDir: DL } });
});

test('real ffmpeg-made MP4 plays and seeks with HTTP Range', async (t) => {
  const probe = spawnSync('ffmpeg', ['-version']);
  if (probe.status !== 0) return t.skip('ffmpeg not installed');
  const sample = path.join(tmp, 'sample.mp4');
  const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10',
    '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample]);
  if (made.status !== 0) return t.skip('could not encode a sample with libx264');
  process.env.FAKE_YTDLP_SAMPLE = sample;
  try {
    const { data } = await json('POST', '/api/download', { body: { url: 'https://example.com/v/real', mode: 'video', container: 'mp4' } });
    await waitFor(() => jobById(data.id).status === 'done');
    const name = jobById(data.id).file;
    const full = await req('GET', `/files/${encodeURIComponent(name)}`);
    assert.equal(full.status, 200);
    assert.equal(full.buf.length, fs.statSync(sample).size);
    assert.match(full.headers['content-type'], /video\/mp4/);
    const range = await req('GET', `/files/${encodeURIComponent(name)}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206);
    assert.equal(range.buf.length, 100);
    assert.match(range.headers['content-range'], new RegExp(`^bytes 0-99/${fs.statSync(sample).size}$`));
    const tail = await req('GET', `/files/${encodeURIComponent(name)}`, { headers: { Range: 'bytes=-50' } });
    assert.equal(tail.buf.length, 50);
    const save = await req('GET', `/files/${encodeURIComponent(name)}?dl=1`);
    assert.match(save.headers['content-disposition'], /^attachment/);
    await json('DELETE', `/api/jobs/${data.id}`);
  } finally {
    delete process.env.FAKE_YTDLP_SAMPLE;
  }
});

test('a non-standard quality is saved as its standard step and the file is downloaded at that step', async () => {
  const r = await json('POST', '/api/download', { body: { url: 'https://example.com/tier', height: 2026, mode: 'video' } });
  assert.equal(r.status, 200);
  assert.match(r.data.label, /^2160p/);
  await waitFor(() => jobById(r.data.id)?.status === 'done');
});

test('Vidyra lists only real files, reports free space and cleans up leftovers', async () => {
  fs.mkdirSync(DL, { recursive: true });
  fs.writeFileSync(path.join(DL, 'Planted [pl4nt].mp4'), 'x');
  fs.writeFileSync(path.join(DL, 'Planted [pl4nt].webp'), 'x');
  fs.writeFileSync(path.join(DL, 'Planted [pl4nt].en.vtt'), 'x');
  const list = await json('GET', '/api/files');
  const roles = Object.fromEntries(list.data.files.map((f) => [f.name, f.role]));
  assert.equal(roles['Planted [pl4nt].mp4'], 'media');
  assert.equal(roles['Planted [pl4nt].webp'], 'sidecar');
  assert.ok(list.data.leftovers.count >= 2);
  assert.ok(list.data.freeBytes === null || list.data.freeBytes > 0);
  const cleaned = await json('POST', '/api/files/cleanup', { body: {} });
  assert.ok(cleaned.data.removed >= 2);
  assert.equal(fs.existsSync(path.join(DL, 'Planted [pl4nt].webp')), false);
  assert.equal(fs.existsSync(path.join(DL, 'Planted [pl4nt].mp4')), true, 'media is never removed by cleanup');
});

test('settings accept speed limit, retries and cookies, and refuse bad values', async () => {
  const bad = await json('POST', '/api/settings', { body: { speedLimit: 'fast' } });
  assert.equal(bad.status, 400);
  const badCookies = await json('POST', '/api/settings', { body: { cookiesFile: 'relative.txt' } });
  assert.equal(badCookies.status, 400);
  const ok = await json('POST', '/api/settings', { body: { speedLimit: '2m', retries: 9 } });
  assert.equal(ok.data.speedLimit, '2M');
  assert.equal(ok.data.retries, 3, 'retries are capped at 3');
  await json('POST', '/api/settings', { body: { speedLimit: '', retries: 1 } });
});

test('retry-failed queues every failed or cancelled download again', async () => {
  const r = await json('POST', '/api/download', { body: { url: 'https://example.com/fail-retry', mode: 'video' } });
  await waitFor(() => ['error', 'done'].includes(jobById(r.data.id)?.status));
  const res = await json('POST', '/api/jobs/retry-failed', { body: {} });
  assert.equal(typeof res.data.queued, 'number');
  assert.ok(res.data.queued >= 1);
});

test('a download can be marked for the device, and the flag comes back with the job', async () => {
  const r = await json('POST', '/api/download', { body: { url: 'https://example.com/deliver', mode: 'video', deliver: true } });
  assert.equal(r.data.deliver, true);
  await waitFor(() => jobById(r.data.id)?.status === 'done');
});

test('a temporary failure is retried automatically and the job records the attempt', async () => {
  const marker = path.join(tmp, 'flaky-once');
  const flaky = path.join(tmp, 'flaky-yt-dlp.js');
  const fake = path.join(__dirname, 'fixtures', 'fake-yt-dlp');
  // Fails once, then runs the real fake in the same process (one Node start per attempt, which matters on slow phones).
  fs.writeFileSync(flaky, [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    `if (!fs.existsSync(${JSON.stringify(marker)})) {`,
    `  fs.writeFileSync(${JSON.stringify(marker)}, 'x');`,
    "  console.error('ERROR: unable to download video data: Connection reset by peer');",
    '  process.exit(1);',
    '}',
    `require(${JSON.stringify(fake)});`,
  ].join('\n'));
  fs.chmodSync(flaky, 0o755);
  const before = process.env.YTDLP_BIN;
  process.env.YTDLP_BIN = flaky;
  try {
    const r = await json('POST', '/api/download', { body: { url: 'https://example.com/flaky-clip', mode: 'video' } });
    const done = await waitFor(() => {
      const j = jobById(r.data.id);
      return j && j.status === 'done' ? j : null;
    }, 45000);
    assert.equal(done.attempt, 2, 'the job ran a second time');
  } finally {
    process.env.YTDLP_BIN = before;
  }
});

test('every command runs through the API, the same way the command line runs it', async () => {
  const list = await json('GET', '/api/commands');
  assert.equal(list.status, 200);
  const names = list.data.map((c) => c.name);
  for (const n of ['info', 'add', 'list', 'pause', 'retry-failed', 'files', 'clean', 'search', 'settings', 'update-ytdlp']) {
    assert.ok(names.includes(n), `command ${n} is listed`);
  }

  const info = await json('POST', '/api/command', { body: { line: 'info' } });
  assert.equal(info.status, 200);
  assert.match(info.data.text, /Folder:/);

  const added = await json('POST', '/api/command', { body: { args: ['add', 'https://example.com/clip', '--height=720'] } });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.ok(added.data.data.id, 'the command returns the new job');
  const listed = await json('POST', '/api/command', { body: { line: 'list' } });
  assert.match(listed.data.text, new RegExp(added.data.data.id));

  // Bad input gets a plain 400 with a message, never a crash.
  assert.equal((await json('POST', '/api/command', { body: { line: 'rm -rf /' } })).status, 400);
  assert.equal((await json('POST', '/api/command', { body: { line: 'add' } })).status, 400);
  assert.equal((await json('POST', '/api/command', { body: { line: 'set speed fast' } })).status, 400);

  // "set" is a short form of "settings set".
  const set = await json('POST', '/api/command', { body: { line: 'set speed 1m' } });
  assert.equal(set.status, 200);
  const settings = await json('GET', '/api/settings');
  assert.equal(settings.data.speedLimit, '1M');
  await json('POST', '/api/command', { body: { line: 'set speed off' } });
});
