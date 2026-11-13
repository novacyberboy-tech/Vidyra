// Search tab: YouTube results stream in as yt-dlp finds them (no long blank spinner), with a
// retry path, automatic infinite scroll, and links that open other sites' own search pages.
import { $, esc, icon, api, fmtDuration, fmtViews, toast, fileUrl, dialog, askToken, queueDownload } from '../core.js';
import { fire } from '../fx.js';
import {
  loadSuggestions, skeletonShelves, notesFor, shelf, togglePin, confirmIfDuplicate, longPressCopy,
} from './home-shared.js';
import { autoRefresh, liveHeader, setLiveStatus } from './home-shared.js';

const ENGINES = [
  { id: 'youtube', label: 'YouTube', live: true },
  { id: 'instagram', label: 'Instagram', url: (q) => `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}` },
  { id: 'tiktok', label: 'TikTok', url: (q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}` },
  { id: 'x', label: 'X', url: (q) => `https://x.com/search?q=${encodeURIComponent(q)}` },
  { id: 'facebook', label: 'Facebook', url: (q) => `https://www.facebook.com/search/videos/?q=${encodeURIComponent(q)}` },
  { id: 'google', label: 'Google Videos', url: (q) => `https://www.google.com/search?tbm=vid&q=${encodeURIComponent(q)}` },
];
// Category tiles on the Explore landing (the YouTube home screen). Each one runs a normal streamed search.
const EXPLORE = [
  { label: 'Music', q: 'music videos', ic: 'audio' },
  { label: 'Gaming', q: 'gaming highlights', ic: 'video' },
  { label: 'News', q: 'news today', ic: 'globe' },
  { label: 'Technology', q: 'technology reviews', ic: 'cpu' },
  { label: 'Education', q: 'educational lectures', ic: 'library' },
  { label: 'Science', q: 'science explained', ic: 'sparkles' },
  { label: 'Sports', q: 'sports highlights', ic: 'zap' },
  { label: 'Travel', q: 'travel vlog', ic: 'globe' },
  { label: 'Cooking', q: 'cooking recipes', ic: 'sparkles' },
  { label: 'Fitness', q: 'home workout', ic: 'zap' },
  { label: 'Comedy', q: 'stand up comedy', ic: 'video' },
  { label: 'Movies', q: 'movie trailers', ic: 'play' },
  { label: 'Podcasts', q: 'podcast clips', ic: 'audio' },
  { label: 'DIY', q: 'DIY projects', ic: 'cpu' },
  { label: 'Nature', q: 'nature documentary', ic: 'globe' },
  { label: 'History', q: 'history documentary', ic: 'library' },
];
const PAGE = 12;
const MAX = 2000;
const SLOW_HINT_MS = 12000;

export function mount(root, ctx) {
  let engine = 'youtube';
  let query = '';
  let limit = PAGE;
  let items = new Map();
  let controller = null;
  let slowTimer = null;
  let sortMode = 'relevance';
  let durationFilter = 'all';
  let favoritesOnly = false;
  const selected = new Set();
  const readStore = (key) => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  let favorites = readStore('vidyra.favorites');
  let history = readStore('vidyra.searchHistory');

  root.innerHTML = `
    <section class="card" aria-label="Search">
      <form id="sForm" class="input-row" autocomplete="off" role="search">
        <div class="input-wrap">
          ${icon('search')}
          <input id="sQ" type="search" placeholder="Search videos…" maxlength="200" aria-label="Search query" enterkeyhint="search">
        </div>
        <button class="btn btn-primary" type="submit" id="sBtn">${icon('search', 'sm')}<span>Search</span></button>
      </form>
      <div class="chips hscroll" role="group" aria-label="Search engine" id="engines" style="margin-top:14px">
        ${ENGINES.map((e) => `<button type="button" class="chip" data-engine="${e.id}" aria-pressed="${e.id === engine}">${esc(e.label)}${e.live ? '' : icon('external', 'sm')}</button>`).join('')}
      </div>
    </section>
    <div id="vShelves" class="stack" aria-label="YouTube suggestions"></div>
    <section id="explore" class="stack" aria-label="Explore YouTube">
      <h2 class="section-title">Explore YouTube</h2>
      <div class="grid explore-grid">
        ${EXPLORE.map((e) => `<button type="button" class="tile" data-explore="${esc(e.q)}">
          <span class="fi">${icon(e.ic)}</span><span>${esc(e.label)}</span></button>`).join('')}
      </div>
    </section>
    <div class="engine-note" id="engineNote">${icon('info')}<span>YouTube results appear right here. Other sites open their own search in a new tab; copy a video link from there and paste it on the Download tab.</span></div>
    <section class="card stack" id="searchTools" aria-label="Search tools" hidden>
      <div class="toolbar" style="align-items:center">
        <label class="small muted" for="sortResults">Sort</label>
        <select id="sortResults" class="input" style="max-width:180px"><option value="relevance">Relevance</option><option value="views">Most viewed</option><option value="longest">Longest first</option><option value="shortest">Shortest first</option><option value="title">Title A–Z</option></select>
        <label class="small muted" for="durationFilter">Duration</label>
        <select id="durationFilter" class="input" style="max-width:160px"><option value="all">Any length</option><option value="short">Under 4 min</option><option value="medium">4–20 min</option><option value="long">Over 20 min</option></select>
      </div>
      <div class="toolbar" style="align-items:center;flex-wrap:wrap">
        <button class="btn btn-sm" id="favoritesOnly" type="button" aria-pressed="false">${icon('star','sm')} Saved videos</button>
        <button class="btn btn-sm btn-primary" id="downloadSelected" type="button">${icon('download','sm')} Download selected</button>
        <button class="btn btn-sm" id="copySelected" type="button">${icon('copy','sm')} Copy links</button>
        <button class="btn btn-sm btn-ghost" id="clearSelection" type="button">Clear</button>
        <span class="muted small" id="resultCount" aria-live="polite"></span>
      </div>
    </section>
    <section class="card stack" id="historyPanel" aria-label="Recent searches" hidden><div class="row between"><b>Recent searches</b><button class="btn btn-ghost btn-sm" id="clearHistory" type="button">Clear history</button></div><div class="chips hscroll" id="historyChips"></div></section>
    <div id="sStatus" aria-live="polite"></div>
    <div class="grid" id="sGrid" role="list" aria-label="Search results"></div>
    <div id="sMore" style="text-align:center"></div>`;

  const input = $('#sQ', root);
  const grid = $('#sGrid', root);
  const status = $('#sStatus', root);
  const more = $('#sMore', root);
  const note = $('#engineNote', root);
  const explore = $('#explore', root);
  const toolsPanel = $('#searchTools', root);
  const historyPanel = $('#historyPanel', root);
  let loadingMore = false;
  let moreObserver = null;

  const setStatus = (html) => { status.innerHTML = html; };

  function skeletons(n = 6) {
    grid.innerHTML = Array.from({ length: n }, (_, i) => `
      <div class="vcard enter" style="--i:${i}" aria-hidden="true">
        <div class="skel" style="aspect-ratio:16/9;border-radius:0"></div>
        <div style="padding:14px;display:grid;gap:10px">
          <div class="skel" style="height:16px;width:90%"></div>
          <div class="skel" style="height:12px;width:55%"></div>
          <div class="skel" style="height:36px;width:100%;margin-top:6px"></div>
        </div>
      </div>`).join('');
  }

  function card(item, i) {
    const isSaved = favorites.some((v) => v.id === item.id);
    const isSelected = selected.has(item.id);
    const dur = fmtDuration(item.duration);
    const meta = [item.uploader, fmtViews(item.view_count)].filter(Boolean).join(' · ');
    return `
      <article class="vcard enter" style="--i:${Math.min(i, 12)}" role="listitem" data-id="${esc(item.id)}" data-url="${esc(item.url)}">
        <button class="thumb ${item.thumbnail ? '' : 'nothumb'}" type="button" data-watch="${esc(item.id)}" aria-label="Play ${esc(item.title)}">
          ${item.thumbnail ? `<img src="${esc(item.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode?.classList.add('nothumb')">` : ''}
          ${dur ? `<span class="dur">${dur}</span>` : ''}
          <span class="thumb-play" aria-hidden="true">${icon('play')}</span>
        </button>
        <div class="vbody">
          <h3 class="clamp-2" title="${esc(item.title)}"><button class="video-title-link" type="button" data-watch="${esc(item.id)}">${esc(item.title)}</button></h3>
          <p class="vmeta truncate">${esc(meta)}</p>
          <div class="vactions">
            <button class="btn btn-primary btn-sm" type="button" data-use="${esc(item.url)}">${icon('download', 'sm')}<span>Download</span></button>
            <button class="btn btn-sm" type="button" data-audio="${esc(item.url)}" title="Download audio only">${icon('audio', 'sm')}<span>Audio</span></button>
            <button class="btn btn-ghost btn-sm btn-icon" type="button" data-favorite="${esc(item.id)}" aria-label="${isSaved ? 'Remove saved video' : 'Save video'}" aria-pressed="${isSaved}" title="${isSaved ? 'Saved' : 'Save video'}">${icon('star', 'sm')}</button>
            <button class="btn btn-ghost btn-sm btn-icon" type="button" data-share="${esc(item.url)}" aria-label="Share video" title="Share">${icon('share', 'sm')}</button>
            <button class="btn btn-ghost btn-sm btn-icon" type="button" data-copy="${esc(item.url)}" aria-label="Copy link" title="Copy link">${icon('copy', 'sm')}</button>
            <label class="small muted" title="Select for bulk actions"><input type="checkbox" data-select="${esc(item.id)}" ${isSelected ? 'checked' : ''}> Select</label>
          </div>
        </div>
      </article>`;
  }

  async function openVideo(item) {
    if (!item) return;
    const id = String(item.id || '');
    const youtubeId = /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
    const body = document.createElement('div');
    body.className = 'watch-view';
    const player = document.createElement('div');
    player.className = 'watch-player';
    if (youtubeId) {
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0&playsinline=1`;
      frame.title = item.title || 'Video player';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      player.append(frame);
    } else {
      player.innerHTML = `<div class="notice info">${icon('info')}<div><b>Open this video on its source</b><span class="muted">This source does not provide an embeddable YouTube player.</span></div></div>`;
    }
    const details = document.createElement('div');
    details.className = 'watch-details';
    details.innerHTML = `<h3>${esc(item.title || 'Untitled video')}</h3><p class="muted small">${esc(item.uploader || 'YouTube')} · ${esc(fmtViews(item.view_count))}${item.duration ? ` · ${esc(fmtDuration(item.duration))}` : ''}</p><p class="muted small">Playback is provided by the original YouTube embed player. Some videos may restrict embedding.</p>`;
    const actions = document.createElement('div');
    actions.className = 'watch-actions';
    const download = document.createElement('button');
    download.type = 'button'; download.className = 'btn btn-primary';
    download.innerHTML = `${icon('download','sm')} Download`;
    download.addEventListener('click', () => { ctx.setPendingUrl(item.url); location.hash = '#/download'; });
    actions.append(download);
    if (item.url) {
      const source = document.createElement('a'); source.className = 'btn btn-ghost'; source.href = item.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.textContent = 'Open on YouTube'; actions.append(source);
    }
    body.append(player, details, actions);
    dialog({ title: 'Now playing', body, wide: true, actions: [{ label: 'Close', value: true }] });
  }

  function saveHistory(q) {
    history = [q, ...history.filter((v) => v.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    try { localStorage.setItem('vidyra.searchHistory', JSON.stringify(history)); } catch {}
    renderHistory();
  }

  function renderHistory() {
    historyPanel.hidden = !history.length;
    $('#historyChips', root).innerHTML = history.map((q) => `<button class="chip" type="button" data-history="${esc(q)}">${esc(q)}</button>`).join('');
  }

  function renderGrid() {
    const all = [...items.values()];
    let shown = all.filter((item) => {
      const d = Number(item.duration || 0);
      if (favoritesOnly && !favorites.some((v) => v.id === item.id)) return false;
      if (durationFilter === 'short' && (!d || d >= 240)) return false;
      if (durationFilter === 'medium' && (d < 240 || d > 1200)) return false;
      if (durationFilter === 'long' && d <= 1200) return false;
      return true;
    });
    if (sortMode === 'views') shown.sort((a,b) => (b.view_count || 0) - (a.view_count || 0));
    if (sortMode === 'longest') shown.sort((a,b) => (b.duration || 0) - (a.duration || 0));
    if (sortMode === 'shortest') shown.sort((a,b) => (a.duration || 1e12) - (b.duration || 1e12));
    if (sortMode === 'title') shown.sort((a,b) => String(a.title).localeCompare(String(b.title)));
    grid.innerHTML = shown.map((item, i) => card(item, i)).join('');
    $('#resultCount', root).textContent = `${shown.length} shown · ${all.length} loaded`;
    if (!shown.length && all.length) setStatus('<p class="muted small">No videos match these filters. Try another duration or turn off Saved videos.</p>');
    else if (shown.length) setStatus('');
  }

  function showEmpty(title, text, cta = '') {
    setStatus(`
      <div class="card empty enter">
        <div class="badge-ring">${icon('search')}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${cta}
      </div>`);
  }

  function showError(message) {
    grid.innerHTML = '';
    setStatus(`
      <div class="notice bad enter" role="alert">
        ${icon('alert')}
        <div><b>Search could not finish</b><span class="muted">${esc(message)}</span>
          <div style="margin-top:6px"><button class="btn btn-sm" type="button" id="retryBtn">${icon('refresh', 'sm')} Try again</button></div>
        </div>
      </div>`);
    $('#retryBtn', root)?.addEventListener('click', () => run(query, limit, false));
  }

  // ---------- YouTube home shelves (shown while the search box is empty) ----------
  const vShelves = $('#vShelves', root);
  const shelfKnown = new Map(); // url -> suggestion item, so taps and pins find the item behind a card

  let lastVideoData = null;
  function paintVideoShelves(data) {
    lastVideoData = data;
    const sections = data?.sections || [];
    sections.forEach((s) => (s.items || []).forEach((it) => shelfKnown.set(it.url, it)));
    vShelves.innerHTML = `
      ${liveHeader('Suggested for you', { refreshId: 'vRefresh', statusId: 'vUpdated', data })}
      ${notesFor(data)}
      ${sections.map((s) => shelf(s, 'video')).join('')}`;
  }

  async function loadVideoShelves(fresh = false) {
    if (!vShelves) return;
    vShelves.hidden = false;
    const status = $('#vUpdated', root);
    if (lastVideoData && status) setLiveStatus(status, lastVideoData, 'loading');
    else vShelves.innerHTML = liveHeader('Suggested for you', { refreshId: 'vRefresh', statusId: 'vUpdated', state: 'loading' }) + skeletonShelves('video', 2);
    try {
      paintVideoShelves(await loadSuggestions('video', { fresh }));
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.status === 503) { paintVideoShelves({ needsSetup: true, sections: [] }); return; }
      if (lastVideoData && $('#vUpdated', root)) { setLiveStatus($('#vUpdated', root), lastVideoData, 'error'); return; }
      vShelves.innerHTML = liveHeader('Suggested for you', { refreshId: 'vRefresh', statusId: 'vUpdated', state: 'error' }) + `
        <div class="notice bad enter" role="alert">${icon('alert')}
          <div><b>Suggestions could not load</b><span class="muted">${esc(e.message)}</span>
            <div style="margin-top:6px"><button class="btn btn-sm" type="button" id="vShelfRetry">${icon('refresh', 'sm')} Try again</button></div>
          </div>
        </div>`;
    }
  }

  function openShelfItem(url) {
    const it = shelfKnown.get(url);
    if (!it) return;
    openVideo({ ...it, uploader: it.channel, view_count: it.views });
  }

  function shuffleShelf(id) {
    const section = [...(vShelves.querySelectorAll('[data-section]'))].find((el) => el.dataset.section === id);
    const urls = section ? [...section.querySelectorAll('[data-url]')].map((el) => el.dataset.url) : [];
    if (!urls.length) return;
    openShelfItem(urls[Math.floor(Math.random() * urls.length)]);
  }

  function resetStreamUi() {
    clearTimeout(slowTimer);
    more.innerHTML = '';
    setStatus('');
  }

  async function run(q, want, append) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    query = q;
    limit = want;
    if (!append) { saveHistory(q); selected.clear(); favoritesOnly = false; $('#favoritesOnly', root).setAttribute('aria-pressed', 'false'); toolsPanel.hidden = false; }
    const existing = append ? items.size : 0;
    if (!append) {
      items = new Map();
      grid.innerHTML = '';
      resetStreamUi();
      skeletons();
    } else {
      loadingMore = true;
      more.innerHTML = `<p class="muted small" role="status">Loading more results…</p>`;
    }
    const slow = () => setStatus(`<p class="muted small enter" style="text-align:center">Still searching. YouTube can be slow on mobile networks.</p>`);
    slowTimer = setTimeout(slow, SLOW_HINT_MS);

    let gotAny = existing > 0;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=${want}`, {
        signal,
        headers: { 'x-token': localStorage.getItem('vidyra.token') || '' },
      });
      if (res.status === 401) {
        if (await askToken()) return run(q, want, append);
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
      let fresh = 0;
      let timedOut = false;
      if (!append) grid.innerHTML = '';
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
          if (msg.type === 'item') {
            if (items.has(msg.item.id)) continue;
            const pos = items.size;
            items.set(msg.item.id, msg.item);
            fresh++;
            if (!gotAny) { gotAny = true; setStatus(''); }
            if (!favoritesOnly && durationFilter === 'all' && sortMode === 'relevance') grid.insertAdjacentHTML('beforeend', card(msg.item, pos));
          } else if (msg.type === 'error') {
            throw new Error(msg.message);
          } else if (msg.type === 'done') {
            finished = true;
            timedOut = Boolean(msg.timedOut);
          }
        }
      }
      clearTimeout(slowTimer);
      if (!items.size) {
        if (timedOut) showError('YouTube did not answer in time. Check your connection and try again.');
        else showEmpty('No results', `Nothing matched “${q}”. Try different words.`);
        return;
      }
      if (timedOut) toast('Showing the results found before the search timed out.', { type: 'info', timeout: 5000 });
      if (sortMode !== 'relevance' || durationFilter !== 'all' || favoritesOnly) renderGrid();
      loadingMore = false;
      const canMore = items.size >= want && want < MAX && fresh > 0;
      more.innerHTML = canMore
        ? '<div id="sMoreSentinel" style="height:1px" aria-hidden="true"></div>'
        : (items.size >= MAX ? '<p class="subtle small">Showing the top results. Refine your search for more.</p>' : '');
      moreObserver?.disconnect();
      const sentinel = $('#sMoreSentinel', root);
      if (canMore && sentinel && 'IntersectionObserver' in window) {
        moreObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting) && !loadingMore) {
            moreObserver?.disconnect();
            run(query, Math.min(MAX, want + PAGE), true);
          }
        }, { rootMargin: '500px 0px' });
        moreObserver.observe(sentinel);
      }
    } catch (e) {
      clearTimeout(slowTimer);
      loadingMore = false;
      moreObserver?.disconnect();
      if (e.name === 'AbortError') return;
      if (!items.size) {
        showError(e.message);
      } else {
        more.innerHTML = '';
        toast(e.message, { type: 'error', title: 'Some results could not load' });
      }
    }
  }

  function submit() {
    const q = input.value.trim();
    if (!q) { input.focus(); toast('Type what you are looking for.', { type: 'info' }); return; }
    const active = ENGINES.find((e) => e.id === engine);
    if (!active.live) {
      window.open(active.url(q), '_blank', 'noopener');
      toast(`${active.label} opened in a new tab. Copy a video link and paste it on the Download tab.`, { type: 'info', title: 'Search opened' });
      return;
    }
    explore.hidden = true;
    vShelves.hidden = true;
    run(q, PAGE, false);
  }

  function setEngine(id) {
    engine = id;
    root.querySelectorAll('[data-engine]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.engine === id)));
    const active = ENGINES.find((e) => e.id === id);
    note.querySelector('span').textContent = active.live
      ? 'YouTube results appear right here. Tap Download to send a result to the Download tab.'
      : `${active.label} search opens in a new tab. Copy a video link from there and paste it on the Download tab.`;
    $('#sBtn', root).querySelector('span').textContent = active.live ? 'Search' : 'Open search';
  }

  // ---------- events ----------
  const onClick = (e) => {
    if (root.dataset.suppressClick) return undefined;
    if (e.target.closest('#vRefresh') || e.target.closest('#vShelfRetry')) return loadVideoShelves(true);
    if (e.target.closest('#vShelfRetry')) return loadVideoShelves(true);
    const pinBtn = e.target.closest('[data-pin]');
    if (pinBtn) {
      const card = pinBtn.closest('[data-url]');
      const it = card && shelfKnown.get(card.dataset.url);
      if (!it) return undefined;
      const on = togglePin(it);
      pinBtn.classList.toggle('on', on);
      pinBtn.setAttribute('aria-pressed', String(on));
      toast(on ? 'Pinned to the Video screen.' : 'Unpinned.', { type: 'success', sound: false, timeout: 1800 });
      return undefined;
    }
    const shelfOpen = e.target.closest('#vShelves [data-open]');
    if (shelfOpen) {
      const card = shelfOpen.closest('[data-url]');
      if (card) openShelfItem(card.dataset.url);
      return undefined;
    }
    const shuffleBtn = e.target.closest('#vShelves [data-shuffle]');
    if (shuffleBtn) { shuffleShelf(shuffleBtn.dataset.shuffle); return undefined; }
    const eng = e.target.closest('[data-engine]');
    if (eng) return setEngine(eng.dataset.engine);
    const tile = e.target.closest('[data-explore]');
    if (tile) {
      input.value = tile.dataset.explore;
      return submit();
    }
    const historyBtn = e.target.closest('[data-history]');
    if (historyBtn) { input.value = historyBtn.dataset.history; return submit(); }
    const watch = e.target.closest('[data-watch]');
    if (watch) { openVideo(items.get(watch.dataset.watch)); return; }
    const favoriteBtn = e.target.closest('[data-favorite]');
    if (favoriteBtn) {
      const item = items.get(favoriteBtn.dataset.favorite);
      if (!item) return;
      const exists = favorites.some((v) => v.id === item.id);
      favorites = exists ? favorites.filter((v) => v.id !== item.id) : [{ id: item.id, title: item.title, url: item.url, thumbnail: item.thumbnail, uploader: item.uploader, duration: item.duration, view_count: item.view_count }, ...favorites].slice(0, 500);
      localStorage.setItem('vidyra.favorites', JSON.stringify(favorites));
      if (favoritesOnly) renderGrid(); else favoriteBtn.setAttribute('aria-pressed', String(!exists));
      toast(exists ? 'Removed from saved videos.' : 'Video saved.', { type: 'success', timeout: 1800 });
      return;
    }
    const shareBtn = e.target.closest('[data-share]');
    if (shareBtn) {
      const url = shareBtn.dataset.share;
      if (navigator.share) navigator.share({ title: 'Video', url }).catch(() => {});
      else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => toast('Video link copied for sharing.', { type: 'success' })).catch(() => toast(url, { type: 'info', title: 'Share this link' }));
      else toast(url, { type: 'info', title: 'Share this link', timeout: 10000 });
      return;
    }
    const use = e.target.closest('[data-use]');
    if (use) {
      ctx.setPendingUrl(use.dataset.use);
      ctx.navigate('download');
      return undefined;
    }
    const audioBtn = e.target.closest('[data-audio]');
    if (audioBtn) {
      const url = audioBtn.dataset.audio;
      const title = audioBtn.closest('[data-url]') ? (items.get(audioBtn.closest('[data-id]')?.dataset.id)?.title || '') : '';
      // Feature 4: ask before queuing a video that is already in the library.
      confirmIfDuplicate(url, title)
        .then((go) => (go ? queueDownload({ url, mode: 'audio', audioFormat: 'mp3' }) : null))
        .then((res) => {
          if (res === null) return;
          fire('queue');
          toast('Audio download added to the queue.', { type: 'success', sound: false });
          ctx.navigate('queue');
        })
        .catch((err) => { if (!err.cancelled) toast(err.message || 'Could not queue audio.', { type: 'error' }); });
      return undefined;
    }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy)
        .then(() => toast('Link copied.', { type: 'success', timeout: 2200 }))
        .catch(() => toast(copy.dataset.copy, { type: 'info', title: 'Copy this link', timeout: 8000 }));
    }
    return undefined;
  };

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-select]')) {
      if (e.target.checked) selected.add(e.target.dataset.select); else selected.delete(e.target.dataset.select);
    }
    if (e.target.id === 'sortResults') { sortMode = e.target.value; renderGrid(); }
    if (e.target.id === 'durationFilter') { durationFilter = e.target.value; renderGrid(); }
  });
  $('#favoritesOnly', root).addEventListener('click', (e) => {
    favoritesOnly = !favoritesOnly;
    e.currentTarget.setAttribute('aria-pressed', String(favoritesOnly));
    if (favoritesOnly) favorites.forEach((item) => { if (item.id && item.url && !items.has(item.id)) items.set(item.id, item); });
    renderGrid();
  });
  $('#copySelected', root).addEventListener('click', async () => {
    const urls = [...selected].map((id) => items.get(id)?.url).filter(Boolean);
    if (!urls.length) return toast('Select at least one video first.', { type: 'info' });
    try { await navigator.clipboard.writeText(urls.join('\n')); toast(`${urls.length} video links copied.`, { type: 'success' }); }
    catch { toast(urls.join('\n'), { type: 'info', title: 'Selected video links', timeout: 10000 }); }
  });
  $('#downloadSelected', root).addEventListener('click', async () => {
    const urls = [...selected].map((id) => items.get(id)?.url).filter(Boolean);
    if (!urls.length) return toast('Select at least one video first.', { type: 'info' });
    let ok = 0;
    for (const url of urls) {
      try {
        if (!(await confirmIfDuplicate(url, items.get([...items.keys()].find((k) => items.get(k).url === url))?.title))) continue;
        await queueDownload({ url, mode: 'video', height: 'best', container: 'mp4' });
        ok += 1;
      } catch (err) {
        if (err.cancelled) break;
        toast(err.message || 'Could not queue one of the videos.', { type: 'error' });
      }
    }
    if (ok) {
      selected.clear();
      renderGrid();
      fire('queue');
      toast(`${ok} video${ok === 1 ? '' : 's'} added to the download queue.`, { type: 'success', sound: false });
      ctx.navigate('queue');
    }
  });
  $('#clearSelection', root).addEventListener('click', () => { selected.clear(); renderGrid(); });
  $('#clearHistory', root).addEventListener('click', () => { history = []; try { localStorage.removeItem('vidyra.searchHistory'); } catch {} renderHistory(); toast('Search history cleared.', { type: 'success' }); });
  renderHistory();

  root.addEventListener('click', onClick);
  $('#sForm', root).addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  input.addEventListener('input', () => {
    if (!input.value.trim() && engine === 'youtube') {
      explore.hidden = false;
      vShelves.hidden = false;
    }
  });
  const offLongPress = longPressCopy(root); // Feature 8: long-press a card to copy its link
  input.focus();
  loadVideoShelves(false);
  const stopAuto = autoRefresh(() => { if (!vShelves.hidden) loadVideoShelves(true); });

  return () => {
    stopAuto();
    controller?.abort();
    clearTimeout(slowTimer);
    moreObserver?.disconnect();
    offLongPress();
    root.removeEventListener('click', onClick);
  };
}
