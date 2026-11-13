'use strict';
// Access-token protection (used when Vidyra listens on the network with HOST=0.0.0.0).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-auth-'));
process.env.VIDYRA_CONFIG = path.join(tmp, 'config.json');
process.env.DOWNLOAD_DIR = path.join(tmp, 'downloads');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, path.join(__dirname, 'fixtures', 'fake-yt-dlp'));
process.env.VIDYRA_NOTIFY = 'off';
process.env.ACCESS_TOKEN = 'letmein-123';
delete process.env.HOST;

const { server } = require('../server');
let port;
before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port; });
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); fs.rmSync(tmp, { recursive: true, force: true }); });

const get = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});
const post = (p, headers = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2, ...headers } }, (res) => {
    res.resume(); res.on('end', () => resolve(res.statusCode));
  });
  r.on('error', reject);
  r.end('{}');
});

test('health stays public so the app can show the sign-in prompt', async () => {
  assert.equal(await get('/api/health'), 200);
});

test('API and files require the token', async () => {
  assert.equal(await get('/api/settings'), 401);
  assert.equal(await get('/api/files'), 401);
  assert.equal(await post('/api/jobs/abc/cancel'), 401);
});

test('the token is accepted as a header or as a query parameter', async () => {
  assert.equal(await get('/api/settings', { 'x-token': 'letmein-123' }), 200);
  assert.equal(await get('/api/files?token=letmein-123'), 200);
  assert.equal(await get('/api/settings', { 'x-token': 'wrong' }), 401);
  assert.equal(await get('/api/settings', { 'x-token': 'letmein-12' }), 401, 'length mismatch is refused');
});

test('the app shell itself is public', async () => {
  assert.equal(await get('/'), 200);
  assert.equal(await get('/js/app.js'), 200);
});
