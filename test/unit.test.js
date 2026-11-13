'use strict';
// Unit tests: argument building, search parsing, video-info summary, quality tiers, files and queue.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { buildArgs, validateUrl, parseSearchLine, summarize, friendlyError, tierFor } = require('../src/ytdlp');

const OUT = path.join(os.tmpdir(), 'vidyra-unit');

test('validateUrl accepts http(s) and rejects other schemes', () => {
  assert.equal(validateUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  assert.throws(() => validateUrl('file:///etc/passwd'), /http/);
  assert.throws(() => validateUrl('javascript:alert(1)'), /http/);
  assert.throws(() => validateUrl('not a url'), /full link/);
});

test('video args pick a height cap, container and phone-friendly codecs', () => {
  const a = buildArgs({ url: 'https://example.com/v', mode: 'video', height: 720, container: 'mp4', outDir: OUT });
  const f = a[a.indexOf('-f') + 1];
  assert.ok(f.startsWith('bv*[height<=720]+ba'), f);
  assert.equal(a[a.indexOf('--merge-output-format') + 1], 'mp4');
  assert.ok(a.includes('-S'), 'mp4 prefers H.264/AAC');
  assert.equal(a.at(-1), 'https://example.com/v');
  assert.equal(a.at(-2), '--');
});

test('audio language selects a dubbed track first, then falls back', () => {
  const a = buildArgs({ url: 'https://example.com/v', mode: 'video', height: 'best', audioLang: 'hi', outDir: OUT });
  const f = a[a.indexOf('-f') + 1];
  assert.ok(f.startsWith('bv*+ba[language^=hi]/'), f);
  assert.throws(() => buildArgs({ url: 'https://example.com/v', audioLang: 'hi]; rm', outDir: OUT }), /language/);
});

test('invalid heights and containers fall back to safe defaults', () => {
  const a = buildArgs({ url: 'https://example.com/v', height: 999, container: 'exe', outDir: OUT });
  assert.equal(a[a.indexOf('--merge-output-format') + 1], 'mp4');
  assert.ok(!a[a.indexOf('-f') + 1].includes('height<=999'));
});

test('audio mode extracts audio in the chosen format and never merges video', () => {
  const a = buildArgs({ url: 'https://example.com/v', mode: 'audio', audioFormat: 'flac', outDir: OUT });
  assert.ok(a.includes('-x'));
  assert.equal(a[a.indexOf('--audio-format') + 1], 'flac');
  assert.ok(!a.includes('--merge-output-format'));
});

test('subtitles are optional so a 429 on captions cannot abort the video', () => {
  const a = buildArgs({ url: 'https://example.com/v', subs: true, subLangs: 'en,hi', outDir: OUT });
  assert.ok(a.includes('--ignore-errors'));
  assert.equal(a[a.indexOf('--sub-langs') + 1], 'en,hi');
  assert.ok(a.includes('--embed-subs'));
  const none = buildArgs({ url: 'https://example.com/v', outDir: OUT });
  assert.ok(!none.includes('--write-subs'));
});

test('concurrency is clamped to 1..32', () => {
  const a = buildArgs({ url: 'https://example.com/v', concurrentFragments: 500, outDir: OUT });
  assert.equal(a[a.indexOf('-N') + 1], '32');
});

test('parseSearchLine reads tab-separated fields and keeps tabs inside titles', () => {
  const item = parseSearchLine('abc12345678\thttps://www.youtube.com/watch?v=abc12345678\t95\tChannel X\t12345\tNA\tPart 1\tof 2');
  assert.equal(item.id, 'abc12345678');
  assert.equal(item.duration, 95);
  assert.equal(item.uploader, 'Channel X');
  assert.equal(item.view_count, 12345);
  assert.equal(item.title, 'Part 1 of 2');
  assert.equal(item.thumbnail, 'https://i.ytimg.com/vi/abc12345678/mqdefault.jpg', 'falls back to the YouTube thumbnail');
});

test('parseSearchLine ignores malformed or empty rows', () => {
  assert.equal(parseSearchLine('only\ttwo'), null);
  assert.equal(parseSearchLine('NA\tNA\tNA\tNA\tNA\tNA\tNA'), null);
});

test('summarize lists heights (best fps per height) and groups regional audio tracks', () => {
  const info = summarize({
    id: 'x', title: 'T', duration: 10,
    formats: [
      { vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, ext: 'mp4', filesize: 100 },
      { vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 60, ext: 'mp4', filesize: 200 },
      { vcodec: 'none', acodec: 'mp4a', abr: 128, language: 'hi-IN' },
      { vcodec: 'none', acodec: 'mp4a', abr: 128, language: 'hi' },
      { vcodec: 'none', acodec: 'mp4a', abr: 128, language: 'en-US' },
    ],
  });
  assert.equal(info.heights.length, 1);
  assert.equal(info.heights[0].fps, 60);
  assert.deepEqual(info.audioLanguages.map((l) => l.code), ['hi', 'en']);
  assert.equal(info.audioLanguages[0].name, 'Hindi');
});

test('friendlyError turns yt-dlp output into plain language', () => {
  assert.match(friendlyError('ERROR: HTTP Error 429: Too Many Requests'), /rate-limiting/);
  assert.match(friendlyError('ERROR: Private video. Sign in'), /signed-in/);
  assert.match(friendlyError('ERROR: Unsupported URL: https://x'), /not supported/);
});
