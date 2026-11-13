// Video tab: paste a link → read the video → choose type, quality, format and options → queue it in Vidyra or
// send it straight to this device. Batch mode queues many links at once. The quality presets set the common
// choices in one tap.
import {
  $, esc, icon, api, prefs, setPref, toast, dialog, fmtBytes, fmtDuration, watchLaterAdd, watchLaterList,
  watchLaterRemove, adviseFormat, inQuietHours, MOODS, setMoodTag, on, queueDownload, confirmDialog,
} from '../core.js';
import { fire, animate } from '../fx.js';
import {
  pinned, togglePin, confirmIfDuplicate, libraryIds, queueBatchCall, shelf, longPressCopy,
} from './home-shared.js';

const CONTAINERS = [
  { id: 'mp4', label: 'MP4', hint: 'Plays everywhere' },
  { id: 'mkv', label: 'MKV', hint: 'Keeps every track' },
  { id: 'webm', label: 'WebM', hint: 'Open web format' },
];
const AUDIO_FORMATS = [
  { id: 'mp3', label: 'MP3', hint: 'Universal' },
  { id: 'm4a', label: 'M4A', hint: 'Apple & Android' },
  { id: 'opus', label: 'Opus', hint: 'Smallest files' },
  { id: 'aac', label: 'AAC', hint: 'Streaming' },
  { id: 'wav', label: 'WAV', hint: 'Lossless, large' },
  { id: 'flac', label: 'FLAC', hint: 'Lossless, compact' },
];
const PRESETS = [
  { id: 'best', label: 'Best', mode: 'video', height: 'best' },
  { id: '1080', label: '1080p', mode: 'video', height: 1080 },
  { id: '720', label: '720p', mode: 'video', height: 720 },
  { id: 'audio', label: 'Audio only', mode: 'audio' },
];
const LANG_NAMES = { hi: 'Hindi', en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', ru: 'Russian', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', id: 'Indonesian', tr: 'Turkish', ur: 'Urdu', bn: 'Bengali', ta: 'Tamil', te: 'Telugu', it: 'Italian' };
const RECENT_KEY = 'vidyra.recentLinks';
const RECENT_MAX = 6;

const pillLabel = (h) => (h >= 4320 ? `${h}p · 8K` : h >= 2160 ? `${h}p · 4K` : h >= 1440 ? `${h}p · 2K` : `${h}p`);
const isLink = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.url === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberRecent(entry) {
  const list = [entry, ...readRecent().filter((x) => x.url !== entry.url)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

/** Dubbed-audio languages offered in batch mode. "Original" keeps the video's own audio. */
const VOICES = [
  { code: 'auto', label: 'Original' }, { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' }, { code: 'pa', label: 'Punjabi' }, { code: 'bn', label: 'Bengali' },
  { code: 'ar', label: 'Arabic' }, { code: 'es', label: 'Spanish' }, { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' }, { code: 'pt', label: 'Portuguese' }, { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' }, { code: 'ko', label: 'Korean' }, { code: 'tr', label: 'Turkish' },
  { code: 'id', label: 'Indonesian' },
];

export function mount(root, ctx) {
  let info = null;
  let currentUrl = '';
  let controller = null;
  let existing = null;
  let batchMode = false;
  const opts = {
    mode: prefs.mode === 'audio' ? 'audio' : 'video',
    // Feature 3: data saver makes 480p the default and turns thumbnails off.
    height: prefs.dataSaver ? 480 : 'best',
    container: prefs.container || 'mp4',
    audioFormat: prefs.audioFormat || 'mp3',
    audioLang: 'auto',
    thumbnail: Boolean(prefs.thumbnail) && !prefs.dataSaver,
    subs: Boolean(prefs.subs),
    subLangs: prefs.subLangs || 'en',
    playlist: false,
    sponsorBlock: Boolean(prefs.sponsorBlock),
    embedChapters: prefs.embedChapters !== false,
    startTime: '',
    endTime: '',
    mood: '',
  };

  root.innerHTML = `
    <section class="card hero" aria-labelledby="dlTitle">
      <h2 id="dlTitle">Paste a link</h2>
      <p>Works with YouTube, Instagram, TikTok, X, Facebook, Vimeo and most other sites that yt-dlp supports.</p>
      <div class="mode-tabs" role="group" aria-label="Paste one link or many" style="margin-top:16px">
        <button type="button" id="singleTab" aria-pressed="true">One link</button>
        <button type="button" id="batchTab" aria-pressed="false">Many links</button>
      </div>
      <div id="singleBox" style="margin-top:14px">
        <form id="fetchForm" class="input-row" autocomplete="off">
          <div class="input-wrap">
            ${icon('link')}
            <input id="urlIn" type="text" inputmode="url" placeholder="https://…" aria-label="Video link" autocapitalize="off" spellcheck="false">
            <button id="pasteBtn" class="btn btn-sm btn-ghost" type="button">${icon('clipboard', 'sm')}<span>Paste</span></button>
          </div>
          <button id="fetchBtn" class="btn btn-primary" type="submit">${icon('search', 'sm')}<span>Fetch info</span></button>
        </form>
        <div class="row" style="margin-top:10px">
          <button type="button" class="btn btn-sm btn-ghost" id="clipCheck">${icon('clipboard', 'sm')} Check clipboard for a link</button>
        </div>
        <div id="clipBanner" class="clip-banner" hidden style="margin-top:10px"></div>
      </div>
      <div id="batchBox" style="margin-top:14px" hidden>
        <div class="row between" style="margin-bottom:8px">
          <label class="label" for="batchUrls">Paste links, one per line</label>
          <span class="small muted" id="batchCount" aria-live="polite">0 valid links</span>
        </div>
        <textarea id="batchUrls" class="input" rows="5" placeholder="https://…&#10;https://…" style="width:100%;font-family:var(--mono);font-size:13px" aria-label="Multiple video links" spellcheck="false"></textarea>
        <div id="batchInvalid" class="batch-invalid" hidden></div>
        <div class="row" style="margin-top:10px;gap:8px">
          <button type="button" class="btn btn-sm" id="batchImport">${icon('folder', 'sm')} Import .txt</button>
          <button type="button" class="btn btn-sm btn-ghost" id="batchClear">Clear</button>
          <input type="file" id="batchFile" accept=".txt,text/plain" hidden>
        </div>
        <div class="batch-panel" id="batchPanel" style="margin-top:14px"></div>
        <div id="batchErrors" hidden></div>
        <button type="button" class="btn btn-primary btn-lg" id="batchGo" style="margin-top:14px" disabled>${icon('download', 'sm')} Download all (0)</button>
        <p class="hint" style="margin-top:8px">Duplicates are removed. Up to 50 links per batch.</p>
      </div>
      <p id="fetchMsg" class="msg info" role="status" aria-live="polite"></p>
      <div id="pinnedBox" class="recent" hidden></div>
      <div id="recentBox" class="recent" hidden></div>
      <div id="laterBox" class="recent" hidden></div>
    </section>
    <div id="result"></div>`;

  const urlIn = $('#urlIn', root);
  const fetchMsg = $('#fetchMsg', root);
  const result = $('#result', root);
  const fetchBtn = $('#fetchBtn', root);
  const recentBox = $('#recentBox', root);
  const clipBanner = $('#clipBanner', root);
  const pinnedBox = $('#pinnedBox', root);

  const setMsg = (text, cls = 'info') => { fetchMsg.className = `msg ${cls}`; fetchMsg.textContent = text; };

  // ---------- quality presets ----------
  function presetId() {
    if (opts.mode === 'audio') return 'audio';
    if (opts.height === 'best') return 'best';
    const h = Number(opts.height);
    return h === 1080 ? '1080' : h === 720 ? '720' : '';
  }

  /** Closest height the source offers, at or below the target. */
  function nearestHeight(target) {
    const hs = (info?.heights || []).map((h) => h.height).filter(Boolean);
    if (!hs.length || hs.includes(target)) return target;
    const lower = hs.filter((h) => h <= target);
    return lower.length ? Math.max(...lower) : Math.min(...hs);
  }

  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    if (p.mode === 'audio') {
      opts.mode = 'audio';
      setPref('mode', 'audio');
    } else {
      opts.mode = 'video';
      setPref('mode', 'video');
      opts.height = p.height === 'best' ? 'best' : nearestHeight(p.height);
    }
  }

  function presetChips(scope) {
    const current = presetId();
    return PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}" data-scope="${scope}" aria-pressed="${current === p.id}">${esc(p.label)}</button>`).join('');
  }

  // ---------- many links: one option panel for every link ----------
  const BATCH_HEIGHTS = [{ h: 'best', label: 'Best' }, { h: 1080, label: '1080p' }, { h: 720, label: '720p' }, { h: 480, label: '480p' }, { h: 360, label: '360p' }];
  const LINK_RE = /^https?:\/\/\S+$/i;
  const MAX_BATCH = 50;
  let failedUrls = [];         // links the last batch could not queue ("Put failed links back")
  let batchUrls = [];          // unique valid links, in order
  let batchInvalid = [];       // tokens that are not links

  /** Splits pasted text on any whitespace, so a line with spaces counts as several links. */
  function parseBatch(raw) {
    const tokens = String(raw || '').split(/\s+/).filter(Boolean);
    const valid = [];
    const invalid = [];
    for (const t of tokens) {
      if (LINK_RE.test(t)) valid.push(t);
      else invalid.push(t);
    }
    return { valid: [...new Set(valid)], invalid };
  }

  function renderBatchCount() {
    const { valid, invalid } = parseBatch($('#batchUrls', root)?.value);
    batchUrls = valid;
    batchInvalid = invalid;
    $('#batchCount', root).textContent = `${valid.length} valid link${valid.length === 1 ? '' : 's'}`;
    const bad = $('#batchInvalid', root);
    const over = valid.length > MAX_BATCH;
    bad.hidden = !invalid.length && !over;
    bad.innerHTML = `${invalid.length ? `
      <div class="notice bad enter" role="status">${icon('alert')}
        <div><b>${invalid.length} line${invalid.length === 1 ? '' : 's'} not a link</b>
          <span class="muted small">${invalid.slice(0, 5).map((t) => `<code>${esc(t.slice(0, 60))}</code>`).join(' ')}${invalid.length > 5 ? ` and ${invalid.length - 5} more` : ''}</span>
        </div>
      </div>` : ''}${over ? `
      <div class="notice bad enter" role="alert">${icon('alert')}<div><b>Too many links</b><span class="muted small">Batches take up to ${MAX_BATCH} links. Remove ${valid.length - MAX_BATCH} to continue.</span></div></div>` : ''}`;
    const go = $('#batchGo', root);
    go.disabled = !valid.length || over;
    go.innerHTML = `${icon('download', 'sm')} Download all (${valid.length})`;
    const summary = batchSummaryText();
    $('#batchPanel', root).querySelector('[data-batch-summary]')?.replaceChildren(summary);
  }

  function batchSummaryText() {
    const voice = opts.audioLang && opts.audioLang !== 'auto'
      ? ' · voice ' + (VOICES.find((v) => v.code === opts.audioLang) || { label: opts.audioLang }).label : '';
    const clip = (opts.clipStart || opts.clipEnd)
      ? ' · clip ' + (opts.clipStart || '0:00') + ' to ' + (opts.clipEnd || 'end') : '';
    if (opts.mode === 'audio') return `Audio · ${opts.audioFormat.toUpperCase()}${voice}${clip}`;
    const q = opts.height === 'best' ? 'Best available' : pillLabel(Number(opts.height));
    return `${q} · ${opts.container.toUpperCase()}${voice}${clip}${opts.subs ? ' · subtitles' : ''}${opts.thumbnail ? ' · thumbnail' : ''}${opts.playlist ? ' · playlists' : ''}`;
  }
  function updateBatchSummary() {
    const el = $('#batchPanel', root)?.querySelector('[data-batch-summary]');
    if (el) el.textContent = batchSummaryText();
  }

  function renderBatchPanel() {
    const box = $('#batchPanel', root);
    if (!box) return;
    const quality = BATCH_HEIGHTS.map((q) => `<button type="button" class="chip" data-bh="${q.h}" aria-pressed="${String(opts.height) === String(q.h)}">${q.label}</button>`).join('');
    box.innerHTML = `
      <div class="opts-grid">
        <div class="opt">
          <span class="label">${icon('sparkles', 'sm')} Download as</span>
          <div class="seg wide" role="group" aria-label="Batch download type">
            <button type="button" data-bmode="video" aria-pressed="${opts.mode === 'video'}">${icon('video', 'sm')} Video</button>
            <button type="button" data-bmode="audio" aria-pressed="${opts.mode === 'audio'}">${icon('audio', 'sm')} Audio only</button>
          </div>
        </div>
        ${opts.mode === 'video' ? `
        <div class="opt">
          <span class="label">${icon('gauge', 'sm')} Quality</span>
          <div class="chips" role="group" aria-label="Batch quality">${quality}</div>
        </div>
        <div class="opt">
          <span class="label">${icon('video', 'sm')} Container</span>
          <div class="seg" role="group" aria-label="Batch container">
            ${CONTAINERS.map((c) => `<button type="button" data-bcontainer="${c.id}" aria-pressed="${opts.container === c.id}" title="${c.hint}">${c.label}</button>`).join('')}
          </div>
        </div>` : `
        <div class="opt">
          <span class="label">${icon('audio', 'sm')} Audio format</span>
          <div class="chips" role="group" aria-label="Batch audio format">
            ${AUDIO_FORMATS.map((f) => `<button type="button" class="chip" data-bafmt="${f.id}" aria-pressed="${opts.audioFormat === f.id}">${f.label}</button>`).join('')}
          </div>
        </div>`}
      </div>
      <div class="opts-grid">
        <div class="opt">
          <label class="label" for="bVoice">${icon('audio', 'sm')} Voice (dubbed audio)</label>
          <select id="bVoice" class="input">${VOICES.map((v) => `<option value="${v.code}" ${opts.audioLang === v.code ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          <span class="hint">Uses the dubbed track when a video has one, otherwise its original audio.</span>
        </div>
        <div class="opt">
          <span class="label">${icon('gauge', 'sm')} Clip (optional)</span>
          <div class="clip-row">
            <input id="bClipStart" class="input" placeholder="Start 0:30" value="${esc(opts.clipStart || '')}" aria-label="Clip start">
            <span class="muted small">to</span>
            <input id="bClipEnd" class="input" placeholder="End 2:15" value="${esc(opts.clipEnd || '')}" aria-label="Clip end">
          </div>
          <span class="hint">The same clip is cut from every link. Leave empty for the whole video.</span>
        </div>
      </div>
      <div class="toggle-row">
        <div><div class="ttl">Embed thumbnail</div><div class="desc">Stores the cover art inside each file.</div></div>
        <label class="switch"><input type="checkbox" id="bThumb" ${opts.thumbnail ? 'checked' : ''} aria-label="Embed thumbnail for all links"><span></span></label>
      </div>
      ${opts.mode === 'video' ? `
      <div class="toggle-row">
        <div><div class="ttl">Embed subtitles</div><div class="desc">Burns captions into each file.</div></div>
        <label class="switch"><input type="checkbox" id="bSubs" ${opts.subs ? 'checked' : ''} aria-label="Embed subtitles for all links"><span></span></label>
      </div>
      <div class="toggle-row">
        <div><div class="ttl">Whole playlists</div><div class="desc">If a link is a playlist, download every item.</div></div>
        <label class="switch"><input type="checkbox" id="bPlaylist" ${opts.playlist ? 'checked' : ''} aria-label="Download whole playlists"><span></span></label>
      </div>` : ''}
      <div class="toggle-row">
        <div><div class="ttl">Data saver</div><div class="desc">Sets 480p and turns thumbnails off. Saves data on slow connections.</div></div>
        <label class="switch"><input type="checkbox" id="bSaver" ${prefs.dataSaver ? 'checked' : ''} aria-label="Data saver"><span></span></label>
      </div>
      <p class="small" style="margin-top:6px"><b>Apply to all links:</b> <span data-batch-summary>${esc(batchSummaryText())}</span></p>`;
  }

  function setBatchErrors(lines, title = '') {
    const box = $('#batchErrors', root);
    if (!box) return;
    box.hidden = !lines.length;
    box.innerHTML = lines.length ? `
      <div class="notice bad enter" role="alert">${icon('alert')}
        <div><b>${esc(title || 'Some links could not be queued')}</b>
          <ul class="batch-fail">${lines.map((l) => `<li><code>${esc(String(l).slice(0, 220))}</code></li>`).join('')}</ul>
          <button type="button" class="btn btn-sm" id="batchPutBack" style="margin-top:8px">${icon('refresh', 'sm')} Put failed links back</button>
        </div>
      </div>` : '';
  }

  // ---------- single link ----------
  function renderPinned() {
    const list = pinned();
    pinnedBox.hidden = !list.length || Boolean(info);
    pinnedBox.innerHTML = list.length ? shelf({ id: 'pinned', title: 'Pinned', items: list }, 'video', { shuffle: false }) : '';
  }

  function renderRecent() {
    renderPinned();
    const list = readRecent();
    recentBox.hidden = !list.length || Boolean(info);
    recentBox.innerHTML = list.length ? `
      <span class="label">${icon('clipboard', 'sm')} Recent links</span>
      <div class="chips hscroll">
        ${list.map((x, i) => `<button type="button" class="chip" data-recent="${i}" title="${esc(x.url)}">${esc(x.title || x.url)}</button>`).join('')}
      </div>` : '';
  }

  function renderLater() {
    const box = $('#laterBox', root);
    if (!box) return;
    const list = watchLaterList();
    box.hidden = !list.length || Boolean(info);
    box.innerHTML = list.length ? `
      <span class="label">${icon('list', 'sm')} Watch Later (${list.length})</span>
      <div class="chips hscroll">
        ${list.map((x, i) => `<button type="button" class="chip" data-later="${i}" title="${esc(x.url)}">${esc(x.title || x.url)}</button>`).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="clearLater" style="margin-top:6px">Clear shelf</button>` : '';
  }

  function normalize(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  /** Checks the library for the same video (yt-dlp names files with the video id in brackets). */
  async function checkExisting(id) {
    existing = null;
    if (!id) return;
    try {
      const data = await api('/api/files');
      existing = data.files.find((f) => f.role === 'media' && f.name.includes(`[${id}]`)) || null;
      if (existing && info?.id === id) renderInfo(false);
    } catch { /* the library is optional here */ }
  }

  async function fetchInfo(raw) {
    const url = normalize(raw);
    if (!url) { setMsg('Paste a link first.', 'err'); urlIn.focus(); return; }
    urlIn.value = url;
    currentUrl = url;
    controller?.abort();
    controller = new AbortController();
    fetchBtn.disabled = true;
    setMsg('Reading the video. This can take a few seconds…');
    result.innerHTML = `
      <div class="card info" aria-busy="true" aria-label="Loading video details">
        <div class="skel thumb"></div>
        <div class="skel" style="height:22px;width:70%"></div>
        <div class="skel" style="height:14px;width:40%"></div>
        <div class="skel" style="height:44px;width:100%;margin-top:6px"></div>
      </div>`;
    try {
      info = await api('/api/info', { method: 'POST', body: { url }, signal: controller.signal });
      setMsg('');
      // A quality chosen for an earlier video stays only when this video offers it.
      if (opts.height !== 'best' && !info.heights.some((h) => h.height === Number(opts.height))) opts.height = nearestHeight(Number(opts.height));
      rememberRecent({ url, title: info.title });
      renderRecent();
      renderInfo(true);
      checkExisting(info.id);
    } catch (e) {
      if (e.name === 'AbortError') return;
      info = null;
      setMsg('', 'info');
      renderRecent();
      const needsSetup = e.status === 503;
      result.innerHTML = `
        <div class="notice ${needsSetup ? 'bad' : 'info'} enter">
          ${icon(needsSetup ? 'alert' : 'info')}
          <div>
            <b>${needsSetup ? 'yt-dlp is not installed' : 'We could not read that link'}</b>
            <span class="muted">${esc(e.message)}</span>
            ${needsSetup ? '<div style="margin-top:6px"><a class="btn btn-sm" href="#/settings/advanced">Open Advanced in Settings</a></div>' : ''}
          </div>
        </div>`;
    } finally {
      fetchBtn.disabled = false;
    }
  }

  function quality() {
    if (opts.mode === 'audio') return null;
    return info.heights.find((h) => h.height === Number(opts.height)) || null;
  }

  function summaryText() {
    if (opts.mode === 'audio') {
      return { title: `Audio · ${opts.audioFormat.toUpperCase()}`, sub: 'Best available audio, saved as an audio file' };
    }
    const q = quality();
    const label = opts.height === 'best' ? 'Best available' : pillLabel(Number(opts.height));
    const size = q?.size ? `≈ ${fmtBytes(q.size)}` : '';
    return { title: `${label} · ${opts.container.toUpperCase()}`, sub: [size, opts.subs ? 'with subtitles' : ''].filter(Boolean).join(' · ') || 'Merged video and audio' };
  }

  function renderInfo(animateCard) {
    const dur = fmtDuration(info.duration);
    const showPlaylist = /[?&]list=/.test(currentUrl);
    const langs = info.audioLanguages || [];
    const langSelect = langs.length ? `
      <div class="opt">
        <span class="label">${icon('globe', 'sm')} Audio language</span>
        <select class="input lang-select" id="langSel" aria-label="Audio language">
          <option value="auto">Original (default)</option>
          ${langs.map((l) => `<option value="${esc(l.code)}" ${opts.audioLang === l.code ? 'selected' : ''}>${esc(l.name || LANG_NAMES[l.code] || l.code)}</option>`).join('')}
        </select>
        <span class="hint">Shows dubs the creator uploaded. ${langs.length === 1 ? 'Only one track exists for this video.' : ''}</span>
      </div>` : '';

    // Every choice is a standard step (1080p, 1440p …). Real source heights such as 2026 are shown as their step.
    const qualityBlock = `
      <div class="opt">
        <span class="label">${icon('gauge', 'sm')} Quality</span>
        <div class="chips" role="group" aria-label="Quality">
          <button type="button" class="chip" data-h="best" aria-pressed="${opts.height === 'best'}">Best available<small>Highest the source offers</small></button>
          ${info.heights.map((q) => {
            const detail = [q.fps > 30 ? `${q.fps} fps` : '', q.size ? fmtBytes(q.size) : ''].filter(Boolean).join(' · ') || 'Video';
            const real = q.actual && q.actual !== q.height ? ` · source ${q.actual}p` : '';
            return `<button type="button" class="chip" data-h="${q.height}" aria-pressed="${String(opts.height) === String(q.height)}">
              ${pillLabel(q.height)}<small>${esc(detail + real)}</small>
            </button>`;
          }).join('')}
        </div>
        ${info.heights.length ? '' : '<span class="chip-hint">No video sizes were listed. Best available will be used.</span>'}
      </div>
      <div class="opt">
        <span class="label">${icon('video', 'sm')} Container</span>
        <div class="seg" role="group" aria-label="Video container">
          ${CONTAINERS.map((c) => `<button type="button" data-container="${c.id}" aria-pressed="${opts.container === c.id}" title="${c.hint}">${c.label}</button>`).join('')}
        </div>
      </div>`;

    const audioBlock = `
      <div class="opt">
        <span class="label">${icon('audio', 'sm')} Audio format</span>
        <div class="chips" role="group" aria-label="Audio format">
          ${AUDIO_FORMATS.map((f) => `<button type="button" class="chip" data-afmt="${f.id}" aria-pressed="${opts.audioFormat === f.id}">${f.label}<small>${f.hint}</small></button>`).join('')}
        </div>
      </div>`;

    const toggles = `
      <div class="opt">
        <div class="toggle-row" style="padding-top:0;border-top:0">
          <div><div class="ttl">Embed thumbnail</div><div class="desc">Stores the video's cover art inside the file.</div></div>
          <label class="switch"><input type="checkbox" id="tThumb" ${opts.thumbnail ? 'checked' : ''} aria-label="Embed thumbnail"><span></span></label>
        </div>
        ${opts.mode === 'video' ? `
        <div class="toggle-row">
          <div><div class="ttl">Embed subtitles</div><div class="desc">Burns captions into the file. No separate caption files are kept.</div></div>
          <label class="switch"><input type="checkbox" id="tSubs" ${opts.subs ? 'checked' : ''} aria-label="Embed subtitles"><span></span></label>
        </div>
        ${opts.subs ? `<div class="field sub-langs"><label for="subLangs">Subtitle languages</label><input id="subLangs" class="input" value="${esc(opts.subLangs)}" placeholder="en,hi"><span class="hint">Comma-separated codes, for example en,hi</span></div>` : ''}
        <div class="toggle-row">
          <div><div class="ttl">Remove sponsors (SponsorBlock)</div><div class="desc">Cuts sponsor, self-promo and interaction segments when the community has marked them.</div></div>
          <label class="switch"><input type="checkbox" id="tSponsor" ${opts.sponsorBlock ? 'checked' : ''} aria-label="Remove SponsorBlock segments"><span></span></label>
        </div>
        <div class="toggle-row">
          <div><div class="ttl">Embed chapters</div><div class="desc">Keeps chapter markers inside the file for supported players.</div></div>
          <label class="switch"><input type="checkbox" id="tChapters" ${opts.embedChapters ? 'checked' : ''} aria-label="Embed chapters"><span></span></label>
        </div>
        <div class="field" style="margin-top:10px">
          <span class="label">Clip time range (optional)</span>
          <div class="input-row" style="flex-wrap:wrap;gap:8px">
            <input id="startTime" class="input" type="text" inputmode="numeric" placeholder="Start sec (0)" value="${esc(opts.startTime)}" style="max-width:140px" aria-label="Start time in seconds">
            <input id="endTime" class="input" type="text" inputmode="numeric" placeholder="End sec" value="${esc(opts.endTime)}" style="max-width:140px" aria-label="End time in seconds">
          </div>
          <span class="hint">Leave blank for the full video. Example: 30 → 180 downloads only that section.</span>
        </div>` : ''}
        ${showPlaylist ? `
        <div class="toggle-row">
          <div><div class="ttl">Whole playlist</div><div class="desc">The link contains a playlist. Turn on to download every item.</div></div>
          <label class="switch"><input type="checkbox" id="tPlaylist" ${opts.playlist ? 'checked' : ''} aria-label="Download whole playlist"><span></span></label>
        </div>` : ''}
      </div>`;

    const s = summaryText();
    const advice = adviseFormat(info.duration);
    const advisor = advice && opts.mode === 'video' ? `
      <div class="notice info enter" role="status">
        ${icon('sparkles')}
        <div><b>Format advisor</b><span class="muted">${esc(advice.reason)}</span>
          <div style="margin-top:6px"><button type="button" class="btn btn-sm" id="applyAdvice">${icon('audio', 'sm')} Switch to audio</button></div>
        </div>
      </div>` : '';
    const quiet = inQuietHours() ? `
      <div class="notice bad enter" role="status">${icon('moon')}<div><b>Quiet hours</b><span class="muted"> New downloads are delayed until quiet hours end. You can still queue them.</span></div></div>` : '';
    const dupNotice = existing ? `
      <div class="notice info enter dup-notice" role="status">
        ${icon('check')}
        <div><b>Already in your library</b><span class="muted">${esc(existing.name)}</span>
          <div style="margin-top:6px"><a class="btn btn-sm" href="#/library">${icon('library', 'sm')} Open library</a></div>
        </div>
      </div>` : '';
    result.innerHTML = `
      <article class="card info" aria-labelledby="infoTitle">
        <div class="info-head">
          <div class="thumb ${info.thumbnail ? '' : 'nothumb'}">
            ${info.thumbnail ? `<img src="${esc(info.thumbnail)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentNode?.classList.add('nothumb')">` : ''}
            ${dur ? `<span class="dur">${dur}</span>` : ''}
          </div>
          <div style="min-width:0;flex:1">
            <h3 id="infoTitle" class="clamp-2" hidden>${esc(info.title)}</h3>
            <label class="label" for="editTitle" style="display:block;margin-bottom:6px">${icon('edit', 'sm')} File name (edit before download)</label>
            <input id="editTitle" class="input" type="text" maxlength="200" value="${esc(info.customTitle || info.title || '')}" aria-label="Edit video title before download" spellcheck="true">
            <p class="muted small" style="margin-top:6px">${esc([info.uploader, info.extractor].filter(Boolean).join(' · '))}</p>
            <p class="hint small" style="margin-top:4px">This becomes the saved file name. Invalid characters are cleaned automatically.</p>
          </div>
        </div>
        ${dupNotice}${advisor}${quiet}
        <div class="opt">
          <span class="label">${icon('sparkles', 'sm')} Quick choice</span>
          <div class="preset-row" role="group" aria-label="Quality presets">${presetChips('single')}</div>
        </div>
        <div class="opts-grid">
          <div class="opt">
            <span class="label">${icon('sparkles', 'sm')} Download as</span>
            <div class="seg wide" role="group" aria-label="Download type">
              <button type="button" data-mode="video" aria-pressed="${opts.mode === 'video'}">${icon('video', 'sm')} Video</button>
              <button type="button" data-mode="audio" aria-pressed="${opts.mode === 'audio'}">${icon('audio', 'sm')} Audio only</button>
            </div>
          </div>
          <div class="opt">
            <span class="label">${icon('star', 'sm')} Mood tag</span>
            <div class="chips" role="group" aria-label="Mood tag">
              ${MOODS.map((m) => `<button type="button" class="chip" data-mood="${m}" aria-pressed="${opts.mood === m}">${m}</button>`).join('')}
            </div>
          </div>
          ${opts.mode === 'video' ? qualityBlock : audioBlock}
          ${langSelect}
          ${toggles}
        </div>
        <div class="summary">
          <div class="meta"><strong id="sumTitle">${esc(s.title)}</strong><span class="muted small" id="sumSub">${esc(s.sub)}</span></div>
          <div class="stack get-buttons">
            <button id="dlBtn" class="btn btn-primary btn-lg" type="button" data-target="vidyra">${icon('download', 'sm')} Download in Vidyra</button>
            <button id="devBtn" class="btn btn-lg" type="button" data-target="device">${icon('phone', 'sm')} Save to this device</button>
            <button id="laterBtn" class="btn btn-lg btn-ghost" type="button">${icon('list', 'sm')} Save to Watch Later</button>
            <p class="hint small" style="margin:0">Vidyra keeps the file in your library. “Save to this device” hands the finished file to your browser. Watch Later saves the link without downloading.</p>
          </div>
        </div>
      </article>`;
    if (animateCard) animate(result.querySelector('.info'), 'enter');
  }

  function refreshSummary() {
    const s = summaryText();
    const t = $('#sumTitle', result);
    const sub = $('#sumSub', result);
    if (t) t.textContent = s.title;
    if (sub) sub.textContent = s.sub;
  }

  function editedTitle() {
    const el = $('#editTitle', result);
    const raw = (el?.value || info?.customTitle || info?.title || '').trim();
    return raw.slice(0, 200) || info?.title || 'download';
  }

  function body(deliver) {
    const title = editedTitle();
    if (info) info.customTitle = title;
    const startEl = $('#startTime', result);
    const endEl = $('#endTime', result);
    if (startEl) opts.startTime = startEl.value.trim();
    if (endEl) opts.endTime = endEl.value.trim();
    return {
      url: currentUrl,
      title,
      customTitle: title,
      mode: opts.mode,
      height: opts.height,
      container: opts.container,
      audioFormat: opts.audioFormat,
      audioLang: opts.audioLang,
      subs: opts.mode === 'video' && opts.subs,
      subLangs: opts.subLangs,
      thumbnail: opts.thumbnail,
      playlist: opts.playlist,
      sponsorBlock: opts.mode === 'video' && opts.sponsorBlock,
      embedChapters: opts.embedChapters,
      startTime: opts.startTime,
      endTime: opts.endTime,
      deliver,
    };
  }

  async function queueSingle(deliver) {
    if (!info) return;
    const finalTitle = editedTitle();
    if (!(await confirmIfDuplicate(currentUrl, finalTitle))) return;
    if (prefs.confirmDownloads) {
      const s = summaryText();
      const summary = document.createElement('dl');
      summary.innerHTML = `<dt>File name</dt><dd>${esc(finalTitle)}</dd><dt>Format</dt><dd>${esc(s.title)}</dd><dt>Details</dt><dd>${esc(s.sub)}</dd><dt>Destination</dt><dd>${deliver ? 'Save to this device when ready' : 'Vidyra library'}</dd>`;
      const ok = await dialog({
        title: deliver ? 'Save to this device?' : 'Add to the download queue?',
        body: summary,
        actions: [
          { label: 'Cancel', value: false, variant: 'ghost' },
          { label: deliver ? 'Save to device' : 'Start download', value: true, variant: 'primary' },
        ],
      });
      if (ok !== true) return;
    }
    const buttons = [...result.querySelectorAll('#dlBtn, #devBtn')];
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if (inQuietHours()) {
        toast('Quiet hours are on — the job is queued but will wait until the window ends (or you turn quiet hours off).', { type: 'info', timeout: 5000 });
      }
      const res = await queueDownload(body(deliver));
      if (opts.mood && res?.id) setMoodTag(res.id, opts.mood);
      fire('queue');
      toast(finalTitle, {
        type: 'success', sound: false,
        title: deliver ? 'Queued to save on this device' : 'Added to the queue',
        action: { label: 'View queue', onClick: () => ctx.navigate('queue') },
      });
    } catch (e) {
      if (!e.cancelled) toast(e.message, { type: 'error', title: "Couldn't start the download", timeout: 7000 });
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // ---------- batch: queue every valid link with the shared options ----------
  function batchOptions() {
    const isVideo = opts.mode === 'video';
    return {
      mode: opts.mode,
      height: isVideo ? opts.height : 'best',
      container: opts.container,
      audioFormat: opts.audioFormat,
      audioLang: opts.audioLang || 'auto',
      clipStart: opts.clipStart || '',
      clipEnd: opts.clipEnd || '',
      subs: isVideo && opts.subs,
      subLangs: opts.subLangs,
      thumbnail: opts.thumbnail,
      playlist: isVideo && opts.playlist,
      sponsorBlock: isVideo && opts.sponsorBlock,
      embedChapters: opts.embedChapters,
    };
  }

  async function queueAll() {
    if (!batchUrls.length || batchUrls.length > MAX_BATCH) return;
    const go = $('#batchGo', root);
    let urls = batchUrls.slice(0, MAX_BATCH);
    // Feature 4: one check for the whole batch. Ask once, then either keep or drop the library duplicates.
    const ids = await libraryIds();
    const dupes = urls.filter((u) => {
      const m = u.match(/[?&]v=([A-Za-z0-9_-]{6,})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/);
      return m && ids.has(m[1]);
    });
    if (dupes.length) {
      const again = await confirmDialog({
        title: 'Already downloaded',
        message: `You already have ${dupes.length === 1 ? 'this video' : `${dupes.length} of these videos`}. Download again?`,
        ok: 'Download again',
      });
      if (!again) urls = urls.filter((u) => !dupes.includes(u));
    }
    if (!urls.length) { toast('Nothing new to download.', { type: 'info', sound: false }); return; }
    go.disabled = true;
    go.innerHTML = `${icon('refresh', 'sm')} Queuing…`;
    try {
      const res = await queueBatchCall(urls, batchOptions());
      const queued = Number(res?.queued) || 0;
      const errors = Array.isArray(res?.errors) ? res.errors : [];
      failedUrls = errors.map((x) => x.url);
      setBatchErrors(errors.map((x) => `${x.url} — ${x.message}`));
      if (queued) {
        toast(`${queued} link${queued === 1 ? '' : 's'} added to the queue.`, {
          type: 'success', title: 'Queued', sound: false,
          action: { label: 'View queue', onClick: () => ctx.navigate('queue') },
        });
        fire('queue');
      }
      if (!queued && !errors.length) toast('Nothing was queued.', { type: 'info' });
    } catch (e) {
      if (!e.cancelled) toast(e.message || 'Could not queue these links.', { type: 'error', title: "Couldn't queue the links" });
    } finally {
      renderBatchCount();
    }
  }

  function importBatchFile(file) {
    if (!file) return;
    if (file.size > 512 * 1024) { toast('That file is too large. Use a list of links under 512 KB.', { type: 'error' }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const box = $('#batchUrls', root);
      box.value = [box.value.trim(), String(reader.result || '').trim()].filter(Boolean).join('\n');
      renderBatchCount();
      toast('Links loaded from the file.', { type: 'success', sound: false, timeout: 2200 });
    };
    reader.onerror = () => toast('Could not read that file.', { type: 'error' });
    reader.readAsText(file);
  }

  function setBatchMode(on) {
    batchMode = on;
    $('#singleTab', root).setAttribute('aria-pressed', String(!on));
    $('#batchTab', root).setAttribute('aria-pressed', String(on));
    $('#singleBox', root).hidden = on;
    $('#batchBox', root).hidden = !on;
    if (on) { renderBatchPanel(); renderBatchCount(); }
    setMsg('');
  }

  // ---------- clipboard (only after a tap) ----------
  async function checkClipboard() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!isLink(text)) { toast('No video link on the clipboard.', { type: 'info', timeout: 2600 }); return; }
      clipBanner.hidden = false;
      clipBanner.innerHTML = `
        <div class="grow"><b>A link is on your clipboard</b><code title="${esc(text)}">${esc(text)}</code></div>
        <button type="button" class="btn btn-sm btn-primary" id="useClip">Use link</button>
        <button type="button" class="btn btn-sm btn-ghost" id="dismissClip" aria-label="Dismiss">${icon('x', 'sm')}</button>`;
      $('#useClip', root).onclick = () => { clipBanner.hidden = true; fetchInfo(text); };
      $('#dismissClip', root).onclick = () => { clipBanner.hidden = true; };
    } catch {
      toast('Your browser blocked clipboard access. Paste the link into the box instead.', { type: 'info', timeout: 5000 });
    }
  }

  // ---------- events ----------
  const onResultClick = (e) => {
    const presetBtn = e.target.closest('[data-preset]');
    if (presetBtn && presetBtn.dataset.scope === 'single') {
      applyPreset(presetBtn.dataset.preset);
      return renderInfo(false);
    }
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      opts.mode = modeBtn.dataset.mode;
      setPref('mode', opts.mode);
      return renderInfo(false);
    }
    const hBtn = e.target.closest('[data-h]');
    if (hBtn) {
      opts.height = hBtn.dataset.h === 'best' ? 'best' : Number(hBtn.dataset.h);
      result.querySelectorAll('[data-h]').forEach((b) => b.setAttribute('aria-pressed', String(String(opts.height) === b.dataset.h)));
      result.querySelectorAll('[data-scope="single"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === presetId())));
      return refreshSummary();
    }
    const cBtn = e.target.closest('[data-container]');
    if (cBtn) {
      opts.container = cBtn.dataset.container;
      setPref('container', opts.container);
      result.querySelectorAll('[data-container]').forEach((b) => b.setAttribute('aria-pressed', String(b === cBtn)));
      return refreshSummary();
    }
    const aBtn = e.target.closest('[data-afmt]');
    if (aBtn) {
      opts.audioFormat = aBtn.dataset.afmt;
      setPref('audioFormat', opts.audioFormat);
      result.querySelectorAll('[data-afmt]').forEach((b) => b.setAttribute('aria-pressed', String(b === aBtn)));
      return refreshSummary();
    }
    if (e.target.closest('#dlBtn')) return queueSingle(false);
    if (e.target.closest('#devBtn')) return queueSingle(true);
    if (e.target.closest('#laterBtn') && info) {
      watchLaterAdd({
        url: currentUrl,
        title: editedTitle(),
        thumbnail: info.thumbnail || '',
        added: Date.now(),
      });
      toast('Saved to Watch Later. Open Video anytime to queue it.', { type: 'success', sound: false });
      return undefined;
    }
    if (e.target.closest('#applyAdvice')) {
      opts.mode = 'audio';
      setPref('mode', 'audio');
      return renderInfo(false);
    }
    const moodBtn = e.target.closest('[data-mood]');
    if (moodBtn) {
      opts.mood = opts.mood === moodBtn.dataset.mood ? '' : moodBtn.dataset.mood;
      result.querySelectorAll('[data-mood]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mood === opts.mood)));
      return undefined;
    }
    return undefined;
  };

  const onResultChange = (e) => {
    const t = e.target;
    if (t.id === 'langSel') { opts.audioLang = t.value; return refreshSummary(); }
    if (t.id === 'tThumb') { opts.thumbnail = t.checked; setPref('thumbnail', opts.thumbnail); return undefined; }
    if (t.id === 'tSubs') { opts.subs = t.checked; setPref('subs', opts.subs); return renderInfo(false); }
    if (t.id === 'tPlaylist') { opts.playlist = t.checked; return undefined; }
    if (t.id === 'tSponsor') { opts.sponsorBlock = t.checked; setPref('sponsorBlock', opts.sponsorBlock); return undefined; }
    if (t.id === 'tChapters') { opts.embedChapters = t.checked; setPref('embedChapters', opts.embedChapters); return undefined; }
    return undefined;
  };
  const onResultInput = (e) => {
    if (e.target.id === 'subLangs') {
      opts.subLangs = e.target.value.trim() || 'en';
      setPref('subLangs', opts.subLangs);
    }
    if (e.target.id === 'editTitle' && info) {
      info.customTitle = e.target.value.trim();
    }
    if (e.target.id === 'startTime') opts.startTime = e.target.value.trim();
    if (e.target.id === 'endTime') opts.endTime = e.target.value.trim();
  };
  const onRecent = (e) => {
    const chip = e.target.closest('[data-recent]');
    if (!chip) return;
    const entry = readRecent()[Number(chip.dataset.recent)];
    if (entry) { urlIn.value = entry.url; fetchInfo(entry.url); }
  };
  const onLater = (e) => {
    if (e.target.id === 'clearLater') {
      watchLaterList().forEach((x) => watchLaterRemove(x.url));
      renderLater();
      toast('Watch Later cleared.', { type: 'success', sound: false });
      return;
    }
    const chip = e.target.closest('[data-later]');
    if (!chip) return;
    const entry = watchLaterList()[Number(chip.dataset.later)];
    if (entry) { urlIn.value = entry.url; fetchInfo(entry.url); }
  };
  const onBatchPanelClick = (e) => {
    const t = e.target;
    const bm = t.closest('[data-bmode]');
    if (bm) { opts.mode = bm.dataset.bmode; setPref('mode', opts.mode); return renderBatchPanel(); }
    const bh = t.closest('[data-bh]');
    if (bh) { opts.height = bh.dataset.bh === 'best' ? 'best' : Number(bh.dataset.bh); return renderBatchPanel(); }
    const bc = t.closest('[data-bcontainer]');
    if (bc) { opts.container = bc.dataset.bcontainer; setPref('container', opts.container); return renderBatchPanel(); }
    const ba = t.closest('[data-bafmt]');
    if (ba) { opts.audioFormat = ba.dataset.bafmt; setPref('audioFormat', opts.audioFormat); return renderBatchPanel(); }
    return undefined;
  };
  const onBatchPanelChange = (e) => {
    const t = e.target;
    if (t.id === 'bThumb') { opts.thumbnail = t.checked; setPref('thumbnail', t.checked); }
    else if (t.id === 'bSubs') { opts.subs = t.checked; setPref('subs', t.checked); return renderBatchPanel(); }
    else if (t.id === 'bPlaylist') { opts.playlist = t.checked; }
    else if (t.id === 'bSaver') {
      // Feature 3: data saver sets 480p and no thumbnails; turning it off goes back to the saved choices.
      setPref('dataSaver', t.checked);
      if (t.checked) { opts.height = 480; opts.thumbnail = false; }
      else { opts.height = 'best'; opts.thumbnail = Boolean(prefs.thumbnail); }
      return renderBatchPanel();
    }
    return renderBatchCount();
  };

  // Feature 2: pinned links. Tapping a pinned card loads it; the pin button unpins it.
  const onPinned = (e) => {
    if (root.dataset.suppressClick) return;
    const card = e.target.closest('[data-url]');
    if (!card) return;
    if (e.target.closest('[data-pin]')) {
      const item = pinned().find((x) => x.url === card.dataset.url);
      if (item) togglePin(item);
      renderPinned();
      toast('Unpinned.', { type: 'info', sound: false, timeout: 1600 });
      return;
    }
    if (e.target.closest('[data-open]')) { urlIn.value = card.dataset.url; fetchInfo(card.dataset.url); }
  };

  result.addEventListener('click', onResultClick);
  result.addEventListener('change', onResultChange);
  result.addEventListener('input', onResultInput);
  recentBox.addEventListener('click', onRecent);
  $('#laterBox', root)?.addEventListener('click', onLater);
  $('#batchPanel', root).addEventListener('click', onBatchPanelClick);
  $('#batchPanel', root).addEventListener('change', onBatchPanelChange);
  $('#batchUrls', root).addEventListener('input', renderBatchCount);
  $('#batchGo', root).addEventListener('click', queueAll);
  $('#batchPanel', root).addEventListener('change', (e) => {
    if (e.target.id !== 'bVoice') return;
    opts.audioLang = e.target.value;
    updateBatchSummary();
  });
  $('#batchPanel', root).addEventListener('input', (e) => {
    if (e.target.id === 'bClipStart') opts.clipStart = e.target.value.trim().slice(0, 12);
    if (e.target.id === 'bClipEnd') opts.clipEnd = e.target.value.trim().slice(0, 12);
    if (e.target.id === 'bClipStart' || e.target.id === 'bClipEnd') updateBatchSummary();
  });
  $('#batchErrors', root).addEventListener('click', (e) => {
    if (!e.target.closest('#batchPutBack') || !failedUrls.length) return;
    $('#batchUrls', root).value = failedUrls.join('\n');
    renderBatchCount();
    setBatchErrors([]);
    toast(`${failedUrls.length} link${failedUrls.length === 1 ? '' : 's'} put back. Press Download all to try again.`, { type: 'info' });
  });
  $('#batchImport', root).addEventListener('click', () => $('#batchFile', root).click());
  $('#batchFile', root).addEventListener('change', (e) => { importBatchFile(e.target.files?.[0]); e.target.value = ''; });
  $('#batchClear', root).addEventListener('click', () => { $('#batchUrls', root).value = ''; renderBatchCount(); });
  pinnedBox.addEventListener('click', onPinned);
  const offLongPress = longPressCopy(root); // Feature 8: long-press a card to copy its link
  on('watchLater', renderLater);

  $('#fetchForm', root).addEventListener('submit', (e) => { e.preventDefault(); fetchInfo(urlIn.value); });
  $('#pasteBtn', root).addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return setMsg('The clipboard is empty.', 'err');
      urlIn.value = text.trim();
      fetchInfo(text);
    } catch {
      setMsg('Your browser blocked clipboard access. Paste the link into the box instead.', 'err');
      urlIn.focus();
    }
  });
  $('#clipCheck', root).addEventListener('click', checkClipboard);
  $('#singleTab', root).addEventListener('click', () => setBatchMode(false));
  $('#batchTab', root).addEventListener('click', () => setBatchMode(true));

  renderRecent();
  renderLater();

  // A batch of links handed over from Settings (Data → Import links).
  const pendingBatch = ctx.takePendingBatch();
  if (pendingBatch) {
    setBatchMode(true);
    $('#batchUrls', root).value = pendingBatch;
    renderBatchCount();
    setMsg('Links loaded from your file. Choose a quality, then queue them.');
  }
  // Link handed over from the Search or Music tab, or from the Android share sheet.
  const pending = ctx.takePendingUrl();
  if (pending) {
    urlIn.value = pending;
    fetchInfo(pending);
  } else if (!pendingBatch) {
    urlIn.focus();
  }

  return () => {
    controller?.abort();
    result.removeEventListener('click', onResultClick);
    result.removeEventListener('change', onResultChange);
    result.removeEventListener('input', onResultInput);
    recentBox.removeEventListener('click', onRecent);
    pinnedBox.removeEventListener('click', onPinned);
    offLongPress();
  };
}
