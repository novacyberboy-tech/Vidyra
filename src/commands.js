'use strict';
// Vidyra commands. The web Commands panel, the command line (npm start -- <command>) and the API all run this
// one list, so anything you can do in the app you can also do from Termux, and the other way round.
// These are fixed, named commands with checked input. They are not a shell.
const fs = require('node:fs');
const path = require('node:path');
const { BRAND, settings, persistSettings, expandHome, clampInt, isWindows } = require('./config');
const {
  validateUrl, buildArgs, fail, updateYtdlp, tierFor, searchStream, checkNameTemplate,
} = require('./ytdlp');
const { detectTools } = require('./tools');
const {
  listFiles, deleteFile, leftoversOf, cleanupLeftovers, freeSpace,
} = require('./files');
const {
  searchSourceFor, historyOf, statsOf, ensureFreeSpace, importPlan,
} = require('./features');

const VIDEO_CONTAINERS = ['mp4', 'mkv', 'webm'];
const SPEED_RE = /^\d{1,5}[KMG]?$/;
const MAX_LINE = 2000;

/** Removes control characters and trims a text value to a length. */
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function checkSpeedLimit(raw) {
  const value = clean(raw, 8).toUpperCase();
  if (value && !SPEED_RE.test(value)) throw fail(400, 'Speed limit must look like 500K, 2M or 10M');
  return value;
}

function checkCookiesFile(raw) {
  const text = clean(raw, 1024);
  if (!text) return '';
  const expanded = expandHome(text);
  if (!path.isAbsolute(expanded)) throw fail(400, 'Use the full path to the cookies.txt file');
  const resolved = path.resolve(expanded);
  let stat;
  try { stat = fs.statSync(resolved); } catch { stat = null; }
  if (!stat || !stat.isFile()) throw fail(400, 'That cookies file was not found');
  return resolved;
}

/** Turns the request body of a download into the job options. Shared by the API and the commands. */
function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'download';
}

function downloadOptions(body) {
  const height = Number(body.height);
  const title = clean(body.customTitle || body.title, 300);
  return {
    url: validateUrl(body.url),
    title,
    customTitle: title,
    mode: body.mode === 'audio' ? 'audio' : 'video',
    // A standard step (144 … 4320) or 'best'. Other heights are rounded up to the next step.
    height: tierFor(height) || 'best',
    container: VIDEO_CONTAINERS.includes(body.container) ? body.container : 'mp4',
    audioFormat: clean(body.audioFormat, 8) || 'mp3',
    audioLang: clean(body.audioLang, 16) || 'auto',
    subs: Boolean(body.subs),
    subLangs: clean(body.subLangs, 80) || 'en',
    clipStart: clean(body.clipStart, 12),
    clipEnd: clean(body.clipEnd, 12),
    thumbnail: Boolean(body.thumbnail),
    playlist: Boolean(body.playlist),
    // Send the finished file to this device through the browser's own download.
    deliver: Boolean(body.deliver),
    concurrentFragments: settings.concurrentFragments,
    // Optional time range (seconds) and SponsorBlock
    startTime: body.startTime != null && body.startTime !== '' ? Number(body.startTime) : undefined,
    endTime: body.endTime != null && body.endTime !== '' ? Number(body.endTime) : undefined,
    sponsorBlock: Boolean(body.sponsorBlock),
    embedChapters: body.embedChapters !== false,
    embedMetadata: body.embedMetadata !== false,
    writeDescription: Boolean(body.writeDescription),
    writeInfoJson: Boolean(body.writeInfoJson),
  };
}

const BATCH_LIMIT = 50;

/** The links of a batch. A string is split on new lines; blank lines and repeats are dropped. More than 50 is refused. */
function batchLinks(input) {
  const raw = typeof input === 'string' ? input.split(/\r?\n/) : Array.isArray(input) ? input : [];
  const links = [...new Set(raw.map((u) => String(u ?? '').trim()).filter(Boolean))];
  if (!links.length) throw fail(400, 'Paste at least one link, one per line');
  if (links.length > BATCH_LIMIT) {
    throw fail(400, `A batch takes at most ${BATCH_LIMIT} different links. Split the list into smaller batches.`);
  }
  return links;
}

/**
 * Queues many links with the same options. body: { urls, options, force }. ctx: { queue }.
 * A bad link is reported in errors and does not stop the others. If no link is valid, throws a 400 with the first message.
 */
async function queueBatch({ urls, options, force = false }, ctx) {
  const links = batchLinks(urls);
  const base = options && typeof options === 'object' ? { ...options } : {};
  // A title belongs to one download, so the batch never shares one.
  delete base.url;
  delete base.title;
  delete base.customTitle;
  const plans = [];
  const errors = [];
  const seen = new Set();
  for (const link of links) {
    try {
      const opts = downloadOptions({ ...base, url: link });
      // Same checks as a single download (cookies file, speed limit, folder).
      buildArgs({ ...opts, outDir: settings.downloadDir, rate: settings.speedLimit, cookies: settings.cookiesFile });
      if (!seen.has(opts.url)) {
        seen.add(opts.url);
        plans.push(opts);
      }
    } catch (e) {
      errors.push({ url: link, message: e.message });
    }
  }
  if (!plans.length) throw fail(400, errors[0].message);
  await ensureFreeSpace(settings.downloadDir, settings.minFreeMb, force === true);
  const jobs = plans.map((opts) => ctx.queue.publicJob(ctx.queue.add(opts)));
  return { queued: jobs.length, jobs, errors };
}

/** The download flags shared by add and batch (no link). */
function flagOptions(flags) {
  return {
    mode: flags.audio ? 'audio' : 'video',
    height: flags.height === undefined || flags.height === true ? undefined : flags.height,
    container: typeof flags.container === 'string' ? flags.container : undefined,
    deliver: Boolean(flags.deliver),
    playlist: Boolean(flags.playlist),
    subs: Boolean(flags.subs),
    thumbnail: Boolean(flags.thumbnail),
  };
}

/**
 * Validates and applies settings from a request body. ctx: { queue, setNotify(on) }.
 * Only the fields present in the body change.
 */
function applySettings(body, ctx) {
  if (body.downloadDir !== undefined) {
    const raw = clean(body.downloadDir, 1024);
    if (!raw) throw fail(400, 'Choose a folder first');
    const expanded = expandHome(raw);
    if (!path.isAbsolute(expanded)) throw fail(400, 'Use a full folder path, for example ~/Videos/Vidyra');
    const resolved = path.resolve(expanded);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (e) {
      throw fail(400, `That folder cannot be used (${e.code || e.message})`);
    }
    settings.downloadDir = resolved;
  }
  if (body.maxParallel !== undefined) settings.maxParallel = clampInt(body.maxParallel, 1, 6, settings.maxParallel);
  if (body.concurrentFragments !== undefined) {
    settings.concurrentFragments = clampInt(body.concurrentFragments, 1, 32, settings.concurrentFragments);
  }
  if (body.speedLimit !== undefined) settings.speedLimit = checkSpeedLimit(body.speedLimit);
  if (body.retries !== undefined) settings.retries = clampInt(body.retries, 0, 3, settings.retries);
  if (body.cookiesFile !== undefined) settings.cookiesFile = checkCookiesFile(body.cookiesFile);
  if (body.termuxNotify !== undefined) {
    settings.termuxNotify = Boolean(body.termuxNotify);
    if (ctx.setNotify) ctx.setNotify(settings.termuxNotify);
  }
  if (body.outputTemplate !== undefined) {
    const t = String(body.outputTemplate || '').trim();
    if (t && !t.includes('%(')) throw fail(400, 'Output template must include at least one %(field)s placeholder');
    settings.outputTemplate = t.slice(0, 300);
  }
  if (body.extraArgs !== undefined) {
    settings.extraArgs = String(body.extraArgs || '').trim().slice(0, 500);
  }
  if (body.autoCleanDays !== undefined) {
    settings.autoCleanDays = clampInt(body.autoCleanDays, 0, 365, settings.autoCleanDays);
  }
  if (body.nameTemplate !== undefined) settings.nameTemplate = checkNameTemplate(body.nameTemplate);
  if (body.minFreeMb !== undefined) settings.minFreeMb = clampInt(body.minFreeMb, 0, 20000, settings.minFreeMb);
  persistSettings({});
  if (ctx.queue) ctx.queue.pump();
  return {
    ok: true, downloadDir: settings.downloadDir, maxParallel: settings.maxParallel,
    concurrentFragments: settings.concurrentFragments, speedLimit: settings.speedLimit,
    retries: settings.retries, cookiesFile: settings.cookiesFile, termuxNotify: settings.termuxNotify,
    outputTemplate: settings.outputTemplate, extraArgs: settings.extraArgs, autoCleanDays: settings.autoCleanDays,
    nameTemplate: settings.nameTemplate, minFreeMb: settings.minFreeMb,
  };
}

/**
 * Imports settings exported from another Vidyra. Each key is applied on its own, so one bad value does not
 * stop the rest. Unknown, secret and cookie keys are ignored and reported.
 */
function importSettings(body, ctx) {
  const { apply, ignored } = importPlan(body);
  const applied = [];
  const rejected = [];
  for (const key of apply) {
    try {
      applySettings({ [key]: body[key] }, ctx);
      applied.push(key);
    } catch (e) {
      rejected.push({ key, error: e.message });
    }
  }
  return { ok: true, applied, ignored, rejected };
}

/** Bytes as a short readable size, for command output. */
function humanBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

/** Time as "2026-11-06 16:30" (UTC), for command output. */
const dateText = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : 'unknown date');

/** Splits a command line into words. Quotes keep spaces together: add "https://…" --height=720 */
function tokenize(line) {
  const text = clean(line, MAX_LINE + 1);
  if (text.length > MAX_LINE) throw fail(400, 'That command is too long');
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(text);
  while (m) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, '$1'));
    else if (m[2] !== undefined) out.push(m[2]);
    else out.push(m[3]);
    m = re.exec(text);
  }
  return out;
}

/** Positional words and --flags. --flag means true, --key=value means a value. */
function parseArgs(tokens) {
  const pos = [];
  const flags = {};
  for (const t of tokens) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(t);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else pos.push(t);
  }
  return { pos, flags };
}

const pad = (s, n) => String(s).padEnd(n);
const STATUS_FILTERS = { active: ['downloading', 'paused', 'queued'], failed: ['error'] };

function jobLine(j) {
  const pct = `${String(Math.round(Number(j.percent) || 0)).padStart(3)}%`;
  return `${pad(j.id, 14)} ${pad(j.status, 11)} ${pct}  ${j.title || j.url}`;
}

const COMMANDS = [
  {
    name: 'help',
    usage: 'help',
    summary: 'Show every command',
    run: () => {
      const text = COMMANDS.map((c) => `${c.usage}\n    ${c.summary}`).join('\n');
      return { text: `${BRAND.name} commands:\n${text}` };
    },
  },
  {
    name: 'info',
    usage: 'info',
    summary: 'Version, folder, free space, tools and queue counts',
    run: async (a, ctx) => {
      const tools = await detectTools(false);
      const jobs = ctx.queue.list();
      const count = (...s) => jobs.filter((j) => s.includes(j.status)).length;
      const free = await freeSpace(settings.downloadDir);
      const text = [
        `${BRAND.name} ${BRAND.version}`,
        `Folder:    ${settings.downloadDir}`,
        `Free:      ${free === null || free === undefined ? 'unknown' : humanBytes(free)}`,
        `yt-dlp:    ${tools.ytdlp.installed ? tools.ytdlp.version : 'not installed'}`,
        `ffmpeg:    ${tools.ffmpeg.installed ? tools.ffmpeg.version : 'not installed'}`,
        `Queue:     ${count('downloading')} running · ${count('queued')} waiting · ${count('paused')} paused · ${count('done')} done · ${count('error')} failed`,
      ].join('\n');
      return { text, data: { version: BRAND.version, folder: settings.downloadDir, free, tools } };
    },
  },
  {
    name: 'add',
    usage: 'add <url> [--audio] [--height=1080] [--container=mkv] [--deliver] [--force]',
    summary: 'Queue a download (video, or audio with --audio; --force skips the free-space check)',
    run: async (a, ctx) => {
      const url = a.pos[0];
      if (!url) throw fail(400, 'Give a link to download. Example: add https://… --height=720');
      const opts = downloadOptions({ url, ...flagOptions(a.flags) });
      buildArgs({
        ...opts, outDir: settings.downloadDir, rate: settings.speedLimit, cookies: settings.cookiesFile,
      });
      await ensureFreeSpace(settings.downloadDir, settings.minFreeMb, Boolean(a.flags.force));
      const job = ctx.queue.publicJob(ctx.queue.add(opts));
      return { text: `Queued: ${job.title || url}\nID: ${job.id}`, data: job };
    },
  },
  {
    name: 'batch',
    usage: 'batch <url1> <url2> ... [--audio] [--height=N] [--container=mkv]',
    summary: 'Queue many links with the same options (up to 50; same flags as add)',
    run: async (a, ctx) => {
      if (!a.pos.length) throw fail(400, 'Give at least one link. Example: batch https://… https://… --height=720');
      const result = await queueBatch({
        urls: a.pos,
        options: flagOptions(a.flags),
        force: Boolean(a.flags.force),
      }, ctx);
      const lines = [`Queued ${result.queued} download${result.queued === 1 ? '' : 's'}.`];
      for (const job of result.jobs) lines.push(`  ${job.id}  ${job.title || job.url}`);
      if (result.errors.length) {
        lines.push(`Skipped ${result.errors.length}:`);
        for (const e of result.errors) lines.push(`  ${e.url}: ${e.message}`);
      }
      return { text: lines.join('\n'), data: result };
    },
  },
  {
    name: 'list',
    usage: 'list [all|active|done|failed]',
    summary: 'List downloads in the queue',
    run: (a, ctx) => {
      const filter = a.pos[0] || 'all';
      const jobs = ctx.queue.list().filter((j) => {
        if (filter === 'all') return true;
        const allowed = STATUS_FILTERS[filter] || [filter];
        return allowed.includes(j.status);
      });
      if (!jobs.length) return { text: 'No downloads here.', data: [] };
      return { text: jobs.map(jobLine).join('\n'), data: jobs };
    },
  },
  ...['pause', 'resume', 'cancel', 'retry'].map((action) => ({
    name: action,
    usage: `${action} <id>`,
    summary: `${action[0].toUpperCase()}${action.slice(1)} one download (ID from list)`,
    run: (a, ctx) => {
      const id = a.pos[0];
      if (!id) throw fail(400, `Give the download ID. Example: ${action} abc123 (see list)`);
      if ((action === 'pause' || action === 'resume') && isWindows) {
        throw fail(501, 'Pause and resume are not supported on Windows. Cancel and retry instead.');
      }
      const job = ctx.queue.publicJob(ctx.queue[action](id));
      return { text: `${action[0].toUpperCase()}${action.slice(1)}: ${job.title || id} is now ${job.status}`, data: job };
    },
  })),
  {
    name: 'retry-failed',
    usage: 'retry-failed',
    summary: 'Queue every failed download again',
    run: (a, ctx) => {
      const queued = ctx.queue.retryFailed();
      return { text: queued ? `Queued ${queued} failed download${queued === 1 ? '' : 's'} again.` : 'Nothing failed.', data: { queued } };
    },
  },
  {
    name: 'clear',
    usage: 'clear',
    summary: 'Remove finished and cancelled entries from the queue list',
    run: (a, ctx) => {
      const removed = ctx.queue.clearFinished();
      return { text: `Removed ${removed} entr${removed === 1 ? 'y' : 'ies'} from the list. Files are not touched.`, data: { removed } };
    },
  },
  {
    name: 'files',
    usage: 'files',
    summary: 'List finished files in your download folder',
    run: (a, ctx) => {
      const shown = listFiles(settings.downloadDir, ctx.queue.activeBases())
        .filter((f) => f.role === 'media' || f.role === 'other')
        .sort((x, y) => y.mtime - x.mtime);
      if (!shown.length) return { text: 'Your library is empty.', data: [] };
      const text = shown.map((f) => `${humanBytes(f.size).padStart(9)}  ${f.name}`).join('\n');
      return { text: `${shown.length} file${shown.length === 1 ? '' : 's'} in ${settings.downloadDir}\n${text}`, data: shown };
    },
  },
  {
    name: 'delete',
    usage: 'delete <file name>',
    summary: 'Delete one finished file (name from files)',
    run: (a) => {
      const name = a.pos.join(' ');
      if (!name) throw fail(400, 'Give the file name. See files for the names.');
      if (!deleteFile(settings.downloadDir, name)) throw fail(404, 'That file no longer exists');
      return { text: `Deleted: ${name}` };
    },
  },
  {
    name: 'clean',
    usage: 'clean',
    summary: 'Remove leftover thumbnails, subtitles and unfinished parts',
    run: (a, ctx) => {
      const res = cleanupLeftovers(settings.downloadDir, ctx.queue.activeBases());
      return { text: `Removed ${res.removed} leftover file${res.removed === 1 ? '' : 's'} · ${humanBytes(res.bytes)} freed.`, data: res };
    },
  },
  {
    name: 'search',
    usage: 'search <words> [--limit=10] [--music]',
    summary: 'Search YouTube and other sites for videos (--music searches for audio)',
    run: (a) => new Promise((resolve, reject) => {
      const q = a.pos.join(' ');
      if (!q) { reject(fail(400, 'Type what to search for. Example: search lofi music --limit=5')); return; }
      const items = [];
      const kind = a.flags.music ? 'music' : 'video';
      searchStream(clean(q, 200), a.flags.limit, {
        onItem: (item) => items.push(item),
        onDone: () => {
          if (!items.length) { resolve({ text: 'No results.', data: [] }); return; }
          const text = items.map((it, i) => `${String(i + 1).padStart(2)}. ${it.title}\n    ${it.url || ''}`).join('\n');
          resolve({ text, data: items });
        },
        onError: (message) => reject(fail(502, message)),
      }, { source: searchSourceFor(kind) });
    }),
  },
  {
    name: 'settings',
    usage: 'settings  |  set <key> <value>',
    summary: 'Show settings, or change one (keys: folder, speed, retries, parallel, fragments, cookies, notify, name, minfree)',
    run: (a, ctx) => {
      const [sub, key, ...rest] = a.pos;
      if (sub !== 'set') {
        return {
          text: [
            `Folder:      ${settings.downloadDir}`,
            `Speed limit: ${settings.speedLimit || 'unlimited'}`,
            `Retries:     ${settings.retries}`,
            `Parallel:    ${settings.maxParallel}`,
            `Fragments:   ${settings.concurrentFragments}`,
            `Cookies:     ${settings.cookiesFile || 'none'}`,
            `Notify:      ${settings.termuxNotify ? 'on' : 'off'}`,
            `File name:   ${settings.nameTemplate}`,
            `Min free:    ${settings.minFreeMb} MB`,
          ].join('\n'),
        };
      }
      const value = rest.join(' ');
      const map = {
        folder: { downloadDir: value },
        speed: { speedLimit: value === 'off' || value === 'unlimited' ? '' : value },
        retries: { retries: value },
        parallel: { maxParallel: value },
        fragments: { concurrentFragments: value },
        cookies: { cookiesFile: value === 'off' ? '' : value },
        notify: { termuxNotify: value === 'on' },
        name: { nameTemplate: value },
        minfree: { minFreeMb: value },
      };
      if (!key || !map[key]) {
        throw fail(400, 'Use: set folder|speed|retries|parallel|fragments|cookies|notify|name|minfree <value>');
      }
      if (key === 'notify' && !['on', 'off'].includes(value)) throw fail(400, 'Use: set notify on   or   set notify off');
      if (key === 'minfree' && !/^\d+$/.test(value)) throw fail(400, 'Use: set minfree <megabytes>   (0 turns the check off)');
      applySettings(map[key], { queue: ctx.queue, setNotify: ctx.setNotify });
      return { text: `Saved: ${key} = ${value || 'default'}` };
    },
  },
  {
    name: 'update-ytdlp',
    usage: 'update-ytdlp',
    summary: 'Update yt-dlp to the newest version',
    run: async () => {
      const result = await updateYtdlp();
      return { text: result.output || (result.ok ? 'yt-dlp is up to date.' : 'The update did not finish.'), data: result };
    },
  },
  {
    name: 'folder',
    usage: 'folder',
    summary: 'Print the download folder path',
    run: () => ({ text: settings.downloadDir }),
  },
  {
    name: 'history',
    usage: 'history',
    summary: 'Show the last 20 finished downloads',
    run: (a, ctx) => {
      const rows = historyOf(ctx.queue.list()).slice(0, 20);
      if (!rows.length) return { text: 'No finished downloads yet.', data: [] };
      const text = rows.map((h) => `${dateText(h.finishedAt)}  ${humanBytes(h.size).padStart(9)}  ${h.title}`).join('\n');
      return { text, data: rows };
    },
  },
  {
    name: 'stats',
    usage: 'stats',
    summary: 'Totals for the library and the queue, and the average download speed',
    run: (a, ctx) => {
      const data = statsOf(ctx.queue.list(), listFiles(settings.downloadDir, ctx.queue.activeBases()));
      const text = [
        `Library:   ${data.totalFiles} file${data.totalFiles === 1 ? '' : 's'} · ${humanBytes(data.totalBytes)}`,
        `Done:      ${data.doneCount}`,
        `Failed:    ${data.failedCount}`,
        `Active:    ${data.activeCount}`,
        `Average:   ${data.averageSpeedKbps} KB/s`,
      ].join('\n');
      return { text, data };
    },
  },
];

/** The list of commands, for the Commands panel and the command line help. */
function commandList() {
  return COMMANDS.map(({ name, usage, summary }) => ({ name, usage, summary }));
}

/** Runs one command. input is a command line (string) or the words already split (array). ctx: { queue, setNotify }. */
async function runCommand(input, ctx) {
  const tokens = Array.isArray(input) ? input.map((t) => clean(t, MAX_LINE)).filter(Boolean) : tokenize(input);
  if (!tokens.length) return COMMANDS[0].run();
  const [word, ...rest] = tokens;
  // Short forms: "set folder ~/Videos" is the same as "settings set folder ~/Videos".
  const shortcuts = { set: 'settings' };
  const name = shortcuts[word.toLowerCase()] || word;
  const args = shortcuts[word.toLowerCase()] === 'settings' ? ['set', ...rest] : rest;
  const cmd = COMMANDS.find((c) => c.name === name.toLowerCase());
  if (!cmd) throw fail(400, `Unknown command “${name}”. Type help to see all commands.`);
  return cmd.run(parseArgs(args), ctx);
}

module.exports = {
  COMMANDS, commandList, runCommand, tokenize, parseArgs, humanBytes,
  downloadOptions, applySettings, importSettings, checkSpeedLimit, checkCookiesFile, clean, VIDEO_CONTAINERS, SPEED_RE,
  queueBatch, batchLinks, BATCH_LIMIT,
};
