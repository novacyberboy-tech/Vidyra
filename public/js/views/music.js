// Music tab: a YouTube Music style home. A search bar, a live queue card, "Recently downloaded", then horizontal
// shelves from /api/suggestions?kind=music. Search results stream in from /api/search?kind=music. Tapping a song
// opens a sheet to download audio or video, copy the link or open it on YouTube Music.
import {
  $, esc, icon, fmtDuration, fmtViews, toast, streamSearch, enterItems, on,
} from '../core.js';
import {
  recentMusic, rememberMusic, loadSuggestions, skeletonShelves, notesFor, shelf, openItemSheet,
  longPressCopy, queueCounts,
} from './home-shared.js';
import { autoRefresh, liveHeader, setLiveStatus } from './home-shared.js';
import { playSong } from '../music-player.js';

const PAGE = 15;   // songs on the first page
const STEP = 20;   // songs added each time the list reaches its end
const MAX_SONGS = 200;

export function mount(root, ctx) {
  let controller = null;
  let moreObserver = null;
  let query = '';
  let limit = PAGE;
  let searchItems = [];
  let lastData = null;
  const known = new Map(); // url -> item, for every card on screen

  root.innerHTML = `
    <section class="card" aria-label="Music search">
      <form id="mForm" class="input-row" autocomplete="off" role="search">
        <div class="input-wrap">
          ${icon('music')}
          <input id="mQ" type="search" placeholder="Search songs, artists, albums" maxlength="200" aria-label="Search songs, artists, albums" enterkeyhint="search">
        </div>
        <button class="btn btn-primary" type="submit">${icon('search', 'sm')}<span>Search</span></button>
      </form>
      <p class="music-note small subtle">Music comes from YouTube Music through yt-dlp. For personal use; follow YouTube's terms.</p>
    </section>
    <div id="mQueue" class="queue-card" aria-live="polite"></div>
    <div id="mStatus" aria-live="polite"></div>
    <section class="list" id="mList" aria-label="Music results" hidden></section>
    <div id="mMore" style="text-align:center"></div>
    <div id="mShelves" class="stack" aria-label="Music shelves"></div>`;

  const input = $('#mQ', root);
  const list = $('#mList', root);
  const status = $('#mStatus', root);
  const more = $('#mMore', root);
  const shelves = $('#mShelves', root);
  const queueBox = $('#mQueue', root);

  const setStatus = (html) => { status.innerHTML = html; };

  // ---------- queue card (Feature 5) ----------
  function paintQueue() {
    const c = queueCounts();
    queueBox.innerHTML = `
      <div class="queue-line">
        <span class="badge badge-downloading"><span class="dot"></span>Downloading ${c.downloading}</span>
        <span class="badge badge-queued">Waiting ${c.waiting}</span>
        <span class="badge badge-done">Done ${c.done}</span>
        <a class="btn btn-sm btn-ghost queue-link" href="#/queue">Queue</a>
      </div>`;
  }
  const offJobs = on('jobs', paintQueue);
  paintQueue();

  /** After each page: a sentinel loads the next page when it scrolls into view, until the search runs out. */
  function afterPage(want, got) {
    moreObserver?.disconnect();
    if (got > 0 && searchItems.length >= want && want < MAX_SONGS) {
      more.innerHTML = '<div id="mSentinel" style="height:1px" aria-hidden="true"></div>';
      const sentinel = $('#mSentinel', root);
      if (sentinel && 'IntersectionObserver' in window) {
        moreObserver = new IntersectionObserver((entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            moreObserver?.disconnect();
            run(query, Math.min(MAX_SONGS, want + STEP), true);
          }
        }, { rootMargin: '400px 0px' });
        moreObserver.observe(sentinel);
      }
    } else {
      more.innerHTML = searchItems.length ? '<p class="muted small" style="padding:12px 0">That is all for this search.</p>' : '';
    }
  }

  /** Plays a song in the app. The queue is the list the song came from (search results or its shelf). */
  function playFrom(url) {
    const at = (list) => list.findIndex((x) => x.url === url);
    const i = at(searchItems);
    if (i >= 0) return playSong(searchItems, i);
    for (const s of lastData?.sections || []) {
      const j = at(s.items || []);
      if (j >= 0) return playSong(s.items, j);
    }
    const rec = recentMusic();
    const r = at(rec);
    if (r >= 0) return playSong(rec, r);
    const item = known.get(url);
    return item ? playSong([item], 0) : undefined;
  }

  // ---------- row for a search result ----------
  function row(item, i) {
    known.set(item.url, item);
    const meta = [item.channel || item.uploader, fmtDuration(item.duration), fmtViews(item.view_count)].filter(Boolean).join(' · ');
    return `
      <div class="li music-row" role="listitem" data-url="${esc(item.url)}" data-id="${esc(item.id)}" style="--i:${Math.min(i, 12)}">
        <button type="button" class="li-thumb thumb sq ${item.thumbnail ? '' : 'nothumb'}" data-play aria-label="Play ${esc(item.title)} in the app">
          ${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode?.classList.add('nothumb')">` : ''}
          <span class="round-play" aria-hidden="true">${icon('play', 'sm')}</span>
        </button>
        <div class="li-body" data-play>
          <div class="li-title" title="${esc(item.title)}">${esc(item.title || 'Untitled')}</div>
          <div class="li-sub">${esc(meta || '')}</div>
        </div>
        <button type="button" class="btn btn-icon btn-sm btn-ghost" data-open aria-label="More options for ${esc(item.title)}" title="Download and more">${icon('download', 'sm')}</button>
      </div>`;
  }

  function skeletons(n = 6) {
    list.innerHTML = Array.from({ length: n }, () => `
      <div class="li" aria-hidden="true">
        <div class="li-thumb thumb sq skel"></div>
        <div class="li-body" style="display:grid;gap:8px"><div class="skel" style="height:14px;width:85%"></div><div class="skel" style="height:11px;width:50%"></div></div>
      </div>`).join('');
  }

  // ---------- search (streamed) ----------
  async function run(q, want, append) {
    controller?.abort();
    controller = new AbortController();
    moreObserver?.disconnect();
    query = q;
    limit = want;
    list.hidden = false;
    if (!append) {
      searchItems = [];
      skeletons();
      setStatus('');
      more.innerHTML = '';
      shelves.hidden = true;
    } else {
      more.innerHTML = '<p class="muted small" role="status">Loading more songs…</p>';
    }
    let got = 0;
    try {
      await streamSearch(q, {
        kind: 'music',
        limit: want,
        signal: controller.signal,
        onItem: (item) => {
          if (searchItems.some((x) => x.id === item.id)) return;
          searchItems.push(item);
          got += 1;
          if (searchItems.length === 1 && !append) list.innerHTML = '';
          if (searchItems.length === 1) setStatus('');
          list.insertAdjacentHTML('beforeend', row(item, searchItems.length - 1));
        },
        onDone: (info) => {
          if (!searchItems.length && !append) {
            list.innerHTML = '';
            setStatus(`
              <div class="card empty enter">
                <div class="badge-ring">${icon(info?.timedOut ? 'alert' : 'audio')}</div>
                <h3>${info?.timedOut ? 'The search timed out' : 'No songs found'}</h3>
                <p>${info?.timedOut ? 'Check your connection and try again.' : `Nothing matched “${esc(q)}”. Try other words.`}</p>
              </div>`);
          }
        },
      });
      afterPage(want, got);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (!searchItems.length) {
        list.innerHTML = '';
        setStatus(`
          <div class="notice bad enter" role="alert">
            ${icon('alert')}
            <div><b>Search could not finish</b><span class="muted">${esc(e.message)}</span>
              <div style="margin-top:6px"><button class="btn btn-sm" type="button" id="mRetry">${icon('refresh', 'sm')} Try again</button></div>
            </div>
          </div>`);
      } else {
        more.innerHTML = '<button type="button" class="btn btn-sm" id="mMoreRetry">Try again</button>';
        toast(e.message, { type: 'error', title: 'Some songs could not load' });
      }
    }
  }

  /** Leaves search and shows the home shelves again. */
  function clearSearch() {
    controller?.abort();
    moreObserver?.disconnect();
    searchItems = [];
    list.innerHTML = '';
    list.hidden = true;
    setStatus('');
    more.innerHTML = '';
    shelves.hidden = false;
  }

  function submit() {
    const q = input.value.trim();
    if (!q) { clearSearch(); return; }
    run(q, PAGE, false);
  }

  // ---------- shelves (suggestions + recents) ----------
  function paintShelves(data) {
    lastData = data;
    const recent = recentMusic();
    const recentSection = recent.length ? { id: 'recent', title: 'Recently downloaded', items: recent } : null;
    recent.forEach((it) => known.set(it.url, it));
    const sections = [recentSection, ...(data?.sections || [])].filter(Boolean);
    (data?.sections || []).forEach((s) => (s.items || []).forEach((it) => known.set(it.url, it)));
    shelves.innerHTML = `
      ${liveHeader('Music for you', { refreshId: 'mRefresh', statusId: 'mUpdated', data })}
      ${notesFor(data)}
      ${sections.map((s) => shelf(s, 'music')).join('')}`;
    enterItems(shelves, '.hcard', 10);
  }

  async function loadShelves(fresh = false) {
    const status = $('#mUpdated', root);
    if (lastData && status) setLiveStatus(status, lastData, 'loading');
    else shelves.innerHTML = liveHeader('Music for you', { refreshId: 'mRefresh', statusId: 'mUpdated', state: 'loading' }) + skeletonShelves('music', 2);
    try {
      const data = await loadSuggestions('music', { fresh, signal: controller?.signal });
      paintShelves(data);
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.status === 503) { paintShelves({ needsSetup: true, sections: [] }); return; }
      if (lastData && $('#mUpdated', root)) { setLiveStatus($('#mUpdated', root), lastData, 'error'); return; }
      shelves.innerHTML = liveHeader('Music for you', { refreshId: 'mRefresh', statusId: 'mUpdated', state: 'error' }) + `
        <div class="notice bad enter" role="alert">${icon('alert')}
          <div><b>Suggestions could not load</b><span class="muted">${esc(e.message)}</span>
            <div style="margin-top:6px"><button class="btn btn-sm" type="button" id="mShelfRetry">${icon('refresh', 'sm')} Try again</button></div>
          </div>
        </div>`;
    }
  }

  // ---------- events ----------
  function onQueued(item) {
    rememberMusic(item); // Feature 1: recently downloaded shelf
    if (lastData) paintShelves(lastData);
  }

  const onClick = (e) => {
    if (root.dataset.suppressClick) return;
    if (e.target.closest('#mRetry')) return run(query, limit, false);
    if (e.target.closest('#mRefresh') || e.target.closest('#mShelfRetry')) return loadShelves(true);
    const shuffle = e.target.closest('[data-shuffle]');
    if (shuffle) {
      const id = shuffle.dataset.shuffle;
      const pool = id === 'recent' ? recentMusic() : (lastData?.sections || []).find((s) => s.id === id)?.items || [];
      if (!pool.length) return undefined;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return openItemSheet(known.get(pick.url) || pick, 'music', { onQueued, onPlay: (it) => playFrom(it.url) });
    }
    const playCard = e.target.closest('[data-play]')?.closest('[data-url]');
    if (playCard) return playFrom(playCard.dataset.url);
    if (e.target.closest('#mMoreRetry')) return run(query, limit, true);
    const open = e.target.closest('[data-open]');
    const cardEl = e.target.closest('[data-url]');
    if (open && cardEl) {
      const item = known.get(cardEl.dataset.url);
      if (item) return openItemSheet(item, 'music', { onQueued, onPlay: (it) => playFrom(it.url) });
    }
    return undefined;
  };

  // Feature 7: "/" focuses the music search from anywhere on this screen. Capture phase, so the global
  // handler in app.js (which would open the Search tab) does not also run.
  const onSlash = (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    input.focus();
  };
  window.addEventListener('keydown', onSlash, true);

  const offLongPress = longPressCopy(root); // Feature 8
  root.addEventListener('click', onClick);
  $('#mForm', root).addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('input', () => { if (!input.value.trim()) clearSearch(); });
  input.focus();

  loadShelves(false);
  const stopAuto = autoRefresh(() => { if (!shelves.hidden) loadShelves(true); });

  return () => {
    controller?.abort();
    moreObserver?.disconnect();
    offJobs();
    stopAuto();
    offLongPress();
    window.removeEventListener('keydown', onSlash, true);
    root.removeEventListener('click', onClick);
  };
}

