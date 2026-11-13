// Shared helpers: DOM shortcuts, API client, preferences, themes, toasts, dialogs, notifications and
// small shared flows (queueing with the low-space confirm, the streamed search, list entrance animations).
import { fire, animate } from './fx.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const icon = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

// ---------- formatting ----------
export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x >= 100 || i === 0 ? Math.round(x) : x.toFixed(1)} ${units[i]}`;
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export function fmtViews(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B views`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M views`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K views`;
  return `${v} views`;
}

export function timeAgo(ms) {
  const diff = Date.now() - Number(ms || 0);
  if (diff < 60e3) return 'just now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} min ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- events between views ----------
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  bus.addEventListener(name, fn);
  return () => bus.removeEventListener(name, fn);
};

// ---------- shared state ----------
export const store = {
  settings: null,
  tools: null,
  jobs: new Map(),
  live: false,
};

// ---------- themes and accents ----------
// A theme is a named set of colours. Its CSS lives in css/app.css under [data-theme-name]. The list here drives
// the pickers. c = [background, surface, text, accent] for the preview swatch. mode decides light or dark chrome.
export const THEMES = [
  { id: 'night', label: 'Night', mode: 'dark', c: ['#0b0c10', '#15171d', '#f5f6f8', '#FFC61A'] },
  { id: 'midnight', label: 'Midnight', mode: 'dark', c: ['#070b18', '#0f1629', '#e8edff', '#6C8CFF'] },
  { id: 'ember', label: 'Ember', mode: 'dark', c: ['#120a08', '#1d110d', '#fbeee9', '#FF6B3D'] },
  { id: 'forest', label: 'Forest', mode: 'dark', c: ['#07100b', '#0f1a13', '#e9f5ed', '#3DDC84'] },
  { id: 'ocean', label: 'Deep ocean', mode: 'dark', c: ['#05111a', '#0b1c28', '#e6f4fb', '#20B2FF'] },
  { id: 'violet', label: 'Violet', mode: 'dark', c: ['#0c0812', '#171023', '#f1ebff', '#A66BFF'] },
  { id: 'graphite', label: 'Graphite', mode: 'dark', c: ['#0e0f11', '#17181c', '#eef0f3', '#C8CED8'] },
  { id: 'cosmos', label: 'Cosmos', mode: 'dark', c: ['#050510', '#0d0d22', '#ecebff', '#7F7CFF'] },
  { id: 'rosewood', label: 'Rosewood', mode: 'dark', c: ['#140a0d', '#1f1116', '#faeef1', '#FF5C8A'] },
  { id: 'slate', label: 'Slate', mode: 'dark', c: ['#0f1316', '#182026', '#e8eef3', '#5EC8E5'] },
  { id: 'mocha', label: 'Mocha', mode: 'dark', c: ['#13100c', '#1e1913', '#f4ece2', '#E0A96D'] },
  { id: 'aurora', label: 'Aurora', mode: 'dark', c: ['#061014', '#0e1d22', '#e7fbf6', '#3DF5C0'] },
  { id: 'crimson', label: 'Crimson', mode: 'dark', c: ['#100607', '#1b0c0e', '#fbeaea', '#E8333F'] },
  { id: 'oled', label: 'Pure black', mode: 'dark', c: ['#000000', '#0b0b0b', '#ffffff', '#FFC61A'] },
  { id: 'paper', label: 'Paper', mode: 'light', c: ['#f6f5f1', '#ffffff', '#14161a', '#E0A100'] },
  { id: 'cloud', label: 'Cloud', mode: 'light', c: ['#f3f6fb', '#ffffff', '#0f1b2d', '#3B82F6'] },
  { id: 'cream', label: 'Cream', mode: 'light', c: ['#fbf6ea', '#fffdf7', '#2b2112', '#D9822B'] },
  { id: 'mint-light', label: 'Mint', mode: 'light', c: ['#eff8f4', '#ffffff', '#0d2119', '#14A37F'] },
  { id: 'sky-light', label: 'Sky', mode: 'light', c: ['#eef7fd', '#ffffff', '#0b2233', '#0EA5E9'] },
  { id: 'lavender', label: 'Lavender', mode: 'light', c: ['#f5f2fb', '#ffffff', '#1d1530', '#8B5CF6'] },
  { id: 'blush', label: 'Blush', mode: 'light', c: ['#fdf1f4', '#ffffff', '#2a1219', '#E11D48'] },
  { id: 'sand-light', label: 'Sand', mode: 'light', c: ['#f2efe6', '#faf8f2', '#1f1d18', '#B45309'] },
];
export const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]));

// Twelve accent colours, applied as --accent and --accent-2. 'theme' keeps the theme's own accent.
export const ACCENTS = [
  { id: 'gold', label: 'Gold', c1: '#FFC61A', c2: '#FF9F1A' },
  { id: 'coral', label: 'Coral', c1: '#FF6F61', c2: '#FFB067' },
  { id: 'mint', label: 'Mint', c1: '#34D399', c2: '#2DD4BF' },
  { id: 'lilac', label: 'Lilac', c1: '#B497FF', c2: '#F0ABFC' },
  { id: 'ocean', label: 'Ocean', c1: '#3B82F6', c2: '#06B6D4' },
  { id: 'ember', label: 'Ember', c1: '#FF5A1F', c2: '#FFB300' },
  { id: 'lime', label: 'Lime', c1: '#A3E635', c2: '#22C55E' },
  { id: 'rose', label: 'Rose', c1: '#F43F5E', c2: '#FB7185' },
  { id: 'sky', label: 'Sky', c1: '#38BDF8', c2: '#60A5FA' },
  { id: 'sand', label: 'Sand', c1: '#D6B37A', c2: '#F5D9A8' },
  { id: 'ice', label: 'Ice', c1: '#A5F3FC', c2: '#E0F2FE' },
  { id: 'plum', label: 'Plum', c1: '#9333EA', c2: '#C026D3' },
];
export const ACCENT_BY_ID = new Map(ACCENTS.map((a) => [a.id, a]));
export const ACCENT_NAMES = Object.fromEntries(ACCENTS.map((a) => [a.id, a.label]));

// Older builds stored these names. Each maps to the nearest new one, so saved choices keep working.
const LEGACY_THEME = { dark: 'night', light: 'paper' };
const LEGACY_ACCENT = { indigo: 'ocean', emerald: 'mint', rose: 'rose', amber: 'gold', sky: 'sky', violet: 'lilac', teal: 'mint', coral: 'coral' };

// ---------- preferences (this browser only) ----------
const PREFS_KEY = 'vidyra.prefs';
const DEFAULT_PREFS = {
  theme: 'night',             // fresh-install default (matches the reference look). system | a THEMES id (night, paper …). Old dark / light values are migrated.
  accent: 'gold',              // theme | an ACCENTS id
  motion: !matchMedia('(prefers-reduced-motion: reduce)').matches,
  sounds: true,
  notify: false,
  confirmDownloads: true,
  mode: 'video',
  container: 'mp4',
  audioFormat: 'mp3',
  thumbnail: false,
  subs: false,
  subLangs: 'en',
  sponsorBlock: false,
  embedChapters: true,
  density: 'comfortable',     // comfortable | compact
  haptics: true,
  defaultHeight: 'best',
  autoFocusSearch: true,
  showEtaTotal: true,
  queueFilter: 'all',
  libraryView: 'list',        // list | grid
  keepScreenOn: false,
  writeDescription: false,
  writeInfoJson: false,
  openAfterDownload: false,
  libThumbs: true,            // library: show video previews
  // Custom Vidyra features
  focusMode: false,
  quietHoursOn: false,
  quietStart: 23,
  quietEnd: 7,
  autoNightTheme: false,
  formatAdvisor: true,
  streakEnabled: true,
  dataSaver: false,           // 480p default and no thumbnails (Video screen)
};

function normalizePrefs(p) {
  const out = { ...p };
  if (LEGACY_THEME[out.theme]) out.theme = LEGACY_THEME[out.theme];
  if (LEGACY_ACCENT[out.accent]) out.accent = LEGACY_ACCENT[out.accent];
  if (out.theme !== 'system' && !THEME_BY_ID.has(out.theme)) out.theme = 'system';
  if (out.accent !== 'theme' && !ACCENT_BY_ID.has(out.accent)) out.accent = 'theme';
  return out;
}

export const prefs = (() => {
  try {
    return normalizePrefs({ ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') });
  } catch {
    return { ...DEFAULT_PREFS };
  }
})();

export function setPref(key, value) {
  prefs[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode: keep in memory */ }
  applyPrefs();
  emit('prefs', { key, value });
}

export function resetPrefs() {
  try { localStorage.removeItem(PREFS_KEY); } catch { /* ignore */ }
  Object.assign(prefs, DEFAULT_PREFS);
  applyPrefs();
  emit('prefs', { key: '*' });
}

/** The theme id in use right now. System follows the device (and the night window when that setting is on). */
export function effectiveThemeId() {
  if (prefs.theme && prefs.theme !== 'system') return prefs.theme;
  if (prefs.autoNightTheme) {
    const h = new Date().getHours();
    return (h >= 20 || h < 7) ? 'night' : 'paper';
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper';
}

/** Text colour that reads well on an accent: dark ink on light accents, white on dark ones. */
function inkFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#141005' : '#ffffff';
}

export function applyPrefs() {
  const root = document.documentElement;
  const id = effectiveThemeId();
  const theme = THEME_BY_ID.get(id) || THEMES[0];
  root.setAttribute('data-theme-name', theme.id);
  root.setAttribute('data-theme', theme.mode);
  root.setAttribute('data-motion', prefs.motion ? 'on' : 'off');
  root.setAttribute('data-density', prefs.density === 'compact' ? 'compact' : 'comfortable');
  document.body?.classList.toggle('focus-mode', Boolean(prefs.focusMode));
  const acc = ACCENT_BY_ID.get(prefs.accent);
  if (acc) {
    root.style.setProperty('--accent', acc.c1);
    root.style.setProperty('--accent-2', acc.c2);
    root.style.setProperty('--accent-ink', inkFor(acc.c1));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-2');
    root.style.removeProperty('--accent-ink');
  }
  const meta = document.querySelector('meta[name="theme-color"][media*="dark"]');
  if (meta) meta.content = theme.c[0];
}

// ---------- API ----------
const TOKEN_KEY = 'vidyra.token';
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } };

export function fileUrl(name, { download = false } = {}) {
  const params = new URLSearchParams();
  if (download) params.set('dl', '1');
  const token = getToken();
  if (token) params.set('token', token);
  const qs = params.toString();
  return `/files/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['x-token'] = token;
  const res = await fetch(path, {
    method, headers, signal,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401) {
    const saved = await askToken();
    if (saved) return api(path, { method, body, signal });
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Streams /api/search (ndjson). kind is 'video' or 'music'. Calls onItem for each result and onDone once.
 * Throws on a server error line. Resolves when the stream ends.
 */
export async function streamSearch(q, { kind = 'video', limit = 12, signal, onItem, onDone } = {}) {
  const token = getToken();
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&kind=${kind}&limit=${limit}`, {
    signal,
    headers: token ? { 'x-token': token } : {},
  });
  if (res.status === 401) {
    if (await askToken()) return streamSearch(q, { kind, limit, signal, onItem, onDone });
    throw new Error('Access token required. Open Settings to sign in.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Search failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'item') onItem?.(msg.item);
      else if (msg.type === 'error') throw new Error(msg.message);
      else if (msg.type === 'done') { finished = true; onDone?.(msg); }
    }
  }
  return undefined;
}

/**
 * Queues a download. When the device is short of space the server answers 507, and the person is asked
 * whether to download anyway. Rejects with err.cancelled = true when they say no.
 */
export async function queueDownload(body) {
  try {
    return await api('/api/download', { method: 'POST', body });
  } catch (e) {
    if (e.status !== 507) throw e;
    const ok = await confirmDialog({
      title: 'Low storage',
      message: 'Not enough free space. Download anyway?',
      ok: 'Download anyway',
      danger: true,
    });
    if (!ok) {
      const cancelled = new Error('Cancelled: not enough free space.');
      cancelled.cancelled = true;
      throw cancelled;
    }
    return api('/api/download', { method: 'POST', body: { ...body, force: true } });
  }
}

/** Entrance animation for a list of items, staggered a little so they arrive one after another. */
export function enterItems(root, selector, max = 14) {
  [...root.querySelectorAll(selector)].slice(0, max).forEach((el, i) => {
    el.style.animationDelay = `${i * 40}ms`;
    animate(el, 'enter');
  });
}

let tokenPrompt = null;

/** Shows a sign-in prompt for LAN mode. Resolves true once a working token is saved. One prompt at a time. */
export function askToken() {
  if (tokenPrompt) return tokenPrompt;
  tokenPrompt = new Promise((resolve) => {
    const body = document.createElement('div');
    body.innerHTML = `
      <p>This Vidyra server is protected. Enter the access token shown in the server console.</p>
      <div class="field"><label for="tokIn">Access token</label>
      <input id="tokIn" class="input mono" autocomplete="off" spellcheck="false"></div>
      <p class="msg err hidden" id="tokErr">That token was not accepted.</p>`;
    const dlg = dialog({
      title: 'Access token required',
      body,
      actions: [{ label: 'Continue', value: 'ok', variant: 'primary' }],
      dismissible: false,
      onOpen: (root) => {
        const input = root.querySelector('#tokIn');
        input.value = getToken();
        input.focus();
      },
      onAction: async (value, root) => {
        if (value !== 'ok') return false;
        const token = root.querySelector('#tokIn').value.trim();
        if (!token) return false;
        setToken(token);
        try {
          await fetch('/api/settings', { headers: { 'x-token': token } }).then((r) => {
            if (r.status === 401) throw new Error('bad');
          });
          return true;
        } catch {
          root.querySelector('#tokErr').classList.remove('hidden');
          return false;
        }
      },
    });
    dlg.then((ok) => {
      tokenPrompt = null;
      if (ok) emit('token');
      resolve(Boolean(ok));
    });
  });
  return tokenPrompt;
}

// ---------- toasts ----------
/** A short message. success and error toasts also play their chosen sound (sound: false silences it). */
export function toast(message, { type = 'info', title, action, timeout = 4200, sound = true } = {}) {
  const stack = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
  el.innerHTML = `
    ${icon(iconName, 'lg')}
    <div class="t-body">
      ${title ? `<div class="t-title">${esc(title)}</div>` : ''}
      <div class="t-msg">${esc(message)}</div>
      ${action ? `<div class="t-action"><button class="btn btn-sm btn-ghost" type="button">${esc(action.label)}</button></div>` : ''}
    </div>
    <button class="t-close" type="button" aria-label="Dismiss">${icon('x', 'sm')}</button>`;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('.t-close').onclick = close;
  if (action) {
    el.querySelector('.t-action button').onclick = () => { action.onClick?.(); close(); };
  }
  stack.append(el);
  animate(el, 'toast');
  if (sound && (type === 'success' || type === 'error')) fire(type);
  while (stack.children.length > 4) stack.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
  return close;
}

// ---------- dialogs ----------
/**
 * Opens a modal (a bottom sheet on phones). body: string | Node.
 * actions: [{ label, value, variant: 'primary'|'danger'|'ghost' }]
 * Resolves with the action value, or null when dismissed.
 */
export function dialog({ title, body, actions = [], dismissible = true, wide = false, onOpen, onAction }) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = `modal${wide ? ' wide' : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    modal.setAttribute('aria-labelledby', titleId);
    modal.innerHTML = `${title ? `<div class="modal-head"><h2 id="${titleId}">${esc(title)}</h2>${dismissible ? `<button class="btn btn-icon btn-sm btn-ghost" type="button" data-dismiss aria-label="Close">${icon('x', 'sm')}</button>` : ''}</div>` : ''}<div class="m-body"></div>${actions.length ? '<div class="m-actions"></div>' : ''}`;
    const bodyEl = modal.querySelector('.m-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body) bodyEl.append(body);
    const actionsEl = modal.querySelector('.m-actions');
    const previous = document.activeElement;

    const done = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.add('closing');
      setTimeout(() => backdrop.remove(), 120);
      previous?.focus?.();
      resolve(value);
    };
    const runAction = async (action) => {
      if (onAction) {
        const keep = await onAction(action.value, modal);
        if (keep === false) return;
      }
      done(action.value);
    };
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn ${a.variant === 'primary' ? 'btn-primary' : a.variant === 'danger' ? 'btn-danger' : 'btn-ghost'}`;
      b.textContent = a.label;
      b.addEventListener('click', () => runAction(a));
      actionsEl.append(b);
    });
    modal.querySelector('[data-dismiss]')?.addEventListener('click', () => done(null));
    if (dismissible) backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) done(null); });

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); done(null); return; }
      if (e.key === 'Tab') {
        const focusables = $$('button, input, select, textarea, video, audio, [href]', modal).filter((el) => !el.disabled);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);

    backdrop.append(modal);
    root.append(backdrop);
    animate(modal, 'open');
    onOpen?.(modal, done);
    const firstAction = actionsEl?.querySelector('.btn-primary, .btn-danger') || actionsEl?.querySelector('button');
    (firstAction || modal.querySelector('input, button, video, audio') || modal).focus?.();
  });
}

export async function confirmDialog({ title, message, ok = 'Confirm', danger = false }) {
  const body = document.createElement('p');
  body.textContent = message;
  const result = await dialog({
    title,
    body,
    actions: [
      { label: 'Cancel', value: false, variant: 'ghost' },
      { label: ok, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return result === true;
}

// ---------- notifications ----------
export function notificationsSupported() {
  return 'Notification' in window;
}

/** Shows a system notification through the service worker (required on Android Chrome) when possible. */
export async function systemNotify(title, body, tag = 'vidyra', { silent = false } = {}) {
  if (!prefs.notify || !notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) {
      await reg.showNotification(title, { body, tag, silent, icon: '/icons/icon-192.png', data: { url: '/#/queue' } });
      return;
    }
    new Notification(title, { body, tag, silent, icon: '/icons/icon-192.png' });
  } catch { /* blocked by the browser */ }
}

/** A text progress bar for notifications, for example ████████░░░░ 40%. */
export function progressText(percent) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const filled = Math.round((pct / 100) * 16);
  return `${'█'.repeat(filled)}${'░'.repeat(16 - filled)} ${pct}%`;
}

/**
 * Hands a finished file to the browser's own download, so Chrome's download manager starts it at once and
 * shows its progress in the notification shade (the same as any other download on the phone).
 */
export function saveToDevice(name) {
  const a = document.createElement('a');
  a.href = fileUrl(name, { download: true });
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  setTimeout(() => a.remove(), 0);
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ---------- Custom Vidyra features (local-only, no server) ----------
const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const SS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private */ } };

/** Watch Later shelf: save URLs without downloading. */
export function watchLaterList() { return LS('vidyra.watchLater', []); }
export function watchLaterAdd(entry) {
  const list = [entry, ...watchLaterList().filter((x) => x.url !== entry.url)].slice(0, 40);
  SS('vidyra.watchLater', list);
  emit('watchLater');
  return list;
}
export function watchLaterRemove(url) {
  const list = watchLaterList().filter((x) => x.url !== url);
  SS('vidyra.watchLater', list);
  emit('watchLater');
  return list;
}

/** Download mood tags for personal organization. */
export const MOODS = ['study', 'music', 'backup', 'watch', 'work', 'fun'];
export function moodTags() { return LS('vidyra.moods', {}); }
export function setMoodTag(jobId, mood) {
  const m = moodTags();
  if (mood) m[jobId] = mood; else delete m[jobId];
  SS('vidyra.moods', m);
  return m;
}

/** Library favourites: file names the person starred. */
export function favouriteNames() { return LS('vidyra.favs', []); }
export function setFavourite(name, on) {
  const list = favouriteNames().filter((n) => n !== name);
  if (on) list.unshift(name);
  SS('vidyra.favs', list.slice(0, 500));
  return list;
}

/** Speed snapshot history (avg KB/s samples). */
export function speedHistory() { return LS('vidyra.speedHist', []); }
export function recordSpeedSample(kbps) {
  if (!Number.isFinite(kbps) || kbps <= 0) return speedHistory();
  const hist = [...speedHistory(), { t: Date.now(), kbps: Math.round(kbps) }].slice(-60);
  SS('vidyra.speedHist', hist);
  return hist;
}
export function avgSpeedKbps() {
  const h = speedHistory();
  if (!h.length) return 0;
  return Math.round(h.reduce((s, x) => s + x.kbps, 0) / h.length);
}

/** Download streak (consecutive days with at least one finished download). */
export function streakData() { return LS('vidyra.streak', { days: 0, last: '' }); }
export function bumpStreak() {
  if (!prefs.streakEnabled) return streakData();
  const today = new Date().toISOString().slice(0, 10);
  const s = streakData();
  if (s.last === today) return s;
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const next = { days: s.last === y ? (s.days || 0) + 1 : 1, last: today };
  SS('vidyra.streak', next);
  return next;
}

/** Quiet hours: block starting new downloads in a window. */
export function inQuietHours() {
  if (!prefs.quietHoursOn) return false;
  const h = new Date().getHours();
  const a = Number(prefs.quietStart) || 23;
  const b = Number(prefs.quietEnd) || 7;
  if (a === b) return false;
  return a < b ? (h >= a && h < b) : (h >= a || h < b);
}

/** Format advisor: long videos → suggest audio. */
export function adviseFormat(durationSec) {
  if (!prefs.formatAdvisor) return null;
  const s = Number(durationSec) || 0;
  if (s >= 3600) return { mode: 'audio', reason: 'Over 1 hour — audio saves a lot of space and bandwidth.' };
  if (s >= 1800) return { mode: 'audio', reason: '30+ minutes — audio is often enough for talks and podcasts.' };
  return null;
}

/** Download receipts: human-readable summary of finished jobs. */
export function buildReceipt(jobs) {
  const lines = ['Vidyra download receipt', new Date().toLocaleString(), '---'];
  for (const j of jobs) {
    lines.push(`${j.status === 'done' ? '✓' : '·'} ${j.title || j.url}`);
    if (j.file) lines.push(`  → ${j.file}`);
    if (j.label) lines.push(`  ${j.label}`);
  }
  lines.push('---', `Total: ${jobs.length} item(s)`);
  return lines.join('\n');
}

/** CSV text for the library list. Cells are quoted and any formula-like start is neutralised. */
export function csvOf(rows, header) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Saves text as a file in the browser (used for CSV and settings export). */
export function saveTextFile(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/** Night auto-theme and focus mode are applied by applyPrefs. Kept as a named export for older callers. */
export function applyFocusMode() {
  document.body.classList.toggle('focus-mode', Boolean(prefs.focusMode));
}
