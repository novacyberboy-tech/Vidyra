'use strict';
// Version 3.3: in-app playback. Song metadata, a cached direct audio link, and a Range-capable stream.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-v33-'));
process.env.VIDYRA_CONFIG = path.join(tmp, 'config.json');
process.env.DOWNLOAD_DIR = path.join(tmp, 'downloads');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, path.join(__dirname, 'fixtures', 'fake-yt-dlp'));
process.env.VIDYRA_NOTIFY = 'off';
process.env.ACCESS_TOKEN = 'letmein-123';
const LOG = path.join(tmp, 'ytdlp.log');
process.env.FAKE_YTDLP_LOG = LOG;

const { server, queue } = require('../server');
const AUDIO = Buffer.from('0123456789abcdefghij'.repeat(20)); // 400 bytes of fake audio
let media, mediaPort, port;
const gone = { count: 0 };

before(async () => {
  // Stands in for the Google video host: honours Range, and answers 403 once for /gone (an expired link).
  media = http.createServer((req, res) => {
    if (req.url.startsWith('/gone') && gone.count++ === 0) { res.writeHead(403); return res.end(); }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Type': 'audio/mp4', 'Content-Length': AUDIO.length, 'Accept-Ranges': 'bytes' }); return res.end(AUDIO); }
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), AUDIO.length - 1) : AUDIO.length - 1;
    res.writeHead(206, {
      'Content-Type': 'audio/mp4', 'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${AUDIO.length}`, 'Accept-Ranges': 'bytes',
    });
    res.end(AUDIO.subarray(start, end + 1));
  });
  await new Promise((resolve) => media.listen(0, '127.0.0.1', resolve));
  mediaPort = media.address().port;
  process.env.VIDYRA_MEDIA_HOST_ALLOW = '127.0.0.1';
  process.env.FAKE_YTDLP_AUDIO_URL = `http://127.0.0.1:${mediaPort}/song.m4a`;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  for (const j of queue.list()) { try { queue.cancel(j.id); } catch { /* finished */ } }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  media.closeAllConnections?.();
  await new Promise((resolve) => media.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function get(p, headers = {}) {
  const sep = p.includes('?') ? '&' : '?';
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: `${p}${sep}token=letmein-123`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
const json = (r) => JSON.parse(r.body.toString('utf8'));
const resolvesFor = (id) => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n')
  .filter((l) => l.includes(`watch?v=${id}`)).length : 0);

test('a bad song id is refused before yt-dlp runs', async () => {
  const r = await get('/api/play?id=not-valid');
  assert.equal(r.status, 400);
  assert.match(json(r).error, /not valid/);
});

test('the song page returns metadata and a media source', async () => {
  const r = await get('/api/play?id=abc123xyz00');
  assert.equal(r.status, 200);
  const j = json(r);
  assert.equal(j.id, 'abc123xyz00');
  assert.ok(j.title);
  assert.equal(j.src, '/api/media/abc123xyz00');
  assert.ok(!('url' in j), 'the raw audio link is never sent to the browser');
});

test('a second request for the same song reuses the cached link', async () => {
  await get('/api/play?id=cachedID001');
  await get('/api/play?id=cachedID001');
  assert.equal(resolvesFor('cachedID001'), 1);
});

test('the audio streams with Range support (206 Partial Content)', async () => {
  const r = await get('/api/media/abc123xyz00', { Range: 'bytes=0-9' });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], `bytes 0-9/${AUDIO.length}`);
  assert.equal(r.body.toString('utf8'), AUDIO.subarray(0, 10).toString('utf8'));
  assert.equal(r.headers['accept-ranges'], 'bytes');
});

test('the full audio streams without a Range header', async () => {
  const r = await get('/api/media/abc123xyz00');
  assert.equal(r.status, 200);
  assert.equal(r.body.length, AUDIO.length);
});

test('a link that is not on a Google video host is refused', async () => {
  const saved = process.env.VIDYRA_MEDIA_HOST_ALLOW;
  const savedUrl = process.env.FAKE_YTDLP_AUDIO_URL;
  delete process.env.VIDYRA_MEDIA_HOST_ALLOW;
  process.env.FAKE_YTDLP_AUDIO_URL = 'https://evil.example.com/song.m4a';
  try {
    const r = await get('/api/play?id=refuseID001');
    assert.equal(r.status, 200, 'metadata is returned; only the stream checks the host');
    const s = await get('/api/media/refuseID001');
    assert.equal(s.status, 502);
    assert.match(json(s).error, /not allowed/);
  } finally {
    process.env.VIDYRA_MEDIA_HOST_ALLOW = saved;
    process.env.FAKE_YTDLP_AUDIO_URL = savedUrl;
  }
});

test('an expired link is resolved again once and the stream still plays', async () => {
  const savedUrl = process.env.FAKE_YTDLP_AUDIO_URL;
  process.env.FAKE_YTDLP_AUDIO_URL = `http://127.0.0.1:${mediaPort}/gone.m4a`;
  try {
    const r = await get('/api/media/expiredID01');
    assert.equal(r.status, 200);
    assert.equal(r.body.length, AUDIO.length);
    assert.equal(resolvesFor('expiredID01'), 2, 'yt-dlp ran again after the 403');
  } finally {
    process.env.FAKE_YTDLP_AUDIO_URL = savedUrl;
  }
});

test('the song routes need the access token, which can also be sent as a query parameter', async () => {
  const bare = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/api/play?id=abc123xyz00' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
  assert.equal(bare, 401);
  const withToken = await get('/api/play?id=abc123xyz00');
  assert.equal(withToken.status, 200);
});
