// In-app music player. One <audio> element streams songs through /api/media (nothing is saved to disk).
// A mini bar sits above the bottom navigation; tapping it opens the full player. It keeps a queue, shuffle,
// repeat, speed and volume, shows lock-screen controls (Media Session), and remembers the queue between visits
// without starting playback.
import { esc, icon, api, getToken, toast } from './core.js';

const KEY = 'vidyra.player';
const RATES = [0.75, 1, 1.25, 1.5, 2];
const MAX_QUEUE = 200;

const audio = new Audio();
audio.preload = 'metadata';

const state = { queue: [], index: -1, shuffle: false, repeat: 'off', rate: 1, volume: 1 };
let meta = null;        // the song on screen
let pendingSeek = 0;    // seconds to jump to once a restored song has loaded
let loadToken = 0;      // the newest load wins; older responses are ignored
let skipTimer = null;
let lastSave = 0;
let seeking = false;
let mounted = false;
const ui = {};

const idOf = (it) => it?.id || (String(it?.url || '').match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1] || '';
const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));
const tokenQuery = () => { const t = getToken(); return t ? `?token=${encodeURIComponent(t)}` : ''; };
const thumbImg = (src) => (src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode?.classList.add('nothumb')">` : '');

function clock(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function normalize(it) {
  return {
    id: idOf(it),
    title: String(it?.title || 'Untitled').slice(0, 300),
    channel: String(it?.channel || it?.uploader || '').slice(0, 200),
    thumbnail: typeof it?.thumbnail === 'string' && it.thumbnail.startsWith('https://') ? it.thumbnail : '',
    duration: Number.isFinite(Number(it?.duration)) ? Number(it.duration) : null,
  };
}

// ---------- saving (per browser; never blocks playback) ----------
function save(force = false) {
  const now = Date.now();
  if (!force && now - lastSave < 4000) return;
  lastSave = now;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      queue: state.queue.map(({ id, title, channel, thumbnail, duration }) => ({ id, title, channel, thumbnail, duration })),
      index: state.index,
      time: Math.floor(audio.currentTime || 0),
      shuffle: state.shuffle,
      repeat: state.repeat,
      rate: state.rate,
      volume: state.volume,
    }));
  } catch { /* private window or blocked storage: the player still works */ }
}

function restore() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
  if (!saved || !Array.isArray(saved.queue)) return;
  state.queue = saved.queue.map(normalize).filter((x) => x.id).slice(0, MAX_QUEUE);
  if (!state.queue.length) return;
  state.index = Math.min(Math.max(0, Number(saved.index) || 0), state.queue.length - 1);
  state.shuffle = !!saved.shuffle;
  state.repeat = ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off';
  state.rate = RATES.includes(Number(saved.rate)) ? Number(saved.rate) : 1;
  state.volume = clamp01(Number(saved.volume));
  pendingSeek = Math.max(0, Number(saved.time) || 0);
  audio.volume = state.volume;
  audio.playbackRate = state.rate;
  paintMeta(state.queue[state.index], 'Tap play to resume');
  paintControls();
  showBar(true);
}

// ---------- building the UI ----------
function build() {
  const root = document.createElement('div');
  root.id = 'vPlayer';
  root.innerHTML = `
    <section class="mini-player" id="mpMini" aria-label="Music player" hidden>
      <button type="button" class="mp-open" data-mp="open" aria-label="Open the full player">
        <span class="mp-thumb nothumb" id="mpThumb"></span>
        <span class="mp-text"><b class="mp-title" id="mpTitle"></b><span class="mp-sub" id="mpSub"></span></span>
      </button>
      <button type="button" class="mp-btn" data-mp="toggle" aria-label="Play">${icon('play', 'sm')}</button>
      <button type="button" class="mp-btn" data-mp="close" aria-label="Close the player">${icon('x', 'sm')}</button>
    </section>
    <section class="full-player" id="mpFull" aria-label="Now playing" hidden>
      <div class="fp-top">
        <button type="button" class="mp-btn" data-mp="collapse" aria-label="Back to the app">${icon('chevron', 'sm')}</button>
        <span class="muted small">Now playing</span>
        <span class="fp-spacer" aria-hidden="true"></span>
      </div>
      <div class="fp-art nothumb" id="fpArt"></div>
      <div class="fp-meta"><b class="fp-title" id="fpTitle"></b><span class="muted small" id="fpSub"></span></div>
      <div class="fp-seek">
        <input type="range" id="fpSeek" min="0" max="0" step="0.1" value="0" aria-label="Seek" disabled>
        <div class="fp-times"><span id="fpCur">0:00</span><span id="fpDur">0:00</span></div>
      </div>
      <div class="fp-controls">
        <button type="button" class="fp-chip" data-mp="shuffle" id="fpShuffle" aria-pressed="false">Shuffle</button>
        <button type="button" class="mp-btn" data-mp="prev" aria-label="Previous song">${icon('back', 'sm')}</button>
        <button type="button" class="mp-btn mp-big" data-mp="toggle" id="fpToggle" aria-label="Play">${icon('play', 'sm')}</button>
        <button type="button" class="mp-btn" data-mp="next" aria-label="Next song"><span class="flip">${icon('back', 'sm')}</span></button>
        <button type="button" class="fp-chip" data-mp="repeat" id="fpRepeat" aria-pressed="false">Repeat off</button>
      </div>
      <div class="fp-foot">
        <label class="fp-speed">Speed
          <select id="fpRate" class="input">${RATES.map((r) => `<option value="${r}">${r}x</option>`).join('')}</select>
        </label>
        <label class="fp-vol">${icon('volume', 'sm')}<input type="range" id="fpVol" min="0" max="1" step="0.05" value="1" aria-label="Volume"></label>
      </div>
      <p class="fp-head small muted">Up next</p>
      <ol class="fp-queue" id="fpQueue"></ol>
    </section>`;
  document.body.appendChild(root);
  const $q = (sel) => root.querySelector(sel);
  Object.assign(ui, {
    root,
    mini: $q('#mpMini'), thumb: $q('#mpThumb'), title: $q('#mpTitle'), sub: $q('#mpSub'),
    toggle: root.querySelector('#mpMini [data-mp="toggle"]'),
    full: $q('#mpFull'), artSlot: $q('#fpArt'), fullTitle: $q('#fpTitle'), fullSub: $q('#fpSub'),
    fullToggle: $q('#fpToggle'), seek: $q('#fpSeek'), cur: $q('#fpCur'), dur: $q('#fpDur'),
    shuffle: $q('#fpShuffle'), repeat: $q('#fpRepeat'), rate: $q('#fpRate'), vol: $q('#fpVol'), queue: $q('#fpQueue'),
  });
  ui.vol.value = String(state.volume);
  audio.volume = state.volume;
}

// ---------- painting ----------
function paintMeta(item, status = '') {
  meta = item;
  ui.thumb.innerHTML = thumbImg(item.thumbnail);
  ui.thumb.classList.toggle('nothumb', !item.thumbnail);
  ui.title.textContent = item.title;
  ui.sub.textContent = status || item.channel || 'YouTube Music';
  ui.artSlot.innerHTML = thumbImg(item.thumbnail);
  ui.artSlot.classList.toggle('nothumb', !item.thumbnail);
  ui.fullTitle.textContent = item.title;
  ui.fullSub.textContent = status || item.channel || '';
  syncSession(item);
}

function paintPlaying() {
  const playing = !audio.paused && !audio.ended;
  for (const b of [ui.toggle, ui.fullToggle]) {
    b.innerHTML = icon(playing ? 'pause' : 'play', 'sm');
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  ui.mini.classList.toggle('is-playing', playing);
}

function paintTime() {
  const d = audio.duration;
  const hasD = Number.isFinite(d) && d > 0;
  ui.seek.disabled = !hasD;
  if (hasD) {
    ui.seek.max = String(d);
    if (!seeking) ui.seek.value = String(audio.currentTime || 0);
  }
  ui.cur.textContent = clock(audio.currentTime);
  ui.dur.textContent = hasD ? clock(d) : '0:00';
  if ('mediaSession' in navigator && hasD && navigator.mediaSession.setPositionState) {
    try {
      navigator.mediaSession.setPositionState({ duration: d, playbackRate: audio.playbackRate || 1, position: Math.min(audio.currentTime || 0, d) });
    } catch { /* not supported on this device */ }
  }
  save();
}

function paintControls() {
  ui.shuffle.setAttribute('aria-pressed', String(state.shuffle));
  ui.repeat.textContent = state.repeat === 'one' ? 'Repeat one' : state.repeat === 'all' ? 'Repeat all' : 'Repeat off';
  ui.repeat.setAttribute('aria-pressed', String(state.repeat !== 'off'));
  ui.rate.value = String(state.rate);
  ui.vol.value = String(state.volume);
  ui.queue.innerHTML = state.queue.map((it, i) => `
    <li><button type="button" class="fp-q${i === state.index ? ' on' : ''}" data-mp="jump" data-i="${i}" ${i === state.index ? 'aria-current="true"' : ''}>${esc(it.title)}</button></li>`).join('');
}

function showBar(on) {
  ui.mini.hidden = !on;
  document.body.classList.toggle('has-player', on);
  if (!on) ui.full.hidden = true;
  document.body.classList.toggle('player-open', on && !ui.full.hidden);
}

function showFull(on) {
  ui.full.hidden = !on;
  document.body.classList.toggle('player-open', on);
}

function syncSession(item) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.channel || 'YouTube Music',
      album: 'Vidyra',
      artwork: item.thumbnail ? [{ src: item.thumbnail, sizes: '480x360', type: 'image/jpeg' }] : [],
    });
  } catch { /* lock-screen details are optional */ }
}

function wireSession() {
  if (!('mediaSession' in navigator)) return;
  const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* action not supported */ } };
  on('play', () => audio.play().catch(() => {}));
  on('pause', () => audio.pause());
  on('previoustrack', () => prev());
  on('nexttrack', () => step(1));
  on('seekbackward', (d) => { audio.currentTime = Math.max(0, audio.currentTime - (d.seekOffset || 10)); });
  on('seekforward', (d) => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (d.seekOffset || 10)); });
  on('seekto', (d) => { if (Number.isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
}

// ---------- playback ----------
async function load(i, { autoplay = true, at = 0 } = {}) {
  const item = state.queue[i];
  if (!item) return;
  const token = ++loadToken;
  clearTimeout(skipTimer);
  state.index = i;
  pendingSeek = at;
  paintControls();
  paintMeta(item, 'Loading…');
  try {
    const info = await api(`/api/play?id=${encodeURIComponent(item.id)}`);
    if (token !== loadToken) return;
    audio.src = `${info.src}${tokenQuery()}`;
    audio.playbackRate = state.rate;
    audio.volume = state.volume;
    paintMeta({ ...item, title: info.title || item.title, channel: info.channel || item.channel, thumbnail: info.thumbnail || item.thumbnail, duration: info.duration ?? item.duration });
    if (autoplay) await audio.play().catch(() => { /* the browser held playback back; tap play */ });
    save(true);
  } catch (e) {
    if (token !== loadToken) return;
    audio.removeAttribute('src');
    audio.load();
    paintMeta(item, 'Could not play this song');
    paintPlaying();
    toast(e.message || 'This song could not be played.', { type: 'error', title: 'Could not play this song' });
    if (autoplay) scheduleSkip(token);
    save(true);
  }
}

function scheduleSkip(token) {
  clearTimeout(skipTimer);
  skipTimer = setTimeout(() => {
    if (token === loadToken && state.queue.length > 1) step(1);
  }, 2000);
}

/** Moves to the next (dir 1) or previous (dir -1) song. Returns false at the end of the queue. */
function step(dir) {
  const n = state.queue.length;
  if (!n) return false;
  let next;
  if (state.shuffle && n > 1) {
    do { next = Math.floor(Math.random() * n); } while (next === state.index);
  } else {
    next = state.index + dir;
  }
  if (next < 0 || next >= n) {
    if (state.repeat !== 'all') return false;
    next = (next + n) % n;
  }
  load(next, { autoplay: true, at: 0 });
  return true;
}

function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (!step(-1)) audio.currentTime = 0;
}

function togglePlay() {
  if (!state.queue.length) return;
  if (!audio.getAttribute('src')) { load(Math.max(0, state.index), { autoplay: true, at: pendingSeek }); return; }
  if (audio.paused) {
    audio.play().catch(() => toast('Tap play again to start the song.', { type: 'info', timeout: 2600 }));
  } else {
    audio.pause();
  }
}

/** Plays a list of songs from the given position. Called by the music screens when a song is tapped. */
export function playSong(items, index = 0) {
  const list = (items || []).map(normalize).filter((x) => x.id);
  if (!list.length) return;
  const wanted = idOf(items[index]);
  const at = Math.max(0, list.findIndex((x) => x.id === wanted));
  state.queue = list.slice(0, MAX_QUEUE);
  showBar(true);
  load(Math.min(at, state.queue.length - 1), { autoplay: true, at: 0 });
}

function stopAndClear() {
  clearTimeout(skipTimer);
  loadToken++;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.queue = [];
  state.index = -1;
  meta = null;
  pendingSeek = 0;
  showFull(false);
  showBar(false);
  paintControls();
  save(true);
}

// ---------- events ----------
function wire() {
  audio.addEventListener('play', paintPlaying);
  audio.addEventListener('pause', () => { paintPlaying(); save(true); });
  audio.addEventListener('waiting', () => { if (meta) ui.sub.textContent = 'Buffering…'; });
  audio.addEventListener('playing', () => { if (meta) ui.sub.textContent = meta.channel || 'YouTube Music'; });
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek > 0 && Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(pendingSeek, Math.max(0, audio.duration - 1));
    }
    pendingSeek = 0;
    paintTime();
  });
  audio.addEventListener('durationchange', paintTime);
  audio.addEventListener('timeupdate', paintTime);
  audio.addEventListener('ended', () => {
    if (state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (!step(1)) { paintPlaying(); save(true); }
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    paintPlaying();
    toast('This song stopped playing. Skipping to the next one.', { type: 'error', title: 'Playback stopped' });
    scheduleSkip(loadToken);
  });

  ui.root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mp]');
    if (!b) return;
    switch (b.dataset.mp) {
      case 'open': showFull(true); break;
      case 'collapse': showFull(false); break;
      case 'close': stopAndClear(); break;
      case 'toggle': togglePlay(); break;
      case 'prev': prev(); break;
      case 'next': step(1); break;
      case 'shuffle': state.shuffle = !state.shuffle; paintControls(); save(true); break;
      case 'repeat':
        state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
        paintControls(); save(true); break;
      case 'jump': load(Number(b.dataset.i), { autoplay: true, at: 0 }); break;
      default: break;
    }
  });

  ui.seek.addEventListener('input', () => {
    seeking = true;
    ui.cur.textContent = clock(Number(ui.seek.value));
  });
  ui.seek.addEventListener('change', () => {
    seeking = false;
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(ui.seek.value);
  });
  ui.rate.addEventListener('change', () => {
    const r = Number(ui.rate.value);
    state.rate = RATES.includes(r) ? r : 1;
    audio.playbackRate = state.rate;
    save(true);
  });
  ui.vol.addEventListener('input', () => {
    state.volume = clamp01(Number(ui.vol.value));
    audio.volume = state.volume;
    save();
  });

  // Space plays or pauses, unless the player is not the thing being used (a field, a button, a dialog).
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!state.queue.length) return;
    if (e.target.closest?.('input, textarea, select, button, a, [contenteditable], .modal, dialog')) return;
    e.preventDefault();
    togglePlay();
  });

  window.addEventListener('pagehide', () => save(true));
  wireSession();
}

/** Builds the player once, and restores the last queue without starting playback. */
export function mountPlayer() {
  if (mounted) return;
  mounted = true;
  build();
  wire();
  restore();
}
