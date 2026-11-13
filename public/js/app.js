// Vidyra app shell: routing, the 5-tab strip and bottom navigation, live status, job notifications,
// keyboard shortcuts and the command palette.
import {
  $, esc, icon, api, getToken, store, prefs, emit, on, toast, applyPrefs, progressText, saveToDevice,
  systemNotify, vibrate, setPref,
} from './core.js';
import { fire, animate, installAnimations } from './fx.js';
import { openPalette } from './palette.js';
import * as download from './views/download.js';
import * as search from './views/search.js';
import * as music from './views/music.js';
import * as queue from './views/queue.js';
import * as tools from './views/tools.js';
import * as library from './views/library.js';
import * as settings from './views/settings.js';
import * as about from './views/about.js';
import { mountPlayer } from './music-player.js';

const VIEWS = { download, search, music, queue, tools, library, settings, about };
// The Download family: the 5 tabs under the header. Video is the paste-link screen (#/download).
const FAMILY = [
  { id: 'search', label: 'Search' },
  { id: 'download', label: 'Video' },
  { id: 'music', label: 'Music' },
  { id: 'queue', label: 'Queue' },
  { id: 'tools', label: 'Tools' },
];
const BOTTOM = [
  { id: 'download', label: 'Download', icon: 'download' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
const SIDE_ICON = { download: 'download', library: 'library', settings: 'settings' };
const ACTIVE = new Set(['queued', 'downloading', 'paused']);
const FINISHED = new Set(['done', 'error', 'cancelled']);
const TITLES = {
  download: ['Video', 'Paste a link, or queue several at once'],
  search: ['Search', 'Find videos, then download them'],
  music: ['Music', 'Find songs and save them as audio'],
  queue: ['Queue', 'Live progress for every download'],
  tools: ['Tools', 'Stats, history and the command console'],
  library: ['Library', 'Everything you have downloaded'],
  settings: ['Settings', 'Preferences, storage, notifications and tools'],
  about: ['About Vidyra', 'What it does and how to use it'],
};
const SETTINGS_TITLES = {
  general: ['General', 'Basics, density, focus and sounds'],
  downloads: ['Downloads', 'Folder, naming, limits and cookies'],
  appearance: ['Appearance', 'Themes, accents and animations'],
  notifications: ['Notifications', 'Background and Android alerts'],
  advanced: ['Advanced', 'Tools, command console and extras'],
  data: ['Data', 'Export, import and clean-up'],
  about: ['About', 'What Vidyra is, credits and help'],
};

let pendingUrl = '';
let pendingBatch = '';
let currentView = null;
let installPrompt = null;
let gChord = 0;

const ctx = {
  navigate(id, sub = '') { location.hash = sub ? `#/${id}/${sub}` : `#/${id}`; },
  sub: '',
  setPendingUrl(url) { pendingUrl = url; },
  takePendingUrl() { const u = pendingUrl; pendingUrl = ''; return u; },
  setPendingBatch(text) { pendingBatch = text; },
  takePendingBatch() { const t = pendingBatch; pendingBatch = ''; return t; },
  refreshSettings: loadSettings,
  getInstallPrompt: () => installPrompt,
  clearInstallPrompt() { installPrompt = null; emit('install'); },
  focusSearch() { document.querySelector('#sQ')?.focus(); },
};

// ---------- shell ----------
function renderNav() {
  $('#sidenav').innerHTML = BOTTOM.map((n) => `
    <a class="nav-btn" href="#/${n.id}" data-nav="${n.id}">
      ${icon(SIDE_ICON[n.id])}<span class="nav-label">${n.label}</span>
    </a>`).join('');
  $('#bottomnav').innerHTML = BOTTOM.map((n) => `
    <a class="nav-btn" href="#/${n.id}" data-nav="${n.id}" aria-label="${n.label}">
      ${icon(n.icon)}<span class="nav-label">${n.label}</span>
    </a>`).join('');
  $('#subtabs').innerHTML = FAMILY.map((t) => `
    <a class="subtab" href="#/${t.id}" data-tab="${t.id}">${esc(t.label)}${t.id === 'queue' ? '<span class="nav-count hidden" data-count></span>' : ''}</a>`).join('');
  $('#sidefoot').innerHTML = `
    <div>Vidyra ${esc(store.settings?.brand?.version || '3.0.0')}</div>
    <a href="#/about" class="nav-btn" style="height:34px;padding:0 4px;color:var(--muted)">${icon('help', 'sm')}<span>About &amp; help</span></a>`;
}

const FAMILY_IDS = new Set(FAMILY.map((t) => t.id));

function markActive(id) {
  const bottomId = FAMILY_IDS.has(id) ? 'download' : (id === 'about' ? 'settings' : id);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === bottomId) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#subtabs').hidden = !FAMILY_IDS.has(id);
}

function updateCounts() {
  const active = [...store.jobs.values()].filter((j) => ACTIVE.has(j.status)).length;
  document.querySelectorAll('[data-count]').forEach((el) => {
    el.textContent = String(active);
    el.classList.toggle('hidden', active === 0);
    el.setAttribute('aria-label', `${active} active downloads`);
  });
}

function updatePill() {
  const pill = $('#statusPill');
  const tools = store.tools;
  let cls = '';
  let text = 'Ready';
  if (!store.live) {
    cls = 'warn';
    text = 'Reconnecting…';
  } else if (tools && !tools.ytdlp?.installed) {
    cls = 'warn';
    text = 'Setup needed';
  } else if (tools && !tools.ffmpeg?.installed) {
    cls = 'warn';
    text = 'ffmpeg missing';
  } else if (tools) {
    cls = 'ok';
    text = 'Ready';
  }
  pill.className = `pill ${cls}`;
  pill.innerHTML = `<span class="dot"></span><span>${text}</span>`;
  pill.title = tools ? `yt-dlp ${tools.ytdlp?.installed ? tools.ytdlp.version : 'missing'} · ffmpeg ${tools.ffmpeg?.installed ? 'ready' : 'missing'}` : '';
  // A warning pill is a shortcut to the Advanced group of Settings, where the tools are.
  pill.style.cursor = cls === 'warn' && store.live ? 'pointer' : '';
  pill.onclick = cls === 'warn' && store.live ? () => { location.hash = '#/settings/advanced'; } : null;
}

// ---------- routing ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const id = parts[0] || 'download';
  const sub = parts[1] || '';
  if (id === 'settings') return { id, sub: SETTINGS_TITLES[sub] ? sub : '' };
  return { id: VIEWS[id] ? id : 'download', sub: '' };
}

function render() {
  const route = parseRoute();
  const id = route.id;
  if (currentView?.cleanup) {
    try { currentView.cleanup(); } catch { /* view already gone */ }
  }
  const view = VIEWS[id];
  const container = $('#view');
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'stack';
  container.append(wrap);
  const [title, sub] = id === 'settings' && route.sub ? SETTINGS_TITLES[route.sub] : TITLES[id];
  $('#pageTitle').textContent = title;
  $('#pageSub').textContent = sub;
  document.title = `${title} · Vidyra`;
  markActive(id);
  ctx.sub = route.sub;
  currentView = { id, cleanup: view.mount(wrap, ctx) };
  animate(wrap, 'tab');
  window.scrollTo(0, 0);
  container.focus({ preventScroll: true });
}

// ---------- settings & tools ----------
async function loadSettings(refresh = false) {
  try {
    const data = await api(`/api/settings${refresh ? '?refresh=1' : ''}`);
    store.settings = data;
    store.tools = data.tools;
    emit('settings', data);
  } catch (e) {
    // Keep the last known state; the status pill shows the connection problem.
    console.warn('settings unavailable', e.message);
  }
  updatePill();
}

// ---------- live events ----------
function handleTransition(job) {
  const prev = store.jobs.get(job.id);
  if (!prev || !ACTIVE.has(prev.status) || !FINISHED.has(job.status)) return;
  if (job.status === 'done') {
    if (job.deliver && job.file) {
      // "Save to device": Chrome's own download starts now and shows its progress in the notification shade.
      saveToDevice(job.file);
      toast(`${job.title} is now saving to this device.`, { type: 'success', title: 'Saving to your device', timeout: 6000, sound: false });
    } else {
      toast(job.title, {
        type: 'success', title: 'Download complete', sound: false,
        action: { label: 'Open library', onClick: () => { location.hash = '#/library'; } },
      });
    }
    fire('complete');
    vibrate([80, 40, 80]);
    if (document.hidden) systemNotify('Download complete', job.title, `job-${job.id}`);
  } else if (job.status === 'error') {
    toast(job.error || 'The download failed.', {
      type: 'error', title: 'Download failed', timeout: 7000,
      action: { label: 'Open queue', onClick: () => { location.hash = '#/queue'; } },
    });
    if (document.hidden) systemNotify('Download failed', job.title, `job-${job.id}`);
  }
}

let events = null;
const lastProgressNotice = new Map();

/** While Vidyra is in the background, the notification for an active download shows a text progress bar. */
function notifyProgress(job) {
  if (!document.hidden || !prefs.notify || !ACTIVE.has(job.status)) return;
  const now = Date.now();
  if (now - (lastProgressNotice.get(job.id) || 0) < 3000) return;
  lastProgressNotice.set(job.id, now);
  const detail = job.status === 'paused' ? 'Paused' : [job.speed, job.eta ? `${job.eta} left` : ''].filter(Boolean).join(' · ');
  systemNotify(`Downloading · ${job.title}`, `${progressText(job.percent)}${detail ? `\n${detail}` : ''}`, `job-${job.id}`, { silent: true });
}

function connectEvents() {
  events?.close();
  const token = getToken();
  const es = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
  events = es;
  es.addEventListener('snapshot', (e) => {
    store.jobs = new Map(JSON.parse(e.data).map((j) => [j.id, j]));
    store.live = true;
    updatePill();
    updateCounts();
    emit('jobs');
  });
  es.addEventListener('job', (e) => {
    const job = JSON.parse(e.data);
    handleTransition(job);
    notifyProgress(job);
    store.jobs.set(job.id, job);
    updateCounts();
    emit('jobs');
  });
  es.addEventListener('remove', (e) => {
    store.jobs.delete(JSON.parse(e.data).id);
    updateCounts();
    emit('jobs');
  });
  es.onopen = () => { store.live = true; updatePill(); };
  es.onerror = () => { store.live = false; updatePill(); };
}

// Signing in (LAN mode) needs a fresh event stream that carries the token.
on('token', () => { connectEvents(); loadSettings(); });

// ---------- keyboard ----------
const GOTO = { d: 'download', l: 'library', s: 'settings', t: 'tools' };

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    openPalette(ctx);
    return;
  }
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (Date.now() < gChord && GOTO[key]) {
    e.preventDefault();
    gChord = 0;
    location.hash = `#/${GOTO[key]}`;
    return;
  }
  if (key === 'g' && !e.shiftKey) {
    gChord = Date.now() + 1200; // press g, then d, l, s or t within a moment
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    if (parseRoute().id === 'search') { ctx.focusSearch(); return; }
    location.hash = '#/search';
    setTimeout(() => ctx.focusSearch(), 60);
    return;
  }
  if (key === 'f') {
    e.preventDefault();
    setPref('focusMode', !prefs.focusMode);
    toast(prefs.focusMode ? 'Focus mode on' : 'Focus mode off', { type: 'info', timeout: 1600 });
  }
}

// ---------- boot ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* needs HTTPS or localhost; app works without it */ });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) location.href = e.data.url;
  });
}

function boot() {
  // Opening splash, once per session. Loaded without waiting, so the app renders at once underneath it.
  // The share-link check runs now, before takeSharedLink() rewrites the address.
  const sharedOpen = /url=|text=/.test(location.search);
  import('./splash.js').then((m) => m.showSplash({ shared: sharedOpen })).catch(() => {});
  installAnimations();
  mountPlayer();
  applyPrefs();
  renderNav();
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; emit('install'); });
  window.addEventListener('appinstalled', () => { installPrompt = null; emit('install'); toast('Vidyra is installed on this device.', { type: 'success' }); });
  on('prefs', (e) => {
    if (['sounds', 'motion', 'theme', 'accent', 'density', 'focusMode', 'autoNightTheme', '*'].includes(e.detail?.key)) applyPrefs();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (prefs.theme === 'system') applyPrefs(); });
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('a[href^="#/"]');
    if (nav && prefs.sounds) fire('press');
    if (nav && prefs.haptics && navigator.vibrate) navigator.vibrate(8);
  }, { passive: true });
  document.addEventListener('keydown', onKey);
  $('#paletteBtn').addEventListener('click', () => openPalette(ctx));

  // Offline / online banner
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.hidden = navigator.onLine;
  banner.textContent = 'You are offline. Downloads and search need a connection.';
  document.body.prepend(banner);
  window.addEventListener('online', () => { banner.hidden = true; toast('Back online.', { type: 'success', timeout: 2000, sound: false }); });
  window.addEventListener('offline', () => { banner.hidden = false; });
  connectEvents();
  loadSettings();
  setInterval(() => loadSettings(), 60_000);
  takeSharedLink();
  render();
  registerServiceWorker();
}

/** Android share sheet: "Share → Vidyra" opens the app with the link in the address (see manifest share_target). */
function takeSharedLink() {
  const params = new URLSearchParams(location.search);
  if (!params.toString()) return;
  const text = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
  const found = text.match(/https?:\/\/[^\s<>"']+/);
  if (found) ctx.setPendingUrl(found[0]);
  history.replaceState(null, '', `/#/${found ? 'download' : (location.hash.replace(/^#\/?/, '') || 'download')}`);
}

boot();
