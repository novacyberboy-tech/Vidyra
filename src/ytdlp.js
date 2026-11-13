'use strict';
// yt-dlp wrapper: validates input, builds argument lists, reads video info, streams search results
// and runs downloads with live progress. Nothing here ever uses a shell.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, clampInt, isWindows, DEFAULT_NAME_TEMPLATE } = require('./config');

const LOCAL_BIN = path.join(ROOT, 'bin', isWindows ? 'yt-dlp.exe' : 'yt-dlp');
const MISSING_MESSAGE = 'yt-dlp is not installed. Run scripts/setup.sh, or: pip install -U yt-dlp';

// Standard video heights. Sources can report odd heights (1012, 1350, 2026 …). Every height is rounded UP
// to the next standard step, so the label, the saved choice and the download always agree.
const TIERS = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const tierFor = (h) => {
  const n = Number(h);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return TIERS.find((t) => n <= t) || TIERS[TIERS.length - 1];
};
const RATE_RE = /^\d{1,5}[KMG]?$/i;
const VIDEO_CONTAINERS = new Set(['mp4', 'mkv', 'webm']);
const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'opus', 'aac', 'wav', 'flac']);
const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/;
const SEARCH_TIMEOUT_MS = 90_000;
const INFO_TIMEOUT_MS = 60_000;

const LANG_NAMES = {
  hi: 'Hindi', en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', ar: 'Arabic', id: 'Indonesian', tr: 'Turkish', ur: 'Urdu', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', mr: 'Marathi', pa: 'Punjabi', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  th: 'Thai', vi: 'Vietnamese', fil: 'Filipino', zh: 'Chinese', uk: 'Ukrainian',
};

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ytdlpBin() {
  if (process.env.YTDLP_BIN) return process.env.YTDLP_BIN;
  return fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp';
}

function validateUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw ?? '').trim()); } catch { throw fail(400, 'Paste a full link that starts with https://'); }
  if (!/^https?:$/.test(parsed.protocol)) throw fail(400, 'Only http(s) links are supported');
  return parsed.toString();
}

/** --cookies for private or age-restricted videos. The path must be a full path to an existing file. */
function cookiesArg(file) {
  const p = String(file || '').trim();
  if (!p) return [];
  if (!path.isAbsolute(p) || /[\r\n\0]/.test(p) || !fs.existsSync(p)) {
    throw fail(400, 'The cookies file was not found. Use the full path to a cookies.txt file in Settings.');
  }
  return ['--cookies', p];
}

// The only yt-dlp fields a name template may use. Title may carry a byte width, written the way the default
// is: %(title).100B. Other fields are plain %(field)s.
const NAME_FIELD_RE = /%\(title\)(?:s|\.\d{1,3}B)|%\((?:id|uploader|upload_date|ext)\)s/g;
const NAME_FIELDS_TEXT = '%(title).100B, %(id)s, %(uploader)s, %(upload_date)s, %(ext)s';

/** Checks a file name pattern. Empty means the default. Returns the cleaned pattern or throws a 400. */
function checkNameTemplate(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return DEFAULT_NAME_TEMPLATE;
  if (t.length > 200) throw fail(400, 'The name pattern is too long (200 characters at most)');
  if (/[\\/\x00-\x1f\x7f]/.test(t) || t.includes('..')) {
    throw fail(400, 'The name pattern cannot contain slashes, ".." or control characters');
  }
  if (!t.includes('[%(id)s]')) throw fail(400, 'The name pattern must include [%(id)s] so every file name stays unique');
  if (!t.includes('%(ext)s')) throw fail(400, 'The name pattern must include %(ext)s so the file keeps its type');
  if (t.replace(NAME_FIELD_RE, '').includes('%')) {
    throw fail(400, `Only these fields can be used: ${NAME_FIELDS_TEXT}`);
  }
  return t;
}

/** Used by downloads: an invalid pattern (for example an edited config file) falls back to the default. */
function safeNameTemplate(raw) {
  try { return checkNameTemplate(raw); } catch { return DEFAULT_NAME_TEMPLATE; }
}

function normLang(raw) {
  if (!raw || raw === 'auto') return '';
  const lang = String(raw);
  if (!LANG_RE.test(lang)) throw fail(400, 'Invalid audio language code');
  return lang;
}

function normSubLangs(raw) {
  const cleaned = String(raw || 'en').split(',').map((s) => s.trim()).filter((s) => /^[a-zA-Z*][a-zA-Z0-9*.-]{0,20}$/.test(s));
  return cleaned.length ? cleaned.join(',') : 'en';
}

/**
 * opts: { url, mode: 'video'|'audio', height, container, audioFormat, audioLang, subs, subLangs,
 *         thumbnail, playlist, concurrentFragments, outDir }
 */
function buildArgs(opts) {
  const url = validateUrl(opts.url);
  const outDir = String(opts.outDir || '');
  if (!outDir) throw fail(500, 'No download folder configured');
  const mode = opts.mode === 'audio' ? 'audio' : 'video';
  const lang = normLang(opts.audioLang);
  const langSel = lang ? `[language^=${lang}]` : '';
  const frags = clampInt(opts.concurrentFragments, 1, 32, 8);
  const rate = RATE_RE.test(String(opts.rate || '')) ? String(opts.rate).toUpperCase() : '';

  // Prefer a user-edited title for the on-disk name; keep id so files stay unique.
  let template;
  if (opts.customTitle && String(opts.customTitle).trim()) {
    const safe = String(opts.customTitle)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'download';
    template = `${safe} [%(id)s].%(ext)s`;
  } else if (opts.outputTemplate && String(opts.outputTemplate).trim()) {
    template = String(opts.outputTemplate).trim();
  } else {
    template = safeNameTemplate(opts.nameTemplate);
  }
  const args = [
    '--newline', '--no-colors', '--no-quiet', '--progress',
    '--ignore-config', '--no-warnings',
    '--retries', '10', '--fragment-retries', '10', '--extractor-retries', '5', '--file-access-retries', '3',
    '--retry-sleep', 'http:1:3',
    '-N', String(frags),
    '--trim-filenames', '180',
    ...(rate ? ['--limit-rate', rate] : []),
    ...cookiesArg(opts.cookies),
    '--print', 'after_move:DCFILE:%(filepath)s',
    '-o', path.join(outDir, template),
    opts.playlist ? '--yes-playlist' : '--no-playlist',
  ];
  if (opts.embedMetadata !== false) args.push('--add-metadata');
  if (opts.embedChapters !== false) args.push('--embed-chapters');
  if (isWindows) args.push('--windows-filenames');
  // Optional time range (download only a section).
  if (Number.isFinite(opts.startTime) || Number.isFinite(opts.endTime)) {
    const start = Number.isFinite(opts.startTime) && opts.startTime >= 0 ? opts.startTime : 0;
    const end = Number.isFinite(opts.endTime) && opts.endTime > start ? opts.endTime : '';
    args.push('--download-sections', `*${start}-${end}`);
    args.push('--force-keyframes-at-cuts');
  }
  // SponsorBlock: remove sponsor/selfpromo/interaction segments when available.
  if (opts.sponsorBlock) {
    args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction');
  }
  // Optional extra user-supplied yt-dlp flags (space-separated, no shell).
  if (opts.extraArgs && String(opts.extraArgs).trim()) {
    const extra = String(opts.extraArgs).trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    for (const token of extra) {
      const clean = token.replace(/^"|"$/g, '');
      if (clean && !clean.startsWith('-o') && clean !== '--') args.push(clean);
    }
  }

  if (mode === 'audio') {
    const af = AUDIO_FORMATS.has(opts.audioFormat) ? opts.audioFormat : 'mp3';
    args.push('-f', lang ? `ba${langSel}/ba/b` : 'ba/b', '-x', '--audio-format', af, '--audio-quality', '0');
    if (opts.thumbnail && ['mp3', 'm4a', 'opus', 'flac'].includes(af)) args.push('--embed-thumbnail');
    if (opts.writeDescription) args.push('--write-description');
    if (opts.writeInfoJson) args.push('--write-info-json');
    return [...args, '--', url];
  }

  const tier = tierFor(opts.height);
  const hSel = tier ? `[height<=${tier}]` : '';
  const container = VIDEO_CONTAINERS.has(opts.container) ? opts.container : 'mp4';
  const parts = [];
  if (lang) parts.push(`bv*${hSel}+ba${langSel}`); // dubbed track; falls back to the original audio below
  parts.push(`bv*${hSel}+ba`, `b${hSel}`, 'b');
  args.push('-f', parts.join('/'), '--merge-output-format', container);
  if (container === 'mp4') args.push('-S', 'res,vcodec:h264,acodec:m4a');
  // Clip: only the part between two times (for example 0:30 to 2:15). Empty end means to the end.
  const cs = String(opts.clipStart || '').trim();
  const ce = String(opts.clipEnd || '').trim();
  if (cs || ce) {
    if ((cs && !TIME_RE.test(cs)) || (ce && !TIME_RE.test(ce))) throw fail(400, 'Clip times must look like 0:30 or 1:02:10');
    args.push('--download-sections', `*${cs || '0'}-${ce || 'inf'}`, '--force-keyframes-at-cuts');
  }
  if (opts.subs) {
    // Caption endpoints are often rate-limited (HTTP 429). Optional captions must never abort the video.
    args.push('--ignore-errors', '--write-subs', '--write-auto-subs', '--sub-langs', normSubLangs(opts.subLangs), '--embed-subs');
  }
  if (opts.thumbnail && ['mp4', 'mkv'].includes(container)) args.push('--embed-thumbnail');
  if (opts.writeDescription) args.push('--write-description');
  if (opts.writeInfoJson) args.push('--write-info-json');
  return [...args, '--', url];
}

function summarize(j) {
  const formats = Array.isArray(j.formats) ? j.formats : [];
  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  // One entry per standard step (1080p, 1440p …). Keep the largest format in each step and the
  // highest real height that falls in it, so "2026p" is shown and downloaded as 2160p.
  const byTier = new Map();
  for (const f of videoFormats) {
    const tier = tierFor(f.height);
    const size = Number(f.filesize || f.filesize_approx || 0);
    const fps = Math.round(Number(f.fps) || 0);
    const vcodec = String(f.vcodec || '').split('.')[0];
    const cur = byTier.get(tier);
    if (!cur) {
      byTier.set(tier, { height: tier, actual: f.height, fps, ext: f.ext || '', vcodec, size });
      continue;
    }
    cur.actual = Math.max(cur.actual, f.height);
    if (size > cur.size || (size === cur.size && fps > cur.fps)) {
      Object.assign(cur, { fps, ext: f.ext || cur.ext, vcodec, size });
    }
  }
  const heights = [...byTier.values()].sort((a, b) => b.height - a.height);

  const audioFormats = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  // Group regional variants (hi-IN, hi-US) under their base language, which is what the filter uses.
  const langs = new Map();
  for (const f of audioFormats) {
    if (!f.language) continue;
    const base = String(f.language).toLowerCase().split('-')[0];
    if (!langs.has(base)) langs.set(base, { code: base, name: LANG_NAMES[base] || base });
  }
  const containers = [...new Set(videoFormats.map((f) => f.ext).filter(Boolean))];
  return {
    id: j.id || '',
    title: j.title || 'Untitled',
    uploader: j.uploader || j.channel || '',
    duration: Number(j.duration) || 0,
    thumbnail: j.thumbnail || '',
    webpage_url: j.webpage_url || '',
    extractor: j.extractor_key || j.extractor || '',
    heights,
    audioLanguages: [...langs.values()],
    formatCount: formats.length,
    containers: containers.length ? containers : ['mp4', 'mkv', 'webm'],
    bestAudioBitrate: Math.round(audioFormats.reduce((m, f) => Math.max(m, f.abr || 0), 0)),
    hasAudioOnly: audioFormats.length > 0,
  };
}

/** Read metadata for one link (no download). */
function getInfo(rawUrl, { cookies = '' } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = validateUrl(rawUrl); } catch (e) { return reject(e); }
    const child = spawn(ytdlpBin(), ['-J', '--no-playlist', '--ignore-config', '--no-warnings', ...cookiesArg(cookies), '--', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; clearTimeout(timer); fn(value); } };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, fail(504, 'The site took too long to answer. Try again.'));
    }, INFO_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; if (out.length > 60e6) child.kill('SIGKILL'); });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish(reject, fail(503, e.code === 'ENOENT' ? MISSING_MESSAGE : e.message)));
    child.on('close', (code) => {
      if (code !== 0) return finish(reject, fail(422, friendlyError(err) || 'Could not read this link'));
      try { finish(resolve, summarize(JSON.parse(out))); } catch { finish(reject, fail(502, 'Could not read the site response')); }
    });
  });
}

/** Turns the last stderr line of yt-dlp into a message a person can act on. */
function friendlyError(stderr) {
  const lines = String(stderr || '').trim().split('\n').filter(Boolean);
  const last = (lines[lines.length - 1] || '').replace(/^ERROR:\s*/, '');
  if (/HTTP Error 429/i.test(stderr)) return 'The site is rate-limiting requests. Wait a minute and retry.';
  if (/Private video|Sign in|login required|cookies/i.test(stderr)) return 'This video needs a signed-in session (private or age-restricted).';
  if (/Unsupported URL/i.test(stderr)) return 'This site is not supported by yt-dlp yet.';
  if (/Video unavailable|not available/i.test(stderr)) return 'This video is unavailable in your region or was removed.';
  return last.slice(0, 300);
}

// Title goes last so a tab inside a title cannot shift the other fields.
const PRINT_TEMPLATE = '%(id)s\t%(webpage_url)s\t%(duration)s\t%(channel)s\t%(view_count)s\t%(thumbnail)s\t%(title)s';
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const num = (s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

/** Parse one line of search output (tab-separated PRINT_TEMPLATE). The title is the last field, so a tab inside it is joined back with spaces. */
function parseSearchLine(line) {
  const parts = String(line).split('\t');
  if (parts.length < 7) return null;
  const [rawId, rawUrl, rawDur, rawChannel, rawViews, rawThumb] = parts.slice(0, 6).map(clean);
  const rawTitle = clean(parts.slice(6).join(' '));
  if (!rawId || rawId === 'NA') return null;
  const na = (v) => (v && v !== 'NA' ? v : '');
  return {
    id: rawId,
    url: na(rawUrl) || `https://www.youtube.com/watch?v=${rawId}`,
    title: na(rawTitle) || 'Untitled',
    duration: num(na(rawDur)),
    uploader: na(rawChannel),
    view_count: num(na(rawViews)),
    thumbnail: na(rawThumb) || `https://i.ytimg.com/vi/${rawId}/mqdefault.jpg`,
  };
}

/**
 * Streams search results as they arrive (so the UI never waits for the full list).
 * source: 'ytsearch' (YouTube, the default) or 'ytmsearch' (YouTube Music).
 * handlers: { onItem(result), onDone({ count, timedOut }), onError(message) }
 * Returns { cancel() }.
 */
const TIME_RE = /^\d{1,2}(?::\d{1,2}){0,2}$/; // 90, 1:30 or 1:02:10
const SEARCH_SOURCES = ['ytsearch', 'ytmsearch'];
function searchStream(rawQuery, rawLimit, handlers, { source = 'ytsearch' } = {}) {
  const query = clean(rawQuery).slice(0, 200);
  if (!query) throw fail(400, 'Type something to search for');
  if (!SEARCH_SOURCES.includes(source)) throw fail(400, 'Unknown search source');
  const n = clampInt(rawLimit, 1, 2000, 12);
  let fallback = null; // set when a YouTube Music search had to be retried as a normal search
  const args = ['--ignore-config', '--no-warnings', '--skip-download', '--flat-playlist', '--no-progress',
    '--print', PRINT_TEMPLATE, '--', `${source}${n}:${query}`];
  const child = spawn(ytdlpBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  let err = '';
  let count = 0;
  let finished = false;
  let timedOut = false;
  const seen = new Set();

  const handleLine = (line) => {
    if (!line.trim()) return;
    const item = parseSearchLine(line);
    if (!item || seen.has(item.id)) return;
    seen.add(item.id);
    count++;
    handlers.onItem(item);
  };
  child.stdout.on('data', (d) => {
    buffer += d;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      handleLine(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 1);
    }
  });
  child.stderr.on('data', (d) => { err += d; });

  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SEARCH_TIMEOUT_MS);
  const finish = () => { if (!finished) { finished = true; clearTimeout(timer); } };
  child.on('error', (e) => {
    finish();
    handlers.onError(e.code === 'ENOENT' ? MISSING_MESSAGE : e.message);
  });
  child.on('close', (code) => {
    if (finished) return;
    handleLine(buffer);
    finish();
    if (code !== 0 && count === 0 && !timedOut && source === 'ytmsearch') {
      // Some yt-dlp versions cannot run YouTube Music searches. Retry as a normal YouTube search for the same song.
      fallback = searchStream(`${query} official audio`, n, handlers, { source: 'ytsearch' });
      return;
    }
    if (code !== 0 && count === 0 && !timedOut) {
      handlers.onError(friendlyError(err) || 'Search failed. Check your connection and try again.');
    } else {
      handlers.onDone({ count, timedOut });
    }
  });
  return {
    cancel() {
      if (fallback) fallback.cancel();
      if (!finished) { finished = true; clearTimeout(timer); child.kill('SIGKILL'); }
    },
  };
}

/** Start a download. hooks: { onProgress(p), onFile(path), onDest(path), onLog(line) }. Returns { child, done }. */
function startDownload(opts, hooks) {
  const args = buildArgs(opts);
  const child = spawn(ytdlpBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const progressRe = /\[download\]\s+([\d.]+)%(?:\s+of\s+~?\s*(\S+))?(?:\s+at\s+(\S+))?(?:\s+ETA\s+(\S+))?/;
  const destRe = /(?:Destination:\s+|Merging formats into ")(.+?)"?$/;
  let lastDest = '';
  let gotFile = false;
  const handle = (chunk) => {
    for (const raw of String(chunk).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('DCFILE:')) { gotFile = true; hooks.onFile && hooks.onFile(line.slice(7).trim()); continue; }
      const m = progressRe.exec(line);
      if (m) {
        hooks.onProgress && hooks.onProgress({ percent: parseFloat(m[1]), size: m[2] || '', speed: m[3] || '', eta: m[4] || '' });
        continue;
      }
      const d = destRe.exec(line);
      if (d) { lastDest = d[1]; hooks.onDest && hooks.onDest(d[1]); }
      hooks.onLog && hooks.onLog(line);
    }
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  const done = new Promise((resolve) => {
    child.on('error', (e) => resolve({ code: -1, error: e.code === 'ENOENT' ? MISSING_MESSAGE : e.message }));
    child.on('close', (code, signal) => {
      if (!gotFile && lastDest && code === 0) hooks.onFile && hooks.onFile(lastDest);
      resolve({ code, signal });
    });
  });
  return { child, done };
}

/** Update yt-dlp itself (yt-dlp -U). Resolves with { ok, output }. */
function updateYtdlp() {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(ytdlpBin(), ['-U'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    const collect = (d) => { output += d; };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: e.code === 'ENOENT' ? MISSING_MESSAGE : e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trim().slice(-2000) }); });
  });
}

module.exports = {
  ytdlpBin, validateUrl, buildArgs, getInfo, searchStream, parseSearchLine, startDownload, updateYtdlp,
  summarize, friendlyError, fail, MISSING_MESSAGE, TIERS, tierFor, cookiesArg, RATE_RE,
  checkNameTemplate, NAME_FIELDS_TEXT,
};
