import { playSong } from '../music-player.js';
// Shared pieces for the Music, Search and Video screens: suggestion shelves, the item sheet, recents and pins,
// copy-link, the duplicate check against the library, the queue summary and the batch queue call.
import { esc, icon, api, dialog, toast, fmtDuration, fmtViews, queueDownload, confirmDialog, store } from '../core.js';

export const RECENT_MUSIC_KEY = 'vidyra.recentMusic';
export const PINNED_KEY = 'vidyra.pinned';
const RECENT_MUSIC_MAX = 20;
const PINNED_MAX = 40;

function readList(key) {
  try {
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.url === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode: keep it in memory only */ }
}

export const recentMusic = () => readList(RECENT_MUSIC_KEY);
export function rememberMusic(item) {
  const entry = pick(item);
  writeList(RECENT_MUSIC_KEY, [entry, ...recentMusic().filter((x) => x.url !== entry.url)].slice(0, RECENT_MUSIC_MAX));
}

export const pinned = () => readList(PINNED_KEY);
export const isPinned = (url) => pinned().some((x) => x.url === url);
export function togglePin(item) {
  const list = pinned();
  if (list.some((x) => x.url === item.url)) {
    writeList(PINNED_KEY, list.filter((x) => x.url !== item.url));
    return false;
  }
  writeList(PINNED_KEY, [pick(item), ...list].slice(0, PINNED_MAX));
  return true;
}

function pick(item) {
  return {
    id: String(item.id || ''),
    url: String(item.url || ''),
    title: String(item.title || 'Untitled'),
    channel: String(item.channel || item.uploader || ''),
    thumbnail: String(item.thumbnail || ''),
    duration: Number(item.duration) || 0,
    at: Date.now(),
  };
}

/** Video id from a stored item, or from the URL when the id is missing. */
export function idOf(item) {
  if (item.id) return String(item.id);
  const m = String(item.url || '').match(/[?&]v=([A-Za-z0-9_-]{6,})/) || String(item.url || '').match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : '';
}

// ---------- suggestions ----------
/** Loads GET /api/suggestions. Throws with a readable message on failure. fresh bypasses the server cache. */
export async function loadSuggestions(kind, { fresh = false, signal } = {}) {
  return api(`/api/suggestions?kind=${encodeURIComponent(kind)}${fresh ? '&fresh=1' : ''}`, { signal });
}

export function skeletonShelves(kind, n = 2) {
  const cls = kind === 'music' ? 'sq' : '';
  const card = `<div class="hcard"><div class="thumb skel ${cls}" style="border-radius:14px"></div><div class="skel" style="height:13px;width:85%;margin-top:8px"></div><div class="skel" style="height:11px;width:55%;margin-top:6px"></div></div>`;
  return Array.from({ length: n }, () => `
    <section class="shelf" aria-hidden="true">
      <div class="skel" style="height:18px;width:38%;margin:0 16px 12px"></div>
      <div class="shelf-track">${Array.from({ length: 4 }, () => card).join('')}</div>
    </section>`).join('');
}

export function notesFor(data) {
  return data?.needsSetup
    ? `<div class="notice info enter" role="status">${icon('info')}<div><b>Suggestions need yt-dlp</b><span class="muted">Install yt-dlp in Settings → Advanced to see suggestions.</span><div style="margin-top:6px"><a class="btn btn-sm" href="#/settings/advanced">Open Advanced</a></div></div></div>`
    : '';
}

/** One card: square for music, 16:9 for video. data-item carries the id so taps reach the item. */
export function card(item, kind, i = 0) {
  const isMusic = kind === 'music';
  const meta = [item.channel || item.uploader, fmtDuration(item.duration) || fmtViews(item.views || item.view_count)].filter(Boolean).join(' · ');
  const pin = isPinned(item.url);
  return `
    <article class="hcard enter" style="--i:${Math.min(i, 12)}" data-url="${esc(item.url)}" data-id="${esc(item.id)}" data-kind="${kind}">
      <button type="button" class="thumb ${isMusic ? 'sq' : ''} ${item.thumbnail ? '' : 'nothumb'}" ${isMusic ? 'data-play' : 'data-open'} aria-label="${isMusic ? 'Play' : 'Open'} ${esc(item.title)}">
        ${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode?.classList.add('nothumb')">` : ''}
        ${!isMusic && item.duration ? `<span class="dur">${esc(fmtDuration(item.duration))}</span>` : ''}
        <span class="play-dot" aria-hidden="true">${icon('play', 'sm')}</span>
      </button>
      <div class="hcard-body">
        <div class="hcard-title" title="${esc(item.title)}">${esc(item.title || 'Untitled')}</div>
        <div class="hcard-sub truncate">${esc(meta)}</div>
      </div>
      ${kind === 'video' ? `<button type="button" class="hcard-pin ${pin ? 'on' : ''}" data-pin aria-pressed="${pin}" aria-label="${pin ? 'Unpin' : 'Pin'} ${esc(item.title)}" title="${pin ? 'Pinned' : 'Pin'}">${icon('star', 'sm')}</button>` : ''}
      ${isMusic ? `<button type="button" class="hcard-pin" data-open aria-label="More options for ${esc(item.title)}" title="Download and more">${icon('download', 'sm')}</button>` : ''}
    </article>`;
}

/** A titled horizontal shelf. Shuffle picks one random item and opens its sheet. */
export function shelf(section, kind, { shuffle = true } = {}) {
  const items = Array.isArray(section.items) ? section.items : [];
  const head = `
    <header class="shelf-head">
      <h2 class="shelf-title">${esc(section.title)}</h2>
      ${shuffle && items.length ? `<button type="button" class="btn btn-sm btn-ghost" data-shuffle="${esc(section.id)}" aria-label="Shuffle ${esc(section.title)}">${icon('zap', 'sm')} Shuffle</button>` : ''}
    </header>`;
  if (section.error) {
    return `<section class="shelf" aria-label="${esc(section.title)}">${head}<div class="shelf-empty muted small">${esc(section.error)}</div></section>`;
  }
  if (!items.length) {
    return `<section class="shelf" aria-label="${esc(section.title)}">${head}<div class="shelf-empty muted small">Nothing here right now.</div></section>`;
  }
  return `<section class="shelf" aria-label="${esc(section.title)}" data-section="${esc(section.id)}">${head}<div class="shelf-track" role="list">${items.map((it, i) => card(it, kind, i)).join('')}</div></section>`;
}

/** Looks up the item behind a card in a list of sections. */
export function findItem(sections, url) {
  for (const s of sections || []) {
    const hit = (s.items || []).find((x) => x.url === url);
    if (hit) return hit;
  }
  return null;
}

// ---------- sheet ----------
/**
 * Bottom sheet for an item. Music: audio, video, copy, YouTube Music. Video: download, audio, copy, open.
 * Download calls go to POST /api/download (mode audio or video), the same path as before.
 */
export async function openItemSheet(item, kind, { onQueued, onPlay } = {}) {
  if (!item?.url) return;
  const isMusic = kind === 'music';
  const body = document.createElement('div');
  body.className = 'sheet-body';
  body.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-thumb ${isMusic ? 'sq' : ''} ${item.thumbnail ? '' : 'nothumb'}">${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode?.classList.add('nothumb')">` : ''}</div>
      <div style="min-width:0"><b class="sheet-title">${esc(item.title || 'Untitled')}</b><span class="muted small">${esc(item.channel || item.uploader || '')}</span></div>
    </div>
    <div class="sheet-actions" role="group" aria-label="Actions">
      ${isMusic ? `<button type="button" class="sheet-btn" data-act="play">${icon('play', 'sm')}<span>Play in app</span></button>` : ''}
      <button type="button" class="sheet-btn" data-act="audio">${icon('audio', 'sm')}<span>Download audio (MP3)</span></button>
      ${isMusic ? '' : `<button type="button" class="sheet-btn" data-act="video">${icon('video', 'sm')}<span>Download video</span></button>`}
      <button type="button" class="sheet-btn" data-act="copy">${icon('copy', 'sm')}<span>Copy link</span></button>
      <button type="button" class="sheet-btn" data-act="open">${icon('external', 'sm')}<span>${isMusic ? 'Open on YouTube Music' : 'Open on YouTube'}</span></button>
    </div>`;
  let closeFn = null;
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'play') {
      closeFn?.();
      if (onPlay) onPlay(item); else playSong([item], 0);
      return undefined;
    }
    if (act === 'copy') return copyLink(item.url);
    if (act === 'open') {
      const target = isMusic ? musicUrl(item) : item.url;
      window.open(target, '_blank', 'noopener');
      return undefined;
    }
    b.disabled = true;
    try {
      const mode = act === 'audio' ? 'audio' : 'video';
      await queueDownload({ url: item.url, mode, audioFormat: mode === 'audio' ? 'mp3' : undefined, height: 'best', container: 'mp4', title: item.title });
      toast(mode === 'audio' ? 'Audio download added to the queue.' : 'Video download added to the queue.', { type: 'success', sound: false, timeout: 2600 });
      onQueued?.(item, mode);
      closeFn?.();
    } catch (err) {
      if (!err.cancelled) toast(err.message || 'Could not queue this download.', { type: 'error' });
    } finally {
      b.disabled = false;
    }
    return undefined;
  });
  dialog({
    title: isMusic ? 'Song' : 'Video',
    body,
    actions: [{ label: 'Close', value: null, variant: 'ghost' }],
    onOpen: (_modal, done) => { closeFn = () => done(null); },
  });
}

export function musicUrl(item) {
  const id = idOf(item);
  return id ? `https://music.youtube.com/watch?v=${encodeURIComponent(id)}` : item.url;
}

// ---------- clipboard ----------
export async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied', { type: 'success', timeout: 2000, sound: false });
    return true;
  } catch {
    toast(url, { type: 'info', title: 'Copy this link', timeout: 8000 });
    return false;
  }
}

/** Long-press (about 500 ms) on a card copies its link. Returns a cleanup function. */
export function longPressCopy(root) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const onDown = (e) => {
    const c = e.target.closest('[data-url]');
    if (!c || e.button > 0) return;
    startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      copyLink(c.dataset.url);
      if (navigator.vibrate) navigator.vibrate(12);
      root.dataset.suppressClick = '1';
      setTimeout(() => { delete root.dataset.suppressClick; }, 400);
    }, 500);
  };
  const onMove = (e) => { if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('pointerleave', cancel);
  return () => {
    cancel();
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', cancel);
    root.removeEventListener('pointercancel', cancel);
    root.removeEventListener('pointerleave', cancel);
  };
}

// ---------- library duplicates ----------
/** Ids of files already in the library, from the [id] part of each file name. Empty set when unavailable. */
export async function libraryIds() {
  try {
    const data = await api('/api/files');
    const ids = new Set();
    for (const f of data.files || []) {
      const m = String(f.name || '').match(/\[([A-Za-z0-9_-]{6,})\]/);
      if (m) ids.add(m[1]);
    }
    return ids;
  } catch {
    return new Set();
  }
}

/** Asks before queuing a video that is already in the library. Resolves true to go ahead. */
export async function confirmIfDuplicate(url, title) {
  const id = (String(url).match(/[?&]v=([A-Za-z0-9_-]{6,})/) || String(url).match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) || [])[1];
  if (!id) return true;
  const ids = await libraryIds();
  if (!ids.has(id)) return true;
  return confirmDialog({
    title: 'Already downloaded',
    message: `You already have this video${title ? ` (${title})` : ''}. Download again?`,
    ok: 'Download again',
  });
}

// ---------- queue summary ----------
/** Counts for the Music queue card, from the live jobs store. */
export function queueCounts() {
  const jobs = [...store.jobs.values()];
  const count = (...s) => jobs.filter((j) => s.includes(j.status)).length;
  return { downloading: count('downloading'), waiting: count('queued'), done: count('done') };
}

// ---------- batch ----------
/**
 * POST /api/download/batch. Resolves { queued, errors }. On 507 asks the person and retries with force: true.
 * Rejects with err.cancelled when they say no.
 */
export async function queueBatchCall(urls, options) {
  const send = (extra = {}) => api('/api/download/batch', { method: 'POST', body: { urls, options, ...extra } });
  try {
    return await send();
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
    return send({ force: true });
  }
}

export { fmtDuration, fmtViews };

// ---------- live updates ----------
export const AUTO_REFRESH_MS = 5 * 60_000;

/** "Updated 9:20 PM" for when the suggestions were built, in the phone's own time zone. */
export function updatedText(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `Updated ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** Calls refresh every 5 minutes while the app is open, and again when it comes back to the front after a while. */
export function autoRefresh(refresh) {
  let last = Date.now();
  const tick = () => { last = Date.now(); refresh(); };
  const timer = setInterval(() => { if (!document.hidden) tick(); }, AUTO_REFRESH_MS);
  const onVisible = () => { if (!document.hidden && Date.now() - last > AUTO_REFRESH_MS) tick(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}

/** Status text for the live header: Live · time, Updating…, Could not update, or what to install. */
export function liveStatus(data, state = 'ok') {
  const when = updatedText(data?.updatedAt);
  const last = when.replace('Updated ', '');
  if (state === 'loading') return { text: when ? `Updating… · ${when}` : 'Loading live results…', bad: false };
  if (state === 'error') return { text: last ? `Could not update · last ${last}` : 'Could not update', bad: true };
  if (data?.needsSetup) return { text: 'Install yt-dlp for live results', bad: false };
  return { text: when ? `● Live · ${when}` : '● Live', bad: false };
}

/** Sets the status line on an existing live header (used when refreshing in place). */
export function setLiveStatus(el, data, state = 'ok') {
  if (!el) return;
  const s = liveStatus(data, state);
  el.textContent = s.text;
  el.classList.toggle('bad', s.bad);
}

/** The header above every live shelf list: title, live status and Refresh. Always rendered, even while loading or failing. */
export function liveHeader(title, { refreshId, statusId, data, state = 'ok' }) {
  const s = liveStatus(data, state);
  return `<div class="shelves-head row between live-head">
      <div class="live-title"><h2 class="section-title">${title}</h2><span class="live-status${s.bad ? ' bad' : ''}" id="${statusId}" aria-live="polite">${s.text}</span></div>
      <button type="button" class="btn btn-sm btn-ghost" id="${refreshId}">${icon('refresh', 'sm')} Refresh</button>
    </div>`;
}
