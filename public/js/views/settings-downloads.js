// Settings → Downloads: folder, naming template, limits, free-space guard, cookies and Termux storage.
import { $, esc, icon, api, store, on, toast } from '../core.js';
import { saveServer } from './settings-common.js';

const PRESET_ICON = { download: 'download', video: 'video', music: 'audio', phone: 'phone', folder: 'folder' };
const DEFAULT_NAME = '%(title).100B [%(id)s].%(ext)s';

export function mount(root, ctx) {
  const s = store.settings || {};
  root.innerHTML = `
    <section class="card" aria-labelledby="dFolder">
      <div class="card-head">${icon('folder')}<h2 id="dFolder">Save files to</h2></div>
      <div class="stack" style="gap:16px">
        <div class="codebox" id="curDir" title="Current download folder"></div>
        <div class="field">
          <span class="label">Quick folders</span>
          <div class="preset-grid" id="presets" role="group" aria-label="Quick folders"></div>
        </div>
        <form id="dirForm" class="field" autocomplete="off">
          <label for="dirIn">Custom folder</label>
          <div class="input-row" style="flex-wrap:nowrap">
            <input id="dirIn" class="input mono" placeholder="~/Videos/Vidyra" spellcheck="false" autocapitalize="off">
            <button class="btn" type="submit">Apply</button>
          </div>
          <span class="hint">Use a full path. The folder is created if it does not exist.</span>
        </form>
      </div>
    </section>

    <section class="card" aria-labelledby="dNaming">
      <div class="card-head">${icon('edit')}<h2 id="dNaming">Naming</h2></div>
      <div class="stack" style="gap:16px">
        <form id="nameForm" class="field" autocomplete="off">
          <label for="nameIn">File name template</label>
          <div class="input-row" style="flex-wrap:nowrap">
            <input id="nameIn" class="input mono" placeholder="${DEFAULT_NAME}" spellcheck="false" autocapitalize="off">
            <button class="btn" type="submit">Apply</button>
          </div>
          <span class="hint">Must keep <code>[%(id)s]</code>, so Vidyra can recognise a video that is already in the library. Example: %(uploader)s - %(title)s [%(id)s].%(ext)s</span>
        </form>
        <div class="field">
          <label for="cleanDays">Auto-clean finished queue entries</label>
          <select id="cleanDays" class="input">
            <option value="0">Never</option>
            <option value="1">After 1 day</option>
            <option value="3">After 3 days</option>
            <option value="7">After 7 days</option>
            <option value="14">After 14 days</option>
            <option value="30">After 30 days</option>
          </select>
          <span class="hint">Removes old finished, failed and cancelled items from the Queue list only. Files in the Library stay.</span>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="dLimits">
      <div class="card-head">${icon('gauge')}<h2 id="dLimits">Speed and limits</h2></div>
      <div class="stack" style="gap:16px">
        <div>
          <span class="label" id="parLabel">Simultaneous downloads</span>
          <div class="range-row" style="margin-top:8px">
            <input type="range" class="range" id="maxPar" min="1" max="6" step="1" aria-labelledby="parLabel">
            <span class="range-value" id="maxParVal"></span>
          </div>
        </div>
        <div class="field">
          <label for="fragSel">Connection threads per download</label>
          <select id="fragSel" class="input" aria-describedby="fragHint"></select>
          <span class="hint" id="fragHint">More threads can be faster on fast connections. Lower it if a site rejects requests.</span>
        </div>
        <div class="field">
          <label for="speedSel">Speed limit</label>
          <select id="speedSel" class="input" aria-describedby="speedHint">
            <option value="">Unlimited</option>
            <option value="500K">500 KB/s</option>
            <option value="1M">1 MB/s</option>
            <option value="2M">2 MB/s</option>
            <option value="5M">5 MB/s</option>
            <option value="10M">10 MB/s</option>
          </select>
          <span class="hint" id="speedHint">Keeps downloads from using the whole connection. Applies to downloads that start next.</span>
        </div>
        <div class="field">
          <label for="retrySel">Retry temporary failures</label>
          <select id="retrySel" class="input" aria-describedby="retryHint">
            <option value="0">Never</option>
            <option value="1">Once</option>
            <option value="2">Twice</option>
            <option value="3">Three times</option>
          </select>
          <span class="hint" id="retryHint">Network drops, rate limits and server errors are retried automatically. Private or removed videos are not.</span>
        </div>
        <form id="minFreeForm" class="field" autocomplete="off">
          <label for="minFreeIn">Keep at least this much free space (MB)</label>
          <div class="input-row" style="flex-wrap:nowrap">
            <input id="minFreeIn" class="input" type="number" min="0" max="20000" step="50" inputmode="numeric">
            <button class="btn" type="submit">Apply</button>
          </div>
          <span class="hint">When the download folder has less free space than this, Vidyra asks before it starts a new download. 0 turns the check off.</span>
        </form>
      </div>
    </section>

    <section class="card" aria-labelledby="dCookies">
      <div class="card-head">${icon('shield')}<h2 id="dCookies">Cookies</h2></div>
      <form id="cookiesForm" class="field" autocomplete="off">
        <label for="cookiesIn">Cookies file (private or age-restricted videos)</label>
        <div class="input-row" style="flex-wrap:nowrap">
          <input id="cookiesIn" class="input mono" placeholder="/full/path/to/cookies.txt" spellcheck="false" autocapitalize="off">
          <button class="btn" type="submit">Apply</button>
        </div>
        <span class="hint">Export cookies.txt from your signed-in browser with an extension, then give its full path here. Leave empty to turn it off.</span>
      </form>
      ${s.isTermux ? `
      <div class="toggle-row" style="margin-top:14px">
        <div><div class="ttl">Phone storage access</div><div class="desc">Lets Vidyra save into Downloads and Movies on your phone.</div></div>
        <button class="btn btn-sm" type="button" id="storageBtn">${icon('phone', 'sm')} Grant access</button>
      </div>` : ''}
    </section>`;

  const renderFolder = () => {
    const cur = store.settings;
    if (!cur) return;
    $('#curDir', root).textContent = cur.downloadDir;
    const presets = $('#presets', root);
    const key = `${cur.downloadDir}|${(cur.presets || []).map((p) => p.dir).join(',')}`;
    if (presets.dataset.key !== key) {
      presets.dataset.key = key;
      presets.innerHTML = (cur.presets || []).map((p) => `
        <button type="button" class="preset" data-preset="${esc(p.dir)}" aria-pressed="${cur.downloadDir === p.dir}">
          ${icon(PRESET_ICON[p.icon] || 'folder')}
          <span class="preset-text"><b>${esc(p.label)}</b><small title="${esc(p.dir)}">${esc(p.dir)}</small></span>
        </button>`).join('');
    }
    const max = $('#maxPar', root);
    if (document.activeElement !== max) max.value = String(cur.maxParallel);
    $('#maxParVal', root).textContent = `${cur.maxParallel}×`;
    const fill = (sel, value) => { const el = $(sel, root); if (el && document.activeElement !== el) el.value = value; };
    fill('#speedSel', cur.speedLimit || '');
    fill('#retrySel', String(cur.retries ?? 1));
    fill('#cookiesIn', cur.cookiesFile || '');
    fill('#nameIn', cur.nameTemplate || '');
    fill('#cleanDays', String(cur.autoCleanDays ?? 0));
    fill('#minFreeIn', String(cur.minFreeMb ?? 500));
    const frag = $('#fragSel', root);
    if (!frag.options.length) {
      frag.innerHTML = (cur.fragmentOptions || [1, 2, 4, 8, 16, 24, 32]).map((n) => `<option value="${n}">${n} thread${n === 1 ? '' : 's'}</option>`).join('');
    }
    frag.value = String(cur.concurrentFragments);
  };

  async function applyFolder(dir) {
    try {
      const res = await api('/api/settings', { method: 'POST', body: { downloadDir: dir } });
      toast(res.downloadDir, { type: 'success', title: 'Download folder updated', sound: false });
      await ctx.refreshSettings();
      renderFolder();
    } catch (e) {
      toast(e.message, { type: 'error', title: 'Folder not changed' });
    }
  }

  const onClick = (e) => {
    const preset = e.target.closest('[data-preset]');
    if (preset) applyFolder(preset.dataset.preset);
    if (e.target.closest('#storageBtn')) {
      api('/api/termux/storage-setup', { method: 'POST' })
        .then((res) => toast(res.message, { type: 'info', title: 'Storage permission', timeout: 8000 }))
        .catch((err) => toast(err.message, { type: 'error' }));
    }
  };

  const onChange = async (e) => {
    const t = e.target;
    if (t.id === 'maxPar') {
      $('#maxParVal', root).textContent = `${t.value}×`;
      if (await saveServer(ctx, { maxParallel: Number(t.value) })) toast(`Up to ${t.value} downloads at a time.`, { type: 'success', sound: false, timeout: 2000 });
    }
    if (t.id === 'fragSel') await saveServer(ctx, { concurrentFragments: Number(t.value) });
    if (t.id === 'speedSel') {
      if (await saveServer(ctx, { speedLimit: t.value })) toast(t.value ? `Downloads are limited to ${t.options[t.selectedIndex].text}.` : 'Downloads are not limited.', { type: 'success', sound: false, timeout: 2400 });
    }
    if (t.id === 'retrySel') {
      if (await saveServer(ctx, { retries: Number(t.value) })) toast(`Temporary failures are retried ${t.options[t.selectedIndex].text.toLowerCase()}.`, { type: 'success', sound: false, timeout: 2400 });
    }
    if (t.id === 'cleanDays') {
      if (await saveServer(ctx, { autoCleanDays: Number(t.value) })) {
        toast(Number(t.value) === 0 ? 'Finished queue entries are kept forever.' : `Finished queue entries older than ${t.options[t.selectedIndex].text.toLowerCase()} will be removed.`, { type: 'success', sound: false, timeout: 2800 });
      }
    }
  };

  const onSubmit = async (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.id === 'dirForm') {
      const dir = $('#dirIn', root).value.trim();
      if (!dir) { toast('Type a folder path first.', { type: 'info' }); return; }
      applyFolder(dir);
      return;
    }
    if (form.id === 'cookiesForm') {
      const value = $('#cookiesIn', root).value.trim();
      const res = await saveServer(ctx, { cookiesFile: value });
      if (res) toast(value ? 'Cookies file saved. Private videos can now be read.' : 'Cookies file turned off.', { type: 'success', sound: false });
      return;
    }
    if (form.id === 'nameForm') {
      const value = $('#nameIn', root).value.trim();
      if (value && !value.includes('[%(id)s]')) {
        toast('The template must keep [%(id)s], so Vidyra can match files in the library.', { type: 'error', title: 'Template not saved', timeout: 6000 });
        return;
      }
      const res = await saveServer(ctx, { nameTemplate: value || DEFAULT_NAME });
      if (res) toast('File name template saved.', { type: 'success', sound: false });
      return;
    }
    if (form.id === 'minFreeForm') {
      const mb = Math.max(0, Math.min(20000, Math.round(Number($('#minFreeIn', root).value) || 0)));
      const res = await saveServer(ctx, { minFreeMb: mb });
      if (res) toast(mb ? `Vidyra will ask before starting a download when less than ${mb} MB is free.` : 'Free-space check turned off.', { type: 'success', sound: false, timeout: 3200 });
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  const offSettings = on('settings', renderFolder);
  renderFolder();

  return () => {
    offSettings();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('submit', onSubmit);
  };
}
