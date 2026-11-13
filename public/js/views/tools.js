// Tools tab: library and queue statistics, recent history with play buttons, the command console and a link
// to About. Stats and history refresh when a download finishes.
import { $, esc, icon, api, fmtBytes, timeAgo, on, store } from '../core.js';
import { mountConsole } from './console.js';
import { openPlayer } from '../player.js';

function speedText(kbps) {
  const v = Number(kbps) || 0;
  if (!v) return '–';
  return v >= 1024 ? `${(v / 1024).toFixed(1)} MB/s` : `${Math.round(v)} KB/s`;
}

export function mount(root, ctx) {
  root.innerHTML = `
    <section aria-labelledby="tStats">
      <h2 class="section-title" id="tStats">Stats</h2>
      <div class="stat-grid" id="statGrid" style="margin-top:10px" aria-live="polite">
        ${Array.from({ length: 6 }, () => '<div class="stat skel" style="height:72px"></div>').join('')}
      </div>
    </section>

    <section aria-labelledby="tHist" class="stack" style="gap:8px">
      <div class="row between">
        <h2 class="section-title" id="tHist">Recent history</h2>
        <a class="btn btn-sm btn-ghost" href="#/library">${icon('library', 'sm')} Library</a>
      </div>
      <div class="list" id="histList" aria-label="Finished downloads"></div>
      <div id="histEmpty"></div>
    </section>

    <section class="card" aria-labelledby="tConsole">
      <div class="card-head">${icon('cpu')}<h2 id="tConsole">Command console</h2></div>
      <div id="consoleBox"></div>
    </section>

    <section class="card" aria-labelledby="tAbout">
      <div class="card-head">${icon('info')}<h2 id="tAbout">About Vidyra</h2></div>
      <p class="muted small">Version ${esc(store.settings?.brand?.version || '3.0.0')}. Help, questions and credits are on the About page.</p>
      <div class="row" style="margin-top:12px">
        <a class="btn" href="#/about">${icon('help', 'sm')} Open About</a>
      </div>
    </section>`;

  const statGrid = $('#statGrid', root);
  const histList = $('#histList', root);
  const histEmpty = $('#histEmpty', root);
  let stats = null;
  let history = [];
  let doneSeen = -1;
  let token = 0;

  function renderStats() {
    if (!stats) return;
    const cards = [
      { n: stats.totalFiles ?? 0, l: 'Files in library', cls: '' },
      { n: fmtBytes(stats.totalBytes) || '0 B', l: 'Total size', cls: '' },
      { n: stats.doneCount ?? 0, l: 'Completed', cls: 'ok' },
      { n: stats.failedCount ?? 0, l: 'Failed', cls: 'bad' },
      { n: stats.activeCount ?? 0, l: 'Active now', cls: 'active' },
      { n: speedText(stats.averageSpeedKbps), l: 'Average speed', cls: '' },
    ];
    statGrid.innerHTML = cards.map((c) => `<div class="stat ${c.cls}"><div class="n">${esc(c.n)}</div><div class="l">${esc(c.l)}</div></div>`).join('');
  }

  function renderHistory() {
    if (!history.length) {
      histList.innerHTML = '';
      histEmpty.innerHTML = `
        <div class="card empty">
          <div class="badge-ring">${icon('clock')}</div>
          <h3>No history yet</h3>
          <p>Finished downloads appear here, newest first.</p>
        </div>`;
      return;
    }
    histEmpty.innerHTML = '';
    histList.innerHTML = history.map((h) => {
      const when = h.finishedAt ? timeAgo(h.finishedAt) : '';
      const sub = [h.mode === 'audio' ? 'Audio' : 'Video', fmtBytes(h.size), when].filter(Boolean).join(' · ');
      const kind = h.mode === 'audio' ? 'audio' : 'video';
      return `
        <div class="li history-row" data-file="${esc(h.file)}" data-kind="${kind}">
          <div class="li-thumb ico-only">${icon(kind === 'audio' ? 'audio' : 'video')}</div>
          <div class="li-body">
            <div class="li-title">${esc(h.title || h.file || 'Untitled')}</div>
            <div class="li-sub">${esc(sub)}</div>
          </div>
          ${h.file ? `<button class="li-act" type="button" data-play aria-label="Play ${esc(h.title || h.file)}" title="Play">${icon('play', 'sm')}</button>` : ''}
        </div>`;
    }).join('');
  }

  async function refresh() {
    const my = ++token;
    try {
      const [s, h] = await Promise.all([api('/api/stats'), api('/api/history')]);
      if (my !== token) return;
      stats = s;
      history = Array.isArray(h) ? h : [];
      renderStats();
      renderHistory();
    } catch (e) {
      statGrid.innerHTML = `<div class="notice bad" style="grid-column:1/-1"><span class="muted">${esc(e.message)}</span></div>`;
    }
  }

  const onClick = (e) => {
    const btn = e.target.closest('[data-play]');
    if (!btn) return;
    const row = btn.closest('[data-file]');
    if (row?.dataset.file) openPlayer({ name: row.dataset.file, kind: row.dataset.kind });
  };
  histList.addEventListener('click', onClick);

  const cleanupConsole = mountConsole($('#consoleBox', root), ctx, { compact: true });

  // Refresh when the number of finished downloads changes.
  const offJobs = on('jobs', () => {
    const done = [...store.jobs.values()].filter((j) => j.status === 'done').length;
    if (done !== doneSeen) {
      doneSeen = done;
      refresh();
    }
  });
  refresh();

  return () => {
    offJobs();
    cleanupConsole?.();
    histList.removeEventListener('click', onClick);
  };
}
