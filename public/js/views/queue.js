// Queue tab: live progress for every download, with pause / resume / cancel / retry / remove.
import {
  $, esc, icon, api, store, on, toast, confirmDialog,
  moodTags, MOODS, buildReceipt, bumpStreak, recordSpeedSample, avgSpeedKbps, streakData,
} from '../core.js';
import { animate } from '../fx.js';

const LABELS = {
  queued: 'Waiting',
  downloading: 'Downloading',
  paused: 'Paused',
  done: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
};
const ORDER = { downloading: 0, paused: 1, queued: 2, error: 3, cancelled: 4, done: 5 };

export function mount(root, ctx) {
  let filter = 'all';
  let qSearch = '';
  const expanded = new Set();

  root.innerHTML = `
    <section class="stats" id="stats" aria-label="Queue summary"></section>
    <div class="queue-filter" role="group" aria-label="Filter queue">
      ${['all', 'active', 'queued', 'done', 'error'].map((f) => `<button type="button" class="chip" data-qfilter="${f}" aria-pressed="${f === 'all'}">${f === 'all' ? 'All' : f === 'active' ? 'Active' : f === 'queued' ? 'Waiting' : f === 'done' ? 'Done' : 'Failed'}</button>`).join('')}
    </div>
    <div class="queue-bulk" role="group" aria-label="Queue controls">
      <button class="btn btn-sm" type="button" id="pauseAllBtn">${icon('pause', 'sm')} Pause all</button>
      <button class="btn btn-sm" type="button" id="resumeAllBtn">${icon('play', 'sm')} Resume all</button>
    </div>
    <div class="toolbar">
      <div class="input-wrap" style="flex:1;min-width:0;height:40px">
        ${icon('search', 'sm')}
        <input id="qSearch" type="search" placeholder="Filter by title…" aria-label="Filter queue by title">
      </div>
      <button class="btn btn-sm" type="button" id="retryAllBtn" disabled>${icon('refresh', 'sm')} Retry failed</button>
      <button class="btn btn-sm" type="button" id="clearBtn">${icon('trash', 'sm')} Clear finished</button>
      <button class="btn btn-sm btn-ghost" type="button" id="copyErrorsBtn" title="Copy all error messages">${icon('copy', 'sm')} Copy errors</button>
      <button class="btn btn-sm btn-ghost" type="button" id="receiptBtn" title="Copy a text receipt of finished jobs">${icon('list', 'sm')} Receipt</button>
    </div>
    <p class="muted small" id="qHint"></p>
    <p class="muted small" id="streakLine"></p>
    <section id="list" class="stack" aria-live="polite" aria-label="Downloads"></section>`;

  const stats = $('#stats', root);
  const list = $('#list', root);
  const hint = $('#qHint', root);
  let scheduled = 0;

  const isPaused = () => store.settings?.platform === 'win32';
  const matchFilter = (j) => {
    if (filter === 'active') return j.status === 'downloading' || j.status === 'paused';
    if (filter === 'queued') return j.status === 'queued';
    if (filter === 'done') return j.status === 'done';
    if (filter === 'error') return j.status === 'error' || j.status === 'cancelled';
    return true;
  };

  function renderStats(jobs) {
    const count = (names) => jobs.filter((j) => names.includes(j.status)).length;
    stats.innerHTML = `
      <div class="stat active"><div class="n">${count(['downloading', 'paused'])}</div><div class="l">Active</div></div>
      <div class="stat"><div class="n">${count(['queued'])}</div><div class="l">Waiting</div></div>
      <div class="stat ok"><div class="n">${count(['done'])}</div><div class="l">Completed</div></div>
      <div class="stat bad"><div class="n">${count(['error', 'cancelled'])}</div><div class="l">Failed or stopped</div></div>`;
    const max = store.settings?.maxParallel ?? '–';
    const avg = avgSpeedKbps();
    hint.textContent = `Up to ${max} download${max === 1 ? '' : 's'} at a time${avg ? ` · avg ~${avg} KB/s` : ''}. Change limits in Settings.`;
    $('#clearBtn', root).disabled = count(['done', 'error', 'cancelled']) === 0;
    $('#retryAllBtn', root).disabled = count(['error', 'cancelled']) === 0;
    const st = streakData();
    const line = $('#streakLine', root);
    if (line) {
      line.textContent = st.days > 0
        ? `🔥 Download streak: ${st.days} day${st.days === 1 ? '' : 's'} in a row`
        : 'Finish a download today to start a streak.';
    }
    // Sample speeds from active jobs (best-effort parse of "1.2MiB/s" style strings)
    for (const j of jobs) {
      if (j.status === 'downloading' && j.speed) {
        const m = String(j.speed).match(/([\d.]+)\s*([KMG])/i);
        if (m) {
          let kb = parseFloat(m[1]);
          const u = m[2].toUpperCase();
          if (u === 'M') kb *= 1024;
          if (u === 'G') kb *= 1024 * 1024;
          recordSpeedSample(kb);
        }
      }
      if (j.status === 'done') bumpStreak();
    }
  }

  function actionsFor(job) {
    const b = (action, label, ic, variant = '') => `<button class="btn ${variant}" type="button" data-action="${action}" data-id="${job.id}">${icon(ic, 'sm')}<span>${label}</span></button>`;
    switch (job.status) {
      case 'queued': return b('prioritise', 'Move to front', 'up', 'btn-ghost') + b('cancel', 'Cancel', 'x', 'btn-ghost');
      case 'downloading': return (isPaused() ? '' : b('pause', 'Pause', 'pause', 'btn-ghost')) + b('cancel', 'Cancel', 'x', 'btn-ghost btn-danger');
      case 'paused': return b('resume', 'Resume', 'play', 'btn-primary') + b('cancel', 'Cancel', 'x', 'btn-ghost btn-danger');
      case 'done': return b('library', 'Show in library', 'library', 'btn-ghost') + b('remove', 'Remove', 'trash', 'btn-ghost');
      case 'error':
        return b('retry', 'Retry', 'refresh', 'btn-primary') + b('copy-error', 'Copy details', 'copy', 'btn-ghost') + b('remove', 'Remove', 'trash', 'btn-ghost');
      case 'cancelled': return b('retry', 'Retry', 'refresh', 'btn-primary') + b('remove', 'Remove', 'trash', 'btn-ghost');
      default: return '';
    }
  }

  function jobHtml(job, i, animate) {
    const active = job.status === 'downloading' || job.status === 'paused';
    const pct = Math.max(0, Math.min(100, Number(job.percent) || 0));
    const isAudio = job.mode === 'audio';
    const stats = [
      job.status === 'downloading' && job.size ? `<span>Size <b>${esc(job.size)}</b></span>` : '',
      job.status === 'downloading' && job.speed ? `<span>Speed <b>${esc(job.speed)}</b></span>` : '',
      job.status === 'downloading' && job.eta ? `<span>ETA <b>${esc(job.eta)}</b></span>` : '',
      job.status === 'done' && job.file ? `<span class="truncate" style="max-width:100%">${esc(job.file)}</span>` : '',
      job.status === 'queued' && job.retryAt > Date.now() ? `<span>Retrying automatically in <b>${Math.max(1, Math.round((job.retryAt - Date.now()) / 1000))} s</b></span>` : '',
      job.status === 'queued' && !(job.retryAt > Date.now()) ? '<span>Waiting for a free slot</span>' : '',
      job.attempt > 1 ? `<span>Attempt <b>${job.attempt}</b></span>` : '',
      job.deliver && job.status !== 'error' && job.status !== 'cancelled' ? '<span>Then saved to this device</span>' : '',
    ].filter(Boolean).join('');
    const barCls = job.status === 'paused' ? 'paused' : job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : active ? 'live' : '';
    return `
      <article class="card job ${animate ? 'enter' : ''}" style="--i:${Math.min(i, 10)}" data-job="${job.id}">
        <div class="job-head">
          <div class="job-ico ${isAudio ? 'audio' : ''}" aria-hidden="true">${icon(isAudio ? 'audio' : 'video')}</div>
          <div class="job-title">
            <h3 title="${esc(job.title)}">${esc(job.title)}</h3>
            <div class="job-stats"><span>${esc(job.label)}</span>${moodTags()[job.id] ? ` · <span class="mood-pill">${esc(moodTags()[job.id])}</span>` : ''}</div>
          </div>
          <span class="badge badge-${job.status}"><span class="dot"></span>${LABELS[job.status] || job.status}</span>
        </div>
        ${job.status === 'queued' || job.status === 'cancelled' || job.status === 'error' ? '' : `
        <div class="row" style="flex-wrap:nowrap;gap:12px">
          <div class="bar grow ${barCls}" style="--p:${pct}%" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="Progress"><i></i></div>
          <span class="job-pct">${Math.round(pct)}%</span>
        </div>`}
        ${stats ? `<div class="job-stats">${stats}</div>` : ''}
        ${job.error && (job.status === 'error' || job.status === 'cancelled') ? `<div class="job-err">${esc(job.error)}</div>` : ''}
        ${job.deliver && job.status === 'done' && job.file ? `<div class="job-stats"><span>Saved to this device when this page is open</span></div>` : ''}
        ${Array.isArray(job.log) && job.log.length ? `<button type="button" class="btn btn-ghost btn-sm" data-expand="${job.id}" style="margin-top:6px">${expanded.has(job.id) ? 'Hide log' : 'Show log'} (${job.log.length})</button>${expanded.has(job.id) ? `<pre class="job-log">${esc(job.log.slice(-40).join('\n'))}</pre>` : ''}` : ''}
        ${actionsFor(job) ? `<div class="job-actions">${actionsFor(job)}</div>` : ''}
      </article>`;
  }

  let rendered = new Set();
  function render() {
    scheduled = 0;
    const all = [...store.jobs.values()].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || (b.created - a.created));
    renderStats(all);
    const q = qSearch.trim().toLowerCase();
    const jobs = all.filter(matchFilter).filter((j) => !q || String(j.title || '').toLowerCase().includes(q) || String(j.url || '').toLowerCase().includes(q));
    if (!all.length) {
      rendered = new Set();
      list.innerHTML = `
        <div class="card empty enter">
          <div class="badge-ring">${icon('queue')}</div>
          <h3>Nothing in the queue</h3>
          <p>Paste a link on the Download tab and your downloads will appear here with live progress.</p>
          <a class="btn btn-primary" href="#/download">${icon('download', 'sm')} Start a download</a>
        </div>`;
      return;
    }
    if (!jobs.length) {
      list.innerHTML = `<p class="muted" style="text-align:center;padding:18px 0">No downloads match this filter.</p>`;
      return;
    }
    const next = new Set(jobs.map((j) => j.id));
    list.innerHTML = jobs.map((j, i) => jobHtml(j, i, false)).join('');
    list.querySelectorAll('[data-job]').forEach((el) => { if (!rendered.has(el.dataset.job)) animate(el, 'enter'); });
    rendered = next;
  }

  // Coalesce bursts of progress events into one repaint per frame.
  const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(render); };
  const offJobs = on('jobs', schedule);
  render();

  const act = async (action, id, btn) => {
    if (btn) btn.disabled = true;
    try {
      if (action === 'library') return ctx.navigate('library');
      if (action === 'copy-error') {
        const job = store.jobs.get(id);
        const text = [job?.title, job?.label, job?.url, job?.error, ...(job?.log || [])].filter(Boolean).join('\n');
        await navigator.clipboard?.writeText(text);
        toast('Error details copied. Paste them when you ask for help.', { type: 'success', timeout: 3000 });
        return undefined;
      }
      if (action === 'remove') {
        await api(`/api/jobs/${id}`, { method: 'DELETE' });
      } else if (action === 'cancel') {
        const ok = await confirmDialog({ title: 'Cancel this download?', message: 'Partly downloaded data will be left in the folder. You can retry later.', ok: 'Cancel download', danger: true });
        if (!ok) return;
        await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
      } else {
        await api(`/api/jobs/${id}/${action}`, { method: 'POST' });
        if (action === 'retry') toast('The download was queued again.', { type: 'success' });
      }
    } catch (e) {
      toast(e.message, { type: 'error', title: 'That did not work' });
    } finally {
      if (btn) btn.disabled = false;
    }
    return undefined;
  };

  const onClick = (e) => {
    const fbtn = e.target.closest('[data-qfilter]');
    if (fbtn) {
      filter = fbtn.dataset.qfilter;
      root.querySelectorAll('[data-qfilter]').forEach((b) => b.setAttribute('aria-pressed', String(b === fbtn)));
      return render();
    }
    const exp = e.target.closest('[data-expand]');
    if (exp) {
      const id = exp.dataset.expand;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      return render();
    }
    const btn = e.target.closest('[data-action]');
    if (btn) return act(btn.dataset.action, btn.dataset.id, btn);
    return undefined;
  };
  root.addEventListener('click', onClick);
  $('#qSearch', root)?.addEventListener('input', (e) => { qSearch = e.target.value; render(); });
  $('#copyErrorsBtn', root)?.addEventListener('click', async () => {
    const lines = [...store.jobs.values()]
      .filter((j) => j.status === 'error' || j.status === 'cancelled')
      .map((j) => `${j.title}\n${j.url}\n${j.error || ''}\n---`)
      .join('\n');
    if (!lines) return toast('No failed downloads to copy.', { type: 'info' });
    try {
      await navigator.clipboard.writeText(lines);
      toast('Error details copied.', { type: 'success' });
    } catch {
      toast(lines, { type: 'info', title: 'Errors', timeout: 12000 });
    }
  });
  $('#receiptBtn', root)?.addEventListener('click', async () => {
    const jobs = [...store.jobs.values()].filter((j) => j.status === 'done' || j.status === 'error');
    if (!jobs.length) return toast('No finished jobs yet.', { type: 'info' });
    const text = buildReceipt(jobs);
    try {
      await navigator.clipboard.writeText(text);
      toast('Download receipt copied.', { type: 'success' });
    } catch {
      toast(text, { type: 'info', title: 'Receipt', timeout: 15000 });
    }
  });

  // Pause and resume every job at once. Not available on Windows, where the server refuses (501).
  const bulk = async (path, label) => {
    try {
      const { count } = await api(`/api/jobs/${path}`, { method: 'POST' });
      toast(`${label}: ${count} download${count === 1 ? '' : 's'}.`, { type: 'success', sound: false, timeout: 2400 });
    } catch (e) {
      toast(e.message, { type: 'error', title: 'That did not work' });
    }
  };
  $('#pauseAllBtn', root).addEventListener('click', () => bulk('pause-all', 'Paused'));
  $('#resumeAllBtn', root).addEventListener('click', () => bulk('resume-all', 'Resumed'));
  if (store.settings?.platform === 'win32') {
    $('#pauseAllBtn', root).disabled = true;
    $('#resumeAllBtn', root).disabled = true;
    $('#pauseAllBtn', root).title = 'Pause is not available on Windows. Cancel and retry instead.';
  }

  $('#retryAllBtn', root).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { queued } = await api('/api/jobs/retry-failed', { method: 'POST' });
      toast(`${queued} download${queued === 1 ? '' : 's'} queued again.`, { type: 'success', timeout: 2600 });
    } catch (err) {
      toast(err.message, { type: 'error' });
    } finally {
      render();
    }
  });

  $('#clearBtn', root).addEventListener('click', async () => {
    try {
      const { removed } = await api('/api/jobs/clear-finished', { method: 'POST' });
      toast(`Removed ${removed} finished item${removed === 1 ? '' : 's'}.`, { type: 'success', timeout: 2600 });
    } catch (e) {
      toast(e.message, { type: 'error' });
    }
  });

  return () => {
    offJobs();
    cancelAnimationFrame(scheduled);
    root.removeEventListener('click', onClick);
  };
}

