'use strict';
// Detects the external programs Vidyra depends on (yt-dlp, ffmpeg) and reports their versions.
const { spawn } = require('node:child_process');
const { ytdlpBin } = require('./ytdlp');

const CACHE_MS = 30_000;
let cache = null;
let cachedAt = 0;

function probe(bin, args) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return resolve({ installed: false, error: e.message });
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ installed: false, error: e.code === 'ENOENT' ? 'not found' : e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { installed: true, output: out } : { installed: false, error: `exit ${code}` });
    });
  });
}

async function detectTools(force = false) {
  if (!force && cache && Date.now() - cachedAt < CACHE_MS) return cache;
  const [yt, ff] = await Promise.all([
    probe(ytdlpBin(), ['--version']),
    probe(process.env.FFMPEG_BIN || 'ffmpeg', ['-version']),
  ]);
  const ytdlp = yt.installed
    ? { installed: true, version: (yt.output || '').split('\n')[0].trim(), path: ytdlpBin() }
    : { installed: false, error: yt.error, path: ytdlpBin() };
  const ffm = ff.installed
    ? { installed: true, version: ((ff.output || '').match(/ffmpeg version (\S+)/) || [])[1] || 'unknown', path: process.env.FFMPEG_BIN || 'ffmpeg' }
    : { installed: false, error: ff.error, path: process.env.FFMPEG_BIN || 'ffmpeg' };
  cache = { ytdlp, ffmpeg: ffm, checkedAt: Date.now() };
  cachedAt = Date.now();
  return cache;
}

module.exports = { detectTools };
