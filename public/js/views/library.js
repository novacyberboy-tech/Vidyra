// Library tab: everything you downloaded. Play, favourite, rename, share, save to device and delete, one file or
// many (Select or long-press). Export the list as CSV, and clean up leftover files (thumbnails, subtitle files
// and unfinished parts that are no longer needed).
import {
  $, esc, icon, api, fileUrl, fmtBytes, timeAgo, store, on, toast, dialog, confirmDialog, prefs, setPref,
  favouriteNames, setFavourite, csvOf, saveTextFile, saveToDevice, enterItems,
} from '../core.js';
import { fire, animate } from '../fx.js';
import { openPlayer } from '../player.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'video', label: 'Videos', ic: 'video' },
  { id: 'audio', label: 'Audio', ic: 'audio' },
  { id: 'other', label: 'Other' },
  { id: 'fav', label: 'Favourites', ic: 'star' },
];
const SORTS = {
  newest: (a, b) => b.mtime - a.mtime,
  largest: (a, b) => b.size - a.size,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
};
const PREVIEW_LIMIT = 40;
const LONG_PRESS_MS = 500;

/** Files a person sees: finished media and anything else in the folder. Leftovers are cleaned up separately. */
const isShown = (f) => f.role === 'media' || f.role === 'other';

export function mount(root, ctx) {
  let files = [];
  let leftovers = { count: 0, bytes: 0 };
  let freeBytes = null;
  let dir = store.settings?.downloadDir || '';
  let filter = 'all';
  let sort = 'newest';
  let query = '';
  let loadToken = 0;
  let doneSeen = -1;
  let selectMode = false;
  let firstPaint = true;
  const selected = new Set();
  let pressTimer = null;
  let pressed = false;

  root.innerHTML = `
    <section class="card folder-bar" aria-label="Download folder">
      ${icon('folder')}
      <div class="path" id="dirPath" title="${esc(dir)}">${esc(dir || 'Loading folder…')}</div>
      <button class="btn btn-sm" type="button" id="openBtn">${icon('external', 'sm')} Open folder</button>
      <button class="btn btn-sm btn-ghost btn-icon" type="button" id="refreshBtn" aria-label="Refresh library">${icon('refresh', 'sm')}</button>
    </section>
    <div class="lib-stats muted small" id="libStats" aria-live="polite"></div>
    <div id="leftBox"></div>
    <div class="toolbar">
      <div class="input-wrap" style="flex:1 1 0;min-width:0;height:44px">
        ${icon('search', 'sm')}
        <input id="fQ" type="search" placeholder="Filter by name…" aria-label="Filter files by name">
      </div>
      <select id="fSort" class="input" style="flex:0 0 auto;width:150px;height:44px" aria-label="Sort files">
        <option value="newest">Newest first</option>
        <option value="largest">Largest first</option>
        <option value="name">Name A–Z</option>
      </select>
    </div>
    <div class="toolbar" style="justify-content:space-between">
      <div class="seg" role="group" aria-label="File type" id="fSeg">
        ${FILTERS.map((f) => `<button type="button" data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.ic ? icon(f.ic, 'sm') : ''}${f.label}</button>`).join('')}
      </div>
    </div>
    <div class="toolbar">
      <button class="btn btn-sm" type="button" id="selectBtn" aria-pressed="false">${icon('select', 'sm')} Select</button>
      <button class="btn btn-sm btn-ghost" type="button" id="thumbsBtn" aria-pressed="${prefs.libThumbs !== false}">${icon('video', 'sm')} Previews</button>
      <button class="btn btn-sm btn-ghost" type="button" id="csvBtn">${icon('list', 'sm')} Export CSV</button>
    </div>
    <div class="bulk-bar hidden" id="bulkBar" role="toolbar" aria-label="Selected files">
      <span class="muted small grow" id="selCount">0 selected</span>
      <button class="btn btn-sm" type="button" id="bulkSave">${icon('download', 'sm')} Save to device</button>
      <button class="btn btn-sm btn-danger" type="button" id="bulkDelete">${icon('trash', 'sm')} Delete</button>
      <button class="btn btn-sm btn-ghost" type="button" id="bulkClear">Clear</button>
    </div>
    <div id="fStatus" aria-live="polite"></div>
    <section class="file-list" id="fList" aria-label="Files"></section>`;

  const list = $('#fList', root);
  const status = $('#fStatus', root);

  function visible() {
    const q = query.trim().toLowerCase();
    return files
      .filter(isShown)
      .filter((f) => {
        if (filter === 'all') return true;
        if (filter === 'fav') return favouriteNames().includes(f.name);
        return f.kind === filter || (filter === 'other' && f.role === 'other');
      })
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .sort(SORTS[sort]);
  }

  function renderStats() {
    const shown = files.filter(isShown);
    const total = shown.reduce((n, f) => n + f.size, 0);
    const parts = [`${shown.length} file${shown.length === 1 ? '' : 's'}`, fmtBytes(total) || '0 B'];
    if (freeBytes !== null) parts.push(`${fmtBytes(freeBytes)} free on this device`);
    $('#libStats', root).textContent = parts.join(' · ');
  }

  function renderLeftovers() {
    const box = $('#leftBox', root);
    if (!leftovers.count) { box.innerHTML = ''; return; }
    box.innerHTML = `
      <div class="notice info enter leftover" role="status">
        ${icon('info')}
        <div>
          <b>${leftovers.count} leftover file${leftovers.count === 1 ? '' : 's'} · ${fmtBytes(leftovers.bytes)}</b>
          <span class="muted">Thumbnails, subtitle files and unfinished parts. They are not needed, and Retry can restart an unfinished part.</span>
          <div style="margin-top:8px"><button class="btn btn-sm" type="button" id="cleanBtn">${icon('trash', 'sm')} Clean up</button></div>
        </div>
      </div>`;
  }

  function updateBulkBar() {
    const bar = $('#bulkBar', root);
    bar.classList.toggle('hidden', !selected.size);
    $('#selCount', root).textContent = `${selected.size} selected`;
    const selBtn = $('#selectBtn', root);
    selBtn.setAttribute('aria-pressed', String(selectMode));
    selBtn.innerHTML = `${icon('select', 'sm')} ${selectMode ? 'Done' : 'Select'}`;
  }

  function thumbHtml(f, index) {
    if (f.kind === 'video' && prefs.libThumbs !== false && index < PREVIEW_LIMIT) {
      return `<div class="file-thumb kind-video"><video src="${fileUrl(f.name)}#t=0.5" preload="metadata" muted playsinline aria-hidden="true"></video></div>`;
    }
    if (f.kind === 'audio') return `<div class="file-thumb kind-audio" aria-hidden="true">${icon('audio')}</div>`;
    if (f.kind === 'video') return `<div class="file-thumb kind-video" aria-hidden="true">${icon('video')}</div>`;
    return `<div class="file-thumb kind-other" aria-hidden="true">${icon('download')}</div>`;
  }

  function render() {
    renderStats();
    renderLeftovers();
    updateBulkBar();
    const rows = visible();
    if (!files.some(isShown)) {
      list.innerHTML = '';
      status.innerHTML = `
        <div class="card empty enter">
          <div class="badge-ring">${icon('library')}</div>
          <h3>Your library is empty</h3>
          <p>Finished downloads appear here. You can play, save or delete them from this screen.</p>
          <a class="btn btn-primary" href="#/download">${icon('download', 'sm')} Download something</a>
        </div>`;
      return;
    }
    const favs = new Set(favouriteNames());
    status.innerHTML = rows.length ? '' : `<p class="muted" style="text-align:center;padding:18px 0">${filter === 'fav' ? 'No favourites yet. Tap the star on a file to add it.' : 'No files match this filter.'}</p>`;
    list.innerHTML = rows.map((f, i) => {
      const isFav = favs.has(f.name);
      const canPlay = f.kind === 'video' || f.kind === 'audio';
      return `
      <div class="file ${selected.has(f.name) ? 'selected' : ''}" data-name="${esc(f.name)}" data-index="${i}">
        ${selectMode ? `<label class="file-check" title="Select"><input type="checkbox" data-select="${esc(f.name)}" ${selected.has(f.name) ? 'checked' : ''} aria-label="Select ${esc(f.name)}"></label>` : ''}
        ${thumbHtml(f, i)}
        <div class="file-meta">
          <div class="file-name" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="file-sub">${esc(f.ext.toUpperCase())}${f.size ? ` · ${fmtBytes(f.size)}` : ''} · ${timeAgo(f.mtime)}</div>
        </div>
        <div class="file-actions">
          ${canPlay ? `<button class="btn btn-icon btn-ghost" type="button" data-play aria-label="Play ${esc(f.name)}" title="Play">${icon('play', 'sm')}</button>` : ''}
          <button class="btn btn-icon btn-ghost fav-btn" type="button" data-fav aria-pressed="${isFav}" aria-label="${isFav ? 'Remove from favourites' : 'Add to favourites'}" title="Favourite">${icon('star', 'sm')}</button>
          <button class="btn btn-icon btn-ghost" type="button" data-more aria-label="More actions for ${esc(f.name)}" title="More">${icon('chevron', 'sm')}</button>
        </div>
      </div>`;
    }).join('');
  }

  async function load() {
    const token = ++loadToken;
    try {
      const data = await api('/api/files');
      if (token !== loadToken) return;
      dir = data.dir;
      files = data.files;
      freeBytes = data.freeBytes ?? null;
      leftovers = data.leftovers || { count: 0, bytes: 0 };
      $('#dirPath', root).textContent = dir;
      $('#dirPath', root).title = dir;
      // Forget selections for files that no longer exist.
      for (const name of [...selected]) if (!files.some((f) => f.name === name)) selected.delete(name);
      render();
      if (firstPaint) { firstPaint = false; enterItems(list, '.file', 12); }
    } catch (e) {
      status.innerHTML = `<div class="notice bad enter" role="alert">${icon('alert')}<div><b>The library could not be loaded</b><span class="muted">${esc(e.message)}</span></div></div>`;
    }
  }

  // ---------- selection ----------
  function setSelectMode(on) {
    selectMode = on;
    if (!on) selected.clear();
    render();
  }

  function toggleSelect(name) {
    if (selected.has(name)) selected.delete(name); else selected.add(name);
    if (!selectMode) selectMode = true;
    render();
  }

  // ---------- per-file actions ----------
  async function removeFiles(names) {
    const many = names.length > 1;
    const ok = await confirmDialog({
      title: many ? `Delete ${names.length} files?` : 'Delete this file?',
      message: many
        ? 'The selected files will be removed from the download folder. This cannot be undone.'
        : `“${names[0]}” will be removed from your device. This cannot be undone.`,
      ok: many ? 'Delete files' : 'Delete file',
      danger: true,
    });
    if (!ok) return;
    const gone = [];
    for (const name of names) {
      try {
        await api(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
        gone.push(name);
      } catch (err) {
        toast(err.message || `Could not delete ${name}`, { type: 'error' });
      }
    }
    if (gone.length) {
      gone.forEach((n) => {
        selected.delete(n);
        const row = list.querySelector(`[data-name="${CSS.escape(n)}"]`);
        if (row) animate(row, 'delete');
      });
      fire('delete');
      toast(`Deleted ${gone.length} file${gone.length === 1 ? '' : 's'}.`, { type: 'success', sound: false });
      setTimeout(load, 240);
    }
  }

  async function renameFile(name) {
    const body = document.createElement('div');
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    body.innerHTML = `
      <div class="field">
        <label for="renIn">New name (keep the ${esc(ext || 'same')} ending)</label>
        <input id="renIn" class="input" type="text" maxlength="220" value="${esc(name)}" aria-describedby="renErr" spellcheck="false">
        <p class="msg err hidden" id="renErr" role="alert"></p>
      </div>`;
    await dialog({
      title: 'Rename file',
      body,
      actions: [
        { label: 'Cancel', value: false, variant: 'ghost' },
        { label: 'Rename', value: true, variant: 'primary' },
      ],
      onOpen: (modal) => {
        const input = modal.querySelector('#renIn');
        input.focus();
        input.setSelectionRange(0, Math.max(0, name.length - ext.length));
      },
      onAction: async (value, modal) => {
        if (value !== true) return true;
        const to = modal.querySelector('#renIn').value.trim();
        const err = modal.querySelector('#renErr');
        if (!to || to === name) { err.classList.add('hidden'); return true; }
        try {
          await api('/api/files/rename', { method: 'POST', body: { from: name, to } });
          const fav = favouriteNames();
          if (fav.includes(name)) { setFavourite(name, false); setFavourite(to, true); }
          toast('File renamed.', { type: 'success', sound: false, timeout: 2200 });
          load();
          return true;
        } catch (e) {
          // The server explains the 409 (an existing file, or a download still writing this one).
          err.textContent = e.message;
          err.classList.remove('hidden');
          return false;
        }
      },
    });
  }

  async function shareFile(name) {
    const url = `${location.origin}${fileUrl(name)}`;
    if (navigator.share) {
      try { await navigator.share({ title: name, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Paste it to share this file.', { type: 'success', sound: false, timeout: 3000 });
    } catch {
      toast(url, { type: 'info', title: 'Share this link', timeout: 10000 });
    }
  }

  async function saveMany(names) {
    for (const name of names) {
      saveToDevice(name);
      // Browsers handle a short burst of downloads more reliably with a small gap.
      await new Promise((r) => setTimeout(r, 450));
    }
    toast(`Saving ${names.length} file${names.length === 1 ? '' : 's'} to this device.`, { type: 'success', sound: false });
  }

  function openMore(name) {
    const file = files.find((f) => f.name === name);
    if (!file) return;
    const body = document.createElement('div');
    body.innerHTML = `
      <p class="file-name" style="font-weight:650;color:var(--text);overflow-wrap:anywhere;white-space:normal">${esc(name)}</p>
      <div class="stack" style="gap:8px">
        <button class="btn btn-lg btn-ghost" type="button" data-act="rename">${icon('edit', 'sm')} Rename</button>
        <button class="btn btn-lg btn-ghost" type="button" data-act="share">${icon('share', 'sm')} Share</button>
        <button class="btn btn-lg btn-ghost" type="button" data-act="save">${icon('download', 'sm')} Save to this device</button>
        <button class="btn btn-lg btn-ghost btn-danger" type="button" data-act="delete">${icon('trash', 'sm')} Delete</button>
      </div>`;
    dialog({ title: 'File', body, actions: [{ label: 'Close', value: null, variant: 'ghost' }] });
    body.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      document.querySelector('.modal-backdrop')?.querySelector('[data-dismiss]')?.click();
      if (act === 'rename') setTimeout(() => renameFile(name), 140);
      if (act === 'share') shareFile(name);
      if (act === 'save') saveToDevice(name);
      if (act === 'delete') removeFiles([name]);
    });
  }

  function exportCsv() {
    const rows = visible().map((f) => [f.name, f.kind, f.size, new Date(f.mtime).toISOString()]);
    if (!rows.length) { toast('Nothing to export yet.', { type: 'info' }); return; }
    saveTextFile('vidyra-library.csv', csvOf(rows, ['Name', 'Type', 'Size (bytes)', 'Modified (UTC)']), 'text/csv');
    toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}.`, { type: 'success', sound: false });
  }

  async function cleanLeftovers() {
    const ok = await confirmDialog({
      title: 'Clean up leftover files?',
      message: `${leftovers.count} thumbnail, subtitle and unfinished part file${leftovers.count === 1 ? '' : 's'} will be removed. Finished videos and audio are not touched, and downloads in the queue are not affected.`,
      ok: 'Clean up',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api('/api/files/cleanup', { method: 'POST' });
      toast(`Removed ${res.removed} file${res.removed === 1 ? '' : 's'} · ${fmtBytes(res.bytes) || '0 B'} freed.`, { type: 'success', timeout: 3600 });
      load();
    } catch (e) {
      toast(e.message, { type: 'error', title: 'Clean up did not finish' });
    }
  }

  // ---------- events ----------
  const onClick = async (e) => {
    const seg = e.target.closest('[data-filter]');
    if (seg) {
      filter = seg.dataset.filter;
      root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === seg)));
      return render();
    }
    if (pressed) { pressed = false; return undefined; } // a long press already selected this row
    if (e.target.closest('#cleanBtn')) return cleanLeftovers();
    const row = e.target.closest('[data-name]');
    if (!row) return undefined;
    const name = row.dataset.name;
    const file = files.find((f) => f.name === name);
    if (!file) return undefined;
    // The checkbox handles its own change event; a click on it must not toggle twice.
    if (e.target.closest('.file-check')) return undefined;
    if (selectMode && !e.target.closest('[data-play],[data-fav],[data-more]')) return toggleSelect(name);
    if (e.target.closest('[data-play]')) return openPlayer(file);
    if (e.target.closest('[data-fav]')) {
      const on = !favouriteNames().includes(name);
      setFavourite(name, on);
      fire('select');
      toast(on ? 'Added to favourites.' : 'Removed from favourites.', { type: 'success', sound: false, timeout: 1600 });
      return render();
    }
    if (e.target.closest('[data-more]')) return openMore(name);
    return undefined;
  };

  const onChange = (e) => {
    if (e.target.matches('[data-select]')) {
      toggleSelect(e.target.dataset.select);
    }
  };

  // Long press on a row starts selection with that row.
  const onPointerDown = (e) => {
    const row = e.target.closest('[data-name]');
    if (!row || e.target.closest('button, a, input, label')) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressed = true;
      selectMode = true;
      selected.add(row.dataset.name);
      if (navigator.vibrate) navigator.vibrate(12);
      render();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    clearTimeout(pressTimer);
    // The click that follows a long press is ignored once; clear the flag if no click came.
    setTimeout(() => { pressed = false; }, 350);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  list.addEventListener('pointerdown', onPointerDown);
  list.addEventListener('pointerup', cancelPress);
  list.addEventListener('pointermove', cancelPress);
  list.addEventListener('pointercancel', cancelPress);

  $('#fQ', root).addEventListener('input', (e) => { query = e.target.value; render(); });
  $('#fSort', root).addEventListener('change', (e) => { sort = e.target.value; render(); });
  $('#refreshBtn', root).addEventListener('click', load);
  $('#selectBtn', root).addEventListener('click', () => setSelectMode(!selectMode));
  $('#csvBtn', root).addEventListener('click', exportCsv);
  $('#thumbsBtn', root).addEventListener('click', () => {
    setPref('libThumbs', prefs.libThumbs === false);
    $('#thumbsBtn', root).setAttribute('aria-pressed', String(prefs.libThumbs !== false));
    render();
  });
  $('#bulkClear', root).addEventListener('click', () => { selected.clear(); render(); });
  $('#bulkSave', root).addEventListener('click', () => { if (selected.size) saveMany([...selected]); });
  $('#bulkDelete', root).addEventListener('click', () => { if (selected.size) removeFiles([...selected]); });
  $('#openBtn', root).addEventListener('click', async () => {
    try {
      const res = await api('/api/open-folder', { method: 'POST' });
      toast(res.message || 'Opening the folder', { type: 'success', timeout: 2600, sound: false });
    } catch (e) {
      toast(`${e.message} Folder: ${dir}`, { type: 'info', title: 'Folder location', timeout: 9000 });
    }
  });

  // Reload only when the number of finished downloads changes (not on every progress tick).
  const offJobs = on('jobs', () => {
    const done = [...store.jobs.values()].filter((j) => j.status === 'done').length;
    if (done !== doneSeen) {
      doneSeen = done;
      load();
    }
  });
  load();

  return () => {
    offJobs();
    clearTimeout(pressTimer);
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
