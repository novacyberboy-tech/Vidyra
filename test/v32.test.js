'use strict';
// Version 3.2: YouTube Music search fallback, clip ranges and batch voice option.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-v32-'));
const fake = path.join(__dirname, 'fixtures', 'fake-yt-dlp');
process.env.YTDLP_BIN = require('./helpers/launcher').makeLauncher(tmp, fake);
process.env.VIDYRA_NOTIFY = 'off';
const { searchStream, buildArgs } = require('../src/ytdlp');

const collect = (query, source) => new Promise((resolve, reject) => {
  const items = [];
  searchStream(query, 5, {
    onItem: (it) => items.push(it),
    onDone: () => resolve(items),
    onError: (message) => reject(new Error(message)),
  }, { source });
});

test('a YouTube Music search that yt-dlp cannot run falls back to a normal search', async () => {
  process.env.FAKE_YTDLP_NO_MUSIC = '1';
  try {
    const items = await collect('party songs mix', 'ytmsearch');
    assert.ok(items.length > 0, 'the fallback returns results');
    assert.match(items[0].title, /party songs mix official audio/);
  } finally {
    delete process.env.FAKE_YTDLP_NO_MUSIC;
  }
});

test('a YouTube Music search works directly when yt-dlp supports it', async () => {
  const items = await collect('party songs mix', 'ytmsearch');
  assert.ok(items.length > 0);
  assert.match(items[0].title, /audio/);
});

test('clip times are passed as download sections', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: tmp, clipStart: '0:30', clipEnd: '2:15' });
  const i = args.indexOf('--download-sections');
  assert.ok(i >= 0);
  assert.equal(args[i + 1], '*0:30-2:15');
  assert.ok(args.includes('--force-keyframes-at-cuts'));
});

test('an open-ended clip runs to the end of the video', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: tmp, clipStart: '90' });
  assert.equal(args[args.indexOf('--download-sections') + 1], '*90-inf');
});

test('a bad clip time is refused', () => {
  assert.throws(() => buildArgs({ url: 'https://example.com/v', outDir: tmp, clipStart: 'soon' }),
    (e) => e.status === 400 && /Clip times/.test(e.message));
});

test('no clip means no download sections argument', () => {
  const args = buildArgs({ url: 'https://example.com/v', outDir: tmp });
  assert.equal(args.includes('--download-sections'), false);
});

after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
