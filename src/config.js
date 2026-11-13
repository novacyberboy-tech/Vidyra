'use strict';
// Central place for brand, paths, environment and persisted settings.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const BRAND = Object.freeze({
  name: 'Vidyra',
  tagline: 'Universal video & audio downloader',
  version: pkg.version,
});

const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_FILE = process.env.VIDYRA_CONFIG || path.join(ROOT, 'config.json');
/** Download queue snapshot, so unfinished downloads survive a restart. Lives next to config.json. */
const JOBS_FILE = path.join(path.dirname(CONFIG_FILE), 'jobs.json');

/** File name pattern used when no custom title or output template is set. [%(id)s] keeps names unique. */
const DEFAULT_NAME_TEMPLATE = '%(title).100B [%(id)s].%(ext)s';

const isTermux = Boolean(process.env.PREFIX && process.env.PREFIX.includes('com.termux'));
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
  return next;
}

/** Default download folder for this platform. */
function systemDownloadsDir() {
  const home = os.homedir();
  if (isTermux) {
    const shared = '/storage/emulated/0/Download';
    try {
      fs.accessSync(shared, fs.constants.W_OK);
      return path.join(shared, 'Vidyra');
    } catch {
      return path.join(home, 'downloads', 'Vidyra');
    }
  }
  if (isWindows) return path.join(process.env.USERPROFILE || home, 'Downloads', 'Vidyra');
  if (isMac) return path.join(home, 'Downloads', 'Vidyra');
  try {
    const xdg = execFileSync('xdg-user-dir', ['DOWNLOAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
    if (xdg && xdg !== home) return path.join(xdg, 'Vidyra');
  } catch { /* xdg-user-dir not available */ }
  return path.join(home, 'Downloads', 'Vidyra');
}

/** Quick-pick folders shown in Settings. */
function folderPresets() {
  const home = process.env.USERPROFILE || os.homedir();
  const p = path.join;
  const presets = isTermux
    ? [
      { id: 'android-downloads', label: 'Android Downloads', icon: 'phone', dir: '/storage/emulated/0/Download/Vidyra' },
      { id: 'android-movies', label: 'Android Movies', icon: 'video', dir: '/storage/emulated/0/Movies/Vidyra' },
      { id: 'android-music', label: 'Android Music', icon: 'music', dir: '/storage/emulated/0/Music/Vidyra' },
    ]
    : [
      { id: 'downloads', label: 'Downloads', icon: 'download', dir: p(home, 'Downloads', 'Vidyra') },
      { id: 'videos', label: 'Videos', icon: 'video', dir: p(home, 'Videos', 'Vidyra') },
      { id: 'music', label: 'Music', icon: 'music', dir: p(home, 'Music', 'Vidyra') },
    ];
  presets.push({ id: 'app', label: 'App folder', icon: 'folder', dir: p(ROOT, 'downloads') });
  return presets;
}

const saved = readConfig();

/** Runtime settings. Environment variables win on startup; changes from the UI persist to config.json. */
const settings = {
  downloadDir: path.resolve(expandHome(process.env.DOWNLOAD_DIR || saved.downloadDir || systemDownloadsDir())),
  maxParallel: clampInt(process.env.MAX_PARALLEL || saved.maxParallel, 1, 6, 2),
  concurrentFragments: clampInt(process.env.CONCURRENT_FRAGMENTS || saved.concurrentFragments, 1, 32, 8),
  /** yt-dlp --limit-rate value such as 500K, 2M or 10M. Empty means unlimited. */
  speedLimit: String(process.env.SPEED_LIMIT || saved.speedLimit || '').toUpperCase(),
  /** Automatic retries for failed downloads that look temporary (network, rate limit, server errors). */
  retries: clampInt(saved.retries, 0, 3, 1),
  /** Full path to a cookies.txt file, for private or age-restricted videos. */
  cookiesFile: typeof saved.cookiesFile === 'string' ? saved.cookiesFile : '',
  /** Show download progress in Android notifications through Termux:API (Termux only). */
  termuxNotify: saved.termuxNotify !== false,
  /** Custom yt-dlp output template. Empty = default "%(title).100B [%(id)s].%(ext)s". */
  outputTemplate: typeof saved.outputTemplate === 'string' ? saved.outputTemplate : '',
  /** Extra raw yt-dlp arguments (space-separated). Use carefully. */
  extraArgs: typeof saved.extraArgs === 'string' ? saved.extraArgs : '',
  /** Auto-remove finished queue entries older than this many days (0 = never). */
  autoCleanDays: clampInt(saved.autoCleanDays, 0, 365, 0),
  /** File name pattern. Validated when set through the API (see ytdlp.checkNameTemplate). */
  nameTemplate: typeof saved.nameTemplate === 'string' && saved.nameTemplate.trim()
    ? saved.nameTemplate.trim() : DEFAULT_NAME_TEMPLATE,
  /** New downloads are refused when less than this many MB are free (0 = no check). */
  minFreeMb: clampInt(saved.minFreeMb ?? 500, 0, 20000, 500),
};

function persistSettings(patch) {
  writeConfig({
    downloadDir: settings.downloadDir,
    maxParallel: settings.maxParallel,
    concurrentFragments: settings.concurrentFragments,
    speedLimit: settings.speedLimit,
    retries: settings.retries,
    cookiesFile: settings.cookiesFile,
    termuxNotify: settings.termuxNotify,
    outputTemplate: settings.outputTemplate,
    extraArgs: settings.extraArgs,
    autoCleanDays: settings.autoCleanDays,
    nameTemplate: settings.nameTemplate,
    minFreeMb: settings.minFreeMb,
    ...patch,
  });
}

module.exports = {
  ROOT, BRAND, PUBLIC_DIR, CONFIG_FILE, JOBS_FILE, DEFAULT_NAME_TEMPLATE, isTermux, isWindows, isMac,
  clampInt, expandHome, folderPresets, settings, persistSettings, readConfig, writeConfig,
};
