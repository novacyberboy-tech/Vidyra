'use strict';
// In-app playback: resolves a YouTube song to its direct audio link with yt-dlp (once, then cached for 30 minutes)
// and proxies that link to the browser, so a song plays without downloading the whole file.
// Only the 11-character video id from the request ever reaches yt-dlp; the audio link itself is never taken from the request.
const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const { ytdlpBin, fail, MISSING_MESSAGE } = require('./ytdlp');

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;
const RESOLVE_TIMEOUT_MS = 60_000;
const cache = new Map(); // id -> { info, expires }
const inflight = new Map(); // id -> Promise (concurrent requests share one yt-dlp run)

function checkId(id) {
  if (!ID_RE.test(String(id || ''))) throw fail(400, 'That song link is not valid');
  return id;
}

/** Runs yt-dlp once for the song and returns { title, channel, duration, thumbnail, url }. */
function resolveSong(id) {
  return new Promise((resolve, reject) => {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const child = spawn(ytdlpBin(), [
      '-J', '--no-playlist', '--ignore-config', '--no-warnings', '-f', 'bestaudio[ext=m4a]/bestaudio', '--', watch,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(reject, fail(504, 'This song took too long to load. Try again.'));
    }, RESOLVE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; if (out.length > 20e6) child.kill('SIGKILL'); });
    child.stderr.on('data', () => { /* kept out of responses on purpose */ });
    child.on('error', (e) => done(reject, fail(503, e.code === 'ENOENT' ? MISSING_MESSAGE : 'Could not start the audio reader.')));
    child.on('close', (code) => {
      if (code !== 0) return done(reject, fail(502, 'This song could not be played. It may be unavailable in your region or need sign-in.'));
      let info;
      try { info = JSON.parse(out); } catch { return done(reject, fail(502, 'The song information could not be read.')); }
      const url = info.url || (info.requested_formats || []).map((f) => f.url).find(Boolean);
      if (!url) return done(reject, fail(502, 'No playable audio was found for this song.'));
      done(resolve, {
        title: String(info.title || 'Unknown song').slice(0, 300),
        channel: String(info.channel || info.uploader || '').slice(0, 200),
        duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
        thumbnail: typeof info.thumbnail === 'string' && info.thumbnail.startsWith('https://') ? info.thumbnail : null,
        url,
      });
    });
  });
}

/** Cached resolve. Shares one run between concurrent callers. */
async function songInfo(rawId, { fresh = false } = {}) {
  const id = checkId(rawId);
  const hit = cache.get(id);
  if (hit && !fresh && hit.expires > Date.now()) return hit.info;
  if (!fresh && inflight.has(id)) return inflight.get(id);
  const run = resolveSong(id).then((info) => {
    cache.delete(id);
    cache.set(id, { info, expires: Date.now() + CACHE_MS });
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return info;
  }).finally(() => inflight.delete(id));
  inflight.set(id, run);
  return run;
}

function dropCached(id) { cache.delete(id); }

/** Only Google video hosts are proxied. VIDYRA_MEDIA_HOST_ALLOW is for tests (a local server) and is never set in normal use. */
function allowedMedia(urlText) {
  let u;
  try { u = new URL(urlText); } catch { return false; }
  const extra = process.env.VIDYRA_MEDIA_HOST_ALLOW;
  if (extra && u.hostname === extra) return true;
  return u.protocol === 'https:' && (u.hostname === 'googlevideo.com' || u.hostname.endsWith('.googlevideo.com'));
}

function openUpstream(urlText, range) {
  return new Promise((resolve, reject) => {
    const lib = new URL(urlText).protocol === 'http:' ? http : https;
    const headers = range ? { Range: range } : {};
    const req = lib.get(urlText, { headers, timeout: 20_000 }, (up) => resolve(up));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => reject(fail(502, 'The audio stream could not be reached. Try again.')));
  });
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/** Streams the song to the browser. Refreshes the link once when it has expired (403, 404 or 410). */
async function streamSong(id, req, res) {
  const range = req.headers.range;
  let info = await songInfo(id);
  if (!allowedMedia(info.url)) throw fail(502, 'This song link is not allowed.');
  let up = await openUpstream(info.url, range);
  if ([403, 404, 410].includes(up.statusCode)) {
    up.resume();
    dropCached(id);
    info = await songInfo(id, { fresh: true });
    if (!allowedMedia(info.url)) throw fail(502, 'This song link is not allowed.');
    up = await openUpstream(info.url, range);
    if (![200, 206].includes(up.statusCode)) { up.resume(); throw fail(502, 'The song stopped working. Try again.'); }
  } else if (![200, 206].includes(up.statusCode)) {
    up.resume();
    throw fail(502, 'The song could not be streamed. Try again.');
  }
  const headers = { 'Cache-Control': 'private, max-age=0' };
  for (const h of PASS_HEADERS) if (up.headers[h]) headers[h] = up.headers[h];
  res.writeHead(up.statusCode, headers);
  up.pipe(res);
  req.on('close', () => up.destroy());
  up.on('error', () => res.destroy());
}

module.exports = { checkId, songInfo, streamSong, allowedMedia, ID_RE, cache, dropCached };
