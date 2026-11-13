'use strict';
// Version 3 helpers: search kinds, download history, queue and library stats, the free-space guard and
// safe settings export and import. Kept apart from the core so the older modules stay unchanged.
const { fail } = require('./ytdlp');
const { freeSpace } = require('./files');

const MB = 1024 * 1024;
const HISTORY_LIMIT = 200;
const SEARCH_KINDS = ['video', 'music'];

// Settings that may be shared or imported. cookiesFile is never shared, and token-like values are dropped.
const SETTING_KEYS = [
  'downloadDir', 'maxParallel', 'concurrentFragments', 'speedLimit', 'retries', 'termuxNotify',
  'outputTemplate', 'extraArgs', 'autoCleanDays', 'nameTemplate', 'minFreeMb',
];
const KEY_IS_SECRET = /token|secret|passw|api.?key|auth|cookie/i;
const VALUE_IS_SECRET = /(token|secret|passw(?:or)?d|api[_-]?key|authorization)\s*[=:]|bearer\s+\S/i;

/** The yt-dlp search source for a search kind: YouTube Music for music, plain YouTube for video. */
function searchSourceFor(kind) {
  return kind === 'music' ? 'ytmsearch' : 'ytsearch';
}

/** True when a new download should be refused: free space is known and below the minimum. */
function lowSpace(freeBytes, minFreeMb, force = false) {
  if (force || freeBytes === null || freeBytes === undefined) return false;
  return freeBytes < minFreeMb * MB;
}

async function ensureFreeSpace(dir, minFreeMb, force) {
  const free = await freeSpace(dir);
  if (lowSpace(free, minFreeMb, force)) throw fail(507, 'Not enough free space on this device');
}

/** The last finished downloads (newest first). jobs: the queue's public job rows. */
function historyOf(jobs, limit = HISTORY_LIMIT) {
  return jobs
    .filter((j) => j.status === 'done')
    .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
    .slice(0, limit)
    .map((j) => ({
      id: j.id, title: j.title, file: j.file, finishedAt: j.finishedAt || 0, mode: j.mode, size: j.bytes || 0,
    }));
}

/**
 * Totals for the library (files in the download folder) and the queue. averageSpeedKbps is the average
 * download speed of finished downloads in kilobytes per second, measured from start to finish.
 */
function statsOf(jobs, files) {
  const count = (...statuses) => jobs.filter((j) => statuses.includes(j.status)).length;
  const library = files.filter((f) => f.role === 'media' || f.role === 'other');
  const speeds = jobs
    .filter((j) => j.status === 'done' && j.bytes > 0 && j.startedAt && j.finishedAt > j.startedAt)
    .map((j) => (j.bytes / 1024) / ((j.finishedAt - j.startedAt) / 1000));
  const average = speeds.length ? speeds.reduce((sum, v) => sum + v, 0) / speeds.length : 0;
  return {
    totalFiles: library.length,
    totalBytes: library.reduce((sum, f) => sum + f.size, 0),
    doneCount: count('done'),
    failedCount: count('error'),
    activeCount: count('queued', 'downloading', 'paused'),
    averageSpeedKbps: Math.round(average),
  };
}

function isSecret(key, value) {
  return KEY_IS_SECRET.test(key) || (typeof value === 'string' && VALUE_IS_SECRET.test(value));
}

/** The settings that are safe to share: no cookies file and no token-like values. */
function shareableSettings(current) {
  const out = {};
  for (const key of SETTING_KEYS) {
    if (!isSecret(key, current[key])) out[key] = current[key];
  }
  return out;
}

/** Splits an import body into the keys to apply and the keys to ignore (unknown, secret or cookie keys). */
function importPlan(body) {
  const apply = [];
  const ignored = [];
  for (const key of Object.keys(body || {})) {
    if (SETTING_KEYS.includes(key) && !isSecret(key, body[key])) apply.push(key);
    else ignored.push(key);
  }
  return { apply, ignored };
}

module.exports = {
  SEARCH_KINDS, HISTORY_LIMIT, SETTING_KEYS, searchSourceFor, lowSpace, ensureFreeSpace, historyOf, statsOf,
  shareableSettings, importPlan,
};
