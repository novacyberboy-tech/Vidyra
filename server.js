'use strict';
// Vidyra — HTTP backend: JSON API, download queue, live events (SSE), library and Android notifications.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const {
  BRAND, PUBLIC_DIR, JOBS_FILE, isTermux, isWindows, settings, persistSettings, folderPresets, expandHome, clampInt,
} = require('./src/config');
const { getInfo, searchStream, validateUrl, buildArgs, fail, updateYtdlp, tierFor } = require('./src/ytdlp');
const { checkId, songInfo, streamSong } = require('./src/stream');
const { detectTools } = require('./src/tools');
const { JobQueue } = require('./src/jobs');
const { EventHub } = require('./src/events');
const {
  listFiles, resolveFile, deleteFile, leftoversOf, cleanupLeftovers, freeSpace, renameFile,
} = require('./src/files');
const { TermuxNotifier } = require('./src/notify');
const {
  clean, applySettings, importSettings, downloadOptions, runCommand, commandList, queueBatch,
} = require('./src/commands');
const {
  SEARCH_KINDS, searchSourceFor, ensureFreeSpace, historyOf, statsOf, shareableSettings,
} = require('./src/features');
const { createSuggestions } = require('./src/suggest');
const { sendJson, sendError, readJson, serveFile, serveStatic } = require('./src/http');

const PORT = clampInt(process.env.PORT, 1, 65535, 8787);
const HOST = process.env.HOST || '127.0.0.1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'].includes(HOST);

const FRAGMENT_OPTIONS = [1, 2, 4, 8, 16, 24, 32];
let toolUpdateRunning = false;

const hub = new EventHub();
// VIDYRA_NOTIFY=off turns Android notifications off (the test suite sets it).
const notifyAllowed = process.env.VIDYRA_NOTIFY !== 'off';
const notifier = new TermuxNotifier({ enabled: notifyAllowed && isTermux && settings.termuxNotify });
const queue = new JobQueue({
  getOutDir: () => settings.downloadDir,
  getMaxParallel: () => settings.maxParallel,
  getRate: () => settings.speedLimit,
  getCookies: () => settings.cookiesFile,
  getRetries: () => settings.retries,
  getOutputTemplate: () => settings.outputTemplate,
  getNameTemplate: () => settings.nameTemplate,
  getExtraArgs: () => settings.extraArgs,
  persistFile: JOBS_FILE,
});
queue.on('update', (job) => {
  hub.send('job', job);
  notifier.onJob(job);
});
queue.on('remove', (info) => hub.send('remove', info));
const setNotify = (on) => notifier.setEnabled(notifyAllowed && isTermux && on);
const commandCtx = { queue, setNotify };

// Open access: no token is needed to use the app.
function authed() {
  return true;
}

/** When listening on loopback only, refuse requests whose Host header is not this machine (blocks DNS rebinding). */
function hostAllowed(req) {
  if (!LOOPBACK) return true;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(String(req.headers.host || ''));
}

function settingsPayload(tools) {
  return {
    brand: BRAND,
    downloadDir: settings.downloadDir,
    maxParallel: settings.maxParallel,
    concurrentFragments: settings.concurrentFragments,
    fragmentOptions: FRAGMENT_OPTIONS,
    speedLimit: settings.speedLimit,
    retries: settings.retries,
    cookiesFile: settings.cookiesFile,
    termuxNotify: settings.termuxNotify,
    termuxNotifyReady: notifier.ready(),
    outputTemplate: settings.outputTemplate,
    nameTemplate: settings.nameTemplate,
    minFreeMb: settings.minFreeMb,
    extraArgs: settings.extraArgs,
    autoCleanDays: settings.autoCleanDays,
    presets: folderPresets(),
    platform: process.platform,
    isTermux,
    isWindows,
    tokenRequired: false,
    tools,
  };
}

// ---- routing -------------------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', '/api/health', ({ res }) => sendJson(res, 200, {
  ok: true, name: BRAND.name, version: BRAND.version, tokenRequired: false, platform: process.platform, isTermux,
}));

route('GET', '/api/settings', async ({ res, url }) => {
  const tools = await detectTools(url.searchParams.get('refresh') === '1');
  sendJson(res, 200, settingsPayload(tools));
});

route('POST', '/api/settings', async ({ req, res }) => {
  const body = await readJson(req);
  sendJson(res, 200, applySettings(body, { queue, setNotify }));
});

// Safe to share: no cookies file and no token-like values.
route('GET', '/api/settings/export', ({ res }) => sendJson(res, 200, shareableSettings(settings)));

route('POST', '/api/settings/import', async ({ req, res }) => {
  const body = await readJson(req);
  sendJson(res, 200, importSettings(body, { queue, setNotify }));
});

route('POST', '/api/tools/ytdlp/update', async ({ res }) => {
  if (toolUpdateRunning) throw fail(409, 'An update is already running');
  toolUpdateRunning = true;
  try {
    const result = await updateYtdlp();
    const tools = await detectTools(true);
    sendJson(res, 200, { ...result, tools });
  } finally {
    toolUpdateRunning = false;
  }
});

route('POST', '/api/info', async ({ req, res }) => {
  const body = await readJson(req);
  sendJson(res, 200, await getInfo(body.url, { cookies: settings.cookiesFile }));
});

// In-app playback: song metadata (yt-dlp runs once, cached 30 min) and a Range-capable audio stream.
route('GET', '/api/play', async ({ res, url }) => {
  const id = checkId(url.searchParams.get('id'));
  const info = await songInfo(id);
  sendJson(res, 200, {
    id, title: info.title, channel: info.channel, duration: info.duration, thumbnail: info.thumbnail,
    src: `/api/media/${id}`,
  });
});
route('GET', /^\/api\/media\/([A-Za-z0-9_-]{11})$/, async ({ req, res, params }) => {
  await streamSong(params[0], req, res);
});

route('GET', '/api/search', ({ res, url }) => {
  const q = clean(url.searchParams.get('q'), 200);
  if (!q) return sendError(res, 400, 'Type something to search for');
  const kind = url.searchParams.get('kind') || 'video';
  if (!SEARCH_KINDS.includes(kind)) return sendError(res, 400, 'Search kind must be video or music');
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  const search = searchStream(q, url.searchParams.get('limit'), {
    onItem: (item) => res.write(`${JSON.stringify({ type: 'item', item })}\n`),
    onDone: (info) => res.end(`${JSON.stringify({ type: 'done', ...info })}\n`),
    onError: (message) => res.end(`${JSON.stringify({ type: 'error', message })}\n`),
  }, { source: searchSourceFor(kind) });
  res.on('close', () => search.cancel());
  return undefined;
});

const suggestions = createSuggestions();

// Home screen feed. ?kind=video|music, ?fresh=1 skips the 15-minute cache.
route('GET', '/api/suggestions', async ({ res, url }) => {
  const kind = url.searchParams.get('kind') || 'video';
  if (!SEARCH_KINDS.includes(kind)) return sendError(res, 400, 'Suggestions kind must be video or music');
  sendJson(res, 200, await suggestions.get(kind, { fresh: url.searchParams.get('fresh') === '1' }));
  return undefined;
});

route('POST', '/api/download', async ({ req, res }) => {
  const body = await readJson(req);
  const opts = downloadOptions(body);
  // Validate now so bad input is reported right away (also checks the cookies file and speed limit).
  buildArgs({
    ...opts, outDir: settings.downloadDir, rate: settings.speedLimit, cookies: settings.cookiesFile,
  });
  // Refuse when the device is nearly full, unless the request says force.
  await ensureFreeSpace(settings.downloadDir, settings.minFreeMb, body.force === true);
  sendJson(res, 200, queue.publicJob(queue.add(opts)));
  return undefined;
});

// Many links, one set of options. Body: { urls, options, force }. Up to 50 different links.
route('POST', '/api/download/batch', async ({ req, res }) => {
  const body = await readJson(req);
  sendJson(res, 200, await queueBatch({ urls: body.urls, options: body.options, force: body.force === true }, commandCtx));
  return undefined;
});

route('GET', '/api/commands', ({ res }) => sendJson(res, 200, commandList()));

route('POST', '/api/command', async ({ req, res }) => {
  const body = await readJson(req);
  // Either a whole command line ("add https://…") or the words already split (["add", "https://…"]).
  const input = Array.isArray(body.args) ? body.args : String(body.line ?? '');
  const result = await runCommand(input, commandCtx);
  sendJson(res, 200, { ok: true, text: result.text || '', data: result.data ?? null });
});

route('GET', '/api/jobs', ({ res }) => sendJson(res, 200, queue.list()));

route('GET', '/api/history', ({ res }) => sendJson(res, 200, historyOf(queue.list())));

route('GET', '/api/stats', ({ res }) => sendJson(res, 200, statsOf(
  queue.list(), listFiles(settings.downloadDir, queue.activeBases()),
)));

route('POST', '/api/jobs/clear-finished', ({ res }) => sendJson(res, 200, { removed: queue.clearFinished() }));

route('POST', '/api/jobs/pause-all', async ({ req, res }) => {
  await readJson(req);
  if (isWindows) throw fail(501, 'Pause and resume are not supported on Windows. Cancel and retry instead.');
  sendJson(res, 200, { count: queue.pauseAll() });
});

route('POST', '/api/jobs/resume-all', async ({ req, res }) => {
  await readJson(req);
  if (isWindows) throw fail(501, 'Pause and resume are not supported on Windows. Cancel and retry instead.');
  sendJson(res, 200, { count: queue.resumeAll() });
});

route('POST', '/api/jobs/retry-failed', async ({ req, res }) => {
  await readJson(req);
  sendJson(res, 200, { queued: queue.retryFailed() });
});

route('POST', /^\/api\/jobs\/(\w+)\/(pause|resume|cancel|retry)$/, async ({ req, res, params }) => {
  await readJson(req);
  const [id, action] = params;
  if ((action === 'pause' || action === 'resume') && isWindows) {
    throw fail(501, 'Pause and resume are not supported on Windows. Cancel and retry instead.');
  }
  const job = queue[action](id);
  sendJson(res, 200, queue.publicJob(job));
  return undefined;
});

route('POST', /^\/api\/jobs\/(\w+)\/prioritise$/, async ({ req, res, params }) => {
  await readJson(req);
  sendJson(res, 200, queue.publicJob(queue.prioritise(params[0])));
});

route('DELETE', /^\/api\/jobs\/(\w+)$/, ({ res, params }) => sendJson(res, 200, queue.remove(params[0])));

route('GET', '/api/events', ({ req, res }) => {
  hub.add(req, res);
  res.write(`event: snapshot\ndata: ${JSON.stringify(queue.list())}\n\n`);
  return undefined;
});

route('GET', '/api/files', async ({ res }) => {
  const files = listFiles(settings.downloadDir, queue.activeBases());
  const { count, bytes } = leftoversOf(files);
  sendJson(res, 200, {
    dir: settings.downloadDir,
    files: files.map(({ active, ...f }) => f),
    freeBytes: await freeSpace(settings.downloadDir),
    leftovers: { count, bytes },
  });
});

route('POST', '/api/files/cleanup', async ({ req, res }) => {
  await readJson(req);
  sendJson(res, 200, cleanupLeftovers(settings.downloadDir, queue.activeBases()));
});

route('POST', '/api/files/rename', async ({ req, res }) => {
  const body = await readJson(req);
  sendJson(res, 200, { name: renameFile(settings.downloadDir, body.from, body.to, queue.activeBases()) });
});

route('DELETE', /^\/api\/files\/(.+)$/, ({ res, params }) => {
  if (!deleteFile(settings.downloadDir, params[0])) throw fail(404, 'That file no longer exists');
  sendJson(res, 200, { ok: true });
});

route('GET', /^\/files\/(.+)$/, ({ req, res, url, params }) => {
  const full = resolveFile(settings.downloadDir, params[0]);
  if (!full) return sendError(res, 404, 'Not found');
  return serveFile(req, res, full, { attachment: url.searchParams.get('dl') === '1' });
});

route('POST', '/api/open-folder', async ({ req, res }) => {
  await readJson(req);
  const dir = settings.downloadDir;
  const candidates = isTermux ? ['termux-open', 'xdg-open']
    : isWindows ? ['explorer.exe']
      : process.platform === 'darwin' ? ['open'] : ['xdg-open'];
  const tryLaunch = (i) => {
    if (i >= candidates.length) {
      return sendJson(res, 501, {
        error: 'No file manager could be opened. Use the Library tab to see your files.',
        downloadDir: dir,
      });
    }
    const child = spawn(candidates[i], [dir], { detached: true, stdio: 'ignore' });
    child.once('error', () => tryLaunch(i + 1));
    child.once('spawn', () => {
      child.unref();
      sendJson(res, 200, { ok: true, message: 'Opening your download folder' });
    });
    return undefined;
  };
  tryLaunch(0);
  return undefined;
});

route('POST', '/api/termux/storage-setup', async ({ req, res }) => {
  await readJson(req);
  if (!isTermux) throw fail(400, 'Storage setup is only needed on Termux (Android)');
  const child = spawn('termux-setup-storage', [], { stdio: 'ignore', detached: true });
  child.once('error', () => sendError(res, 501, 'termux-setup-storage is not installed. Run: pkg install termux-api'));
  child.once('spawn', () => {
    child.unref();
    sendJson(res, 200, { ok: true, message: 'Allow storage access on your phone, then come back to Vidyra.' });
  });
  return undefined;
});

// ---- request handler -----------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const { pathname } = url;
  try {
    if (!hostAllowed(req)) return sendError(res, 403, 'Host not allowed');
    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/files/');
    if (isApi && pathname !== '/api/health' && !authed(req, url)) {
      return sendError(res, 401, 'Access token required');
    }
    if (isApi && ['POST', 'DELETE', 'PUT'].includes(req.method)
      && !/application\/json/i.test(String(req.headers['content-type'] || ''))) {
      return sendError(res, 415, 'Requests must be sent as JSON');
    }
    if (isApi) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = typeof r.pattern === 'string' ? (r.pattern === pathname ? [] : null) : r.pattern.exec(pathname);
        if (match) return await r.handler({ req, res, url, params: match.slice(1) });
      }
      return sendError(res, 404, 'Not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method not allowed');
    if (serveStatic(req, res, PUBLIC_DIR, pathname)) return undefined;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error('[vidyra]', e);
    if (res.headersSent) return res.end();
    return sendError(res, status, status === 500 ? 'Something went wrong. Please try again.' : e.message);
  }
}

const server = http.createServer(handle);

/** Stop without losing work: running downloads go back to the queue and resume on the next start. */
function shutdown() {
  queue.shutdown();
  hub.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

if (require.main === module) {
  try { fs.mkdirSync(settings.downloadDir, { recursive: true }); } catch (e) {
    console.warn(`  Warning: could not create ${settings.downloadDir} (${e.code || e.message})`);
  }
  // Keeps Vidyra alive when the terminal that started it is closed (background mode).
  process.on('SIGHUP', () => {});
  server.listen(PORT, HOST, async () => {
    const tools = await detectTools(true);
    const shownHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`\n  ${BRAND.name} ${BRAND.version} — ${BRAND.tagline}`);
    console.log(`  Open:       http://${shownHost}:${PORT}`);
    console.log(`  Downloads:  ${settings.downloadDir}`);
    console.log(`  yt-dlp:     ${tools.ytdlp.installed ? tools.ytdlp.version : 'NOT INSTALLED — run scripts/setup.sh'}`);
    console.log(`  ffmpeg:     ${tools.ffmpeg.installed ? tools.ffmpeg.version : 'NOT INSTALLED — merging and conversion need it'}`);
    if (!LOOPBACK) console.log('  Network mode: open access, anyone who can reach this address can use it.');
    if (queue.list().some((j) => j.status === 'queued')) console.log('  Queue:      resuming unfinished downloads');
    console.log('');
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { server, queue, hub, notifier };
