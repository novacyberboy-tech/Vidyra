'use strict';
// Tests for quality tiers, file classification and cleanup, queue persistence and Termux notifications.
process.env.VIDYRA_NOTIFY = 'off'; // no Android notification processes while testing
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tierFor, buildArgs, summarize, cookiesArg } = require('../src/ytdlp');
const { roleOf, listFiles, leftoversOf, cleanupLeftovers, removeSidecarsFor } = require('../src/files');
const { JobQueue } = require('../src/jobs');
const { notificationArgs, progressBar, TermuxNotifier } = require('../src/notify');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-features-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('odd source heights round up to the next standard step', () => {
  assert.equal(tierFor(2026), 2160);
  assert.equal(tierFor(1350), 1440);
  assert.equal(tierFor(1012), 1080);
  assert.equal(tierFor(676), 720);
  assert.equal(tierFor(136), 144);
  assert.equal(tierFor(1080), 1080);
  assert.equal(tierFor(9000), 4320);
  assert.equal(tierFor(0), 0);
  assert.equal(tierFor('abc'), 0);
});

test('a chosen odd height is sent to yt-dlp as its standard step, so the selection is never ignored', () => {
  const a = buildArgs({ url: 'https://example.com/v', mode: 'video', height: 2026, outDir: tmp });
  assert.ok(a[a.indexOf('-f') + 1].includes('[height<=2160]'), a[a.indexOf('-f') + 1]);
});

test('summarize merges odd heights into standard steps and keeps the real height', () => {
  const info = summarize({
    id: 'x', title: 'T', duration: 10,
    formats: [
      { vcodec: 'avc1', acodec: 'none', height: 2026, fps: 30, ext: 'mp4', filesize: 900 },
      { vcodec: 'vp9', acodec: 'none', height: 1350, fps: 30, ext: 'webm', filesize: 400 },
      { vcodec: 'avc1', acodec: 'none', height: 1012, fps: 30, ext: 'mp4', filesize: 200 },
      { vcodec: 'avc1', acodec: 'none', height: 1080, fps: 60, ext: 'mp4', filesize: 300 },
    ],
  });
  const byHeight = Object.fromEntries(info.heights.map((h) => [h.height, h]));
  assert.deepEqual(info.heights.map((h) => h.height), [2160, 1440, 1080]);
  assert.equal(byHeight[2160].actual, 2026);
  assert.equal(byHeight[1080].actual, 1080, 'the larger of 1012 and 1080 is kept');
  assert.equal(byHeight[1080].size, 300);
});

test('speed limit and cookies go to yt-dlp only when they are valid', () => {
  const a = buildArgs({ url: 'https://example.com/v', outDir: tmp, rate: '2m' });
  assert.equal(a[a.indexOf('--limit-rate') + 1], '2M');
  const b = buildArgs({ url: 'https://example.com/v', outDir: tmp, rate: 'fast' });
  assert.equal(b.includes('--limit-rate'), false);
  assert.deepEqual(cookiesArg(''), []);
  assert.throws(() => cookiesArg('cookies.txt'), /full path/);
  assert.throws(() => cookiesArg(path.join(tmp, 'missing.txt')), /not found/);
  const real = path.join(tmp, 'cookies.txt');
  fs.writeFileSync(real, '# Netscape HTTP Cookie File\n');
  assert.deepEqual(cookiesArg(real), ['--cookies', real]);
});

test('files are classified as media, sidecars, partials or other', () => {
  assert.equal(roleOf('Title [abc123].mp4'), 'media');
  assert.equal(roleOf('Title [abc123].mp3'), 'media');
  assert.equal(roleOf('Title [abc123].webp'), 'sidecar');
  assert.equal(roleOf('Title [abc123].en.vtt'), 'sidecar');
  assert.equal(roleOf('Title [abc123].f137.mp4'), 'partial');
  assert.equal(roleOf('Title [abc123].mp4.part'), 'partial');
  assert.equal(roleOf('photo.webp'), 'other', 'files without a yt-dlp [id] are never treated as leftovers');
  assert.equal(roleOf('notes.txt'), 'other');
});

test('leftover cleanup removes sidecars and inactive partials, and keeps active downloads', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'clean-'));
  const write = (name) => fs.writeFileSync(path.join(dir, name), 'x');
  write('Keep [a1].mp4');
  write('Keep [a1].webp');
  write('Old [b2].en.vtt');
  write('Busy [c3].f140.m4a');
  write('Busy [c3].f137.mp4');
  write('Stale [d4].mp4.part');
  const active = new Set(['Busy [c3]']);
  const before = leftoversOf(listFiles(dir, active));
  assert.equal(before.count, 3, 'webp, vtt and the stale partial');
  const result = cleanupLeftovers(dir, active);
  assert.equal(result.removed, 3);
  const names = fs.readdirSync(dir).sort();
  assert.deepEqual(names, ['Busy [c3].f137.mp4', 'Busy [c3].f140.m4a', 'Keep [a1].mp4']);
});

test('removing the sidecars of a finished download leaves other files alone', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'side-'));
  for (const n of ['Show [x9].mp4', 'Show [x9].webp', 'Show [x9].en.vtt', 'Show [y8].webp', 'other.webp']) {
    fs.writeFileSync(path.join(dir, n), 'x');
  }
  assert.equal(removeSidecarsFor(dir, 'Show [x9].mp4'), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['Show [x9].mp4', 'Show [y8].webp', 'other.webp']);
});

test('the queue is saved and reloaded: unfinished downloads wait again, finished ones keep their state', () => {
  const file = path.join(tmp, 'queue-test.json');
  const rows = [
    { id: 'aaaa1', url: 'https://example.com/1', title: 'One', status: 'downloading', percent: 40, created: 2, opts: { url: 'https://example.com/1', mode: 'video', height: 'best' }, dests: [], log: [] },
    { id: 'bbbb2', url: 'https://example.com/2', title: 'Two', status: 'done', percent: 100, created: 1, opts: { url: 'https://example.com/2', mode: 'audio' }, dests: [], log: [] },
    { id: 'cccc3', url: 'not a row' },
  ];
  fs.writeFileSync(file, JSON.stringify(rows));
  const q = new JobQueue({ getOutDir: () => tmp, getMaxParallel: () => 0, persistFile: file });
  const byId = Object.fromEntries(q.list().map((j) => [j.id, j]));
  assert.equal(byId.aaaa1.status, 'queued', 'a download that was running resumes as queued');
  assert.equal(byId.bbbb2.status, 'done');
  assert.equal(byId.cccc3, undefined, 'damaged rows are ignored');
  q.persistNow();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.find((r) => r.id === 'aaaa1').status, 'queued');
});

test('Termux notifications show a progress bar while downloading and a result at the end', () => {
  assert.equal(progressBar(40), '████████░░░░░░░░░░░░ 40%');
  const running = notificationArgs({ id: 'z1', title: 'Clip', status: 'downloading', percent: 55, speed: '2M/s', eta: '00:10' });
  assert.ok(running.includes('--ongoing'));
  assert.ok(running.join(' ').includes('55%'));
  assert.ok(running.join(' ').includes('2M/s · 00:10 left'));
  const failed = notificationArgs({ id: 'z1', title: 'Clip', status: 'error', error: 'HTTP Error 403' });
  assert.ok(failed.includes('Download failed'));
  assert.equal(notificationArgs({ id: 'z1', title: 'Clip', status: 'queued' }), null);
});

test('Termux notifications run one at a time, and only the latest update per download is sent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidyra-notify-'));
  const log = path.join(dir, 'log.txt');
  const bin = path.join(dir, 'fake-termux-notification');
  // Each call records start and end times, then waits a little, like a slow phone would.
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('node:fs');
const start = Date.now();
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ start, end: Date.now(), args: process.argv.slice(2) }) + '\\n');
}, 150);
`);
  fs.chmodSync(bin, 0o755);
  const notifier = new TermuxNotifier({ enabled: true, bin });
  // Ten rapid updates for two downloads: the notifier must not start them all at once.
  for (let i = 0; i < 5; i += 1) {
    notifier.send(['--id', 'vidyra-a', '--title', 'A', '--content', String(i)]);
    notifier.send(['--id', 'vidyra-b', '--title', 'B', '--content', String(i)]);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const runs = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  // No overlap between any two calls.
  runs.sort((x, y) => x.start - y.start);
  for (let i = 1; i < runs.length; i += 1) assert.ok(runs[i].start >= runs[i - 1].end - 5, 'calls overlapped');
  // At most one call per download survived the queue, and the last values won.
  assert.ok(runs.length <= 4, `too many calls: ${runs.length}`);
  const last = runs.map((r) => r.args[r.args.indexOf('--content') + 1]);
  assert.ok(last.includes('4'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('command lines split into words, and quotes keep spaces together', () => {
  const { tokenize, parseArgs, humanBytes } = require('../src/commands');
  assert.deepEqual(tokenize('add "https://x.example/a b" --height=720'), ['add', 'https://x.example/a b', '--height=720']);
  assert.deepEqual(tokenize("search 'lo fi' --limit=3"), ['search', 'lo fi', '--limit=3']);
  const a = parseArgs(['add', 'https://x', '--audio', '--container=mkv']);
  assert.deepEqual(a.pos, ['add', 'https://x']);
  assert.equal(a.flags.audio, true);
  assert.equal(a.flags.container, 'mkv');
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(1536), '1.5 KB');
  assert.equal(humanBytes(5 * 1024 ** 3), '5.0 GB');
});

test('an unknown command is refused with a helpful message', async () => {
  const { runCommand } = require('../src/commands');
  await assert.rejects(() => runCommand('nope', {}), (e) => e.status === 400 && /Unknown command/.test(e.message));
  const help = await runCommand('help', {});
  assert.match(help.text, /add <url>/);
});

test('npm start -- help lists the commands and the background controls without a running server', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'cli.js'), 'help'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /npm start -- stop/);
  assert.match(run.stdout, /npm start -- add <url>/);
});

