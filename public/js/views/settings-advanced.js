// Settings → Advanced: tools (yt-dlp and ffmpeg), the command console, background instructions, yt-dlp
// output and extra arguments, the custom Vidyra features and the install card.
import { $, esc, icon, api, store, on, toast, prefs, setPref } from '../core.js';
import { toggleRow, saveServer } from './settings-common.js';
import { mountConsole } from './console.js';

function installHints(s) {
  if (s.isTermux) return 'pkg install python ffmpeg\npip install -U yt-dlp';
  if (s.isWindows) return 'winget install yt-dlp.yt-dlp\nwinget install Gyan.FFmpeg';
  if (s.platform === 'darwin') return 'brew install yt-dlp ffmpeg';
  return 'sh scripts/setup.sh\n# or: pip install -U yt-dlp  and  sudo apt install ffmpeg';
}

export function mount(root, ctx) {
  root.innerHTML = `
    <section class="card" aria-labelledby="aTools">
      <div class="card-head">${icon('cpu')}<h2 id="aTools">Tools</h2><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" id="recheck">${icon('refresh', 'sm')} Re-check</button></div>
      <div class="settings-grid" id="toolCards" style="gap:12px"></div>
      <div id="toolHints"></div>
    </section>

    <section class="card" aria-labelledby="aConsole">
      <div class="card-head">${icon('list')}<h2 id="aConsole">Command console</h2></div>
      <p class="muted small" style="margin-bottom:12px">The same commands as <code>npm start -- &lt;command&gt;</code>. Try <b>info</b>, <b>list</b> or <b>add</b> with a link.</p>
      <div id="consoleBox"></div>
    </section>

    <section class="card" aria-labelledby="aBg">
      <div class="card-head">${icon('zap')}<h2 id="aBg">Keep downloading in the background</h2></div>
      <p class="muted small">Downloads run on the server, so closing this page does not stop them. Unfinished downloads resume when Vidyra starts again.</p>
      <p class="muted small" style="margin-top:10px">${store.settings?.isTermux
        ? 'On Android, run this in Termux. It keeps the phone awake while Vidyra works:'
        : 'Run this in a terminal on this computer:'}</p>
      <pre class="codebox" style="margin-top:8px">npm start              start in the background
npm start -- status    is it running?
npm start -- stop      stop it</pre>
    </section>

    <section class="card" aria-labelledby="aYt">
      <div class="card-head">${icon('edit')}<h2 id="aYt">yt-dlp options</h2></div>
      <div class="stack" style="gap:16px">
        <form id="templateForm" class="field" autocomplete="off">
          <label for="templateIn">Output template (yt-dlp)</label>
          <div class="input-row" style="flex-wrap:nowrap">
            <input id="templateIn" class="input mono" placeholder="Leave empty for the default" spellcheck="false" autocapitalize="off">
            <button class="btn" type="submit">Apply</button>
          </div>
          <span class="hint">Advanced. A yt-dlp output template. The file name template under Downloads is usually easier.</span>
        </form>
        <form id="extraForm" class="field" autocomplete="off">
          <label for="extraIn">Extra yt-dlp arguments</label>
          <div class="input-row" style="flex-wrap:nowrap">
            <input id="extraIn" class="input mono" placeholder="--no-mtime --write-description" spellcheck="false" autocapitalize="off">
            <button class="btn" type="submit">Apply</button>
          </div>
          <span class="hint">Advanced. Space-separated flags passed to every download. Avoid -o and --.</span>
        </form>
      </div>
    </section>

    <section class="card" aria-labelledby="aFeat">
      <div class="card-head">${icon('sparkles')}<h2 id="aFeat">Custom Vidyra features</h2></div>
      <div class="stack" style="gap:14px">
        ${toggleRow({ id: 'pAutoNight', title: 'Auto night theme', desc: 'When the theme is System, use the dark theme between 20:00 and 07:00 local time.', checked: prefs.autoNightTheme, aria: 'Auto night theme' })}
        ${toggleRow({ id: 'pAdvisor', title: 'Format advisor', desc: 'Suggest audio-only for long videos to save space and bandwidth.', checked: prefs.formatAdvisor !== false, aria: 'Format advisor' })}
        ${toggleRow({ id: 'pStreak', title: 'Download streak', desc: 'Track consecutive days you finish at least one download.', checked: prefs.streakEnabled !== false, aria: 'Download streak' })}
        ${toggleRow({ id: 'pQuiet', title: 'Quiet hours', desc: 'New downloads wait until the quiet window ends. Jobs still queue.', checked: prefs.quietHoursOn, aria: 'Quiet hours' })}
        <div class="field">
          <label>Quiet window (hours, 0–23)</label>
          <div class="input-row" style="gap:8px;flex-wrap:wrap">
            <input id="quietStart" class="input" type="number" min="0" max="23" value="${prefs.quietStart ?? 23}" style="max-width:100px" aria-label="Quiet start hour">
            <span class="muted">to</span>
            <input id="quietEnd" class="input" type="number" min="0" max="23" value="${prefs.quietEnd ?? 7}" style="max-width:100px" aria-label="Quiet end hour">
          </div>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="aInstall">
      <div class="card-head">${icon('phone')}<h2 id="aInstall">Install on your device</h2></div>
      <div id="installBox"></div>
    </section>`;

  const cleanupConsole = mountConsole($('#consoleBox', root), ctx);

  function toolCard(name, t, label, ic) {
    const ok = Boolean(t?.installed);
    return `
      <div class="card tool" style="box-shadow:none;background:var(--surface-2)">
        <div class="tool-head">
          <div class="tool-ico">${icon(ic)}</div>
          <div class="tool-meta"><b>${label}</b><span>${ok ? esc(t.version) : esc(t?.error || 'not found')}</span></div>
          <span class="badge ${ok ? 'badge-ok' : 'badge-bad'}"><span class="dot"></span>${ok ? 'Installed' : 'Missing'}</span>
        </div>
        ${ok && name === 'ytdlp' ? `<div class="row"><button class="btn btn-sm" type="button" id="updateYt">${icon('refresh', 'sm')} Update yt-dlp</button></div>` : ''}
      </div>`;
  }

  function renderTools() {
    const tools = store.tools;
    const s = store.settings || {};
    if (!tools) {
      $('#toolCards', root).innerHTML = '<div class="skel" style="height:90px"></div><div class="skel" style="height:90px"></div>';
      return;
    }
    $('#toolCards', root).innerHTML = toolCard('ytdlp', tools.ytdlp, 'yt-dlp', 'download') + toolCard('ffmpeg', tools.ffmpeg, 'ffmpeg', 'cpu');
    const missing = !tools.ytdlp?.installed || !tools.ffmpeg?.installed;
    $('#toolHints', root).innerHTML = missing ? `
      <div class="notice ${!tools.ytdlp?.installed ? 'bad' : 'info'} enter" style="margin-top:14px">
        ${icon(!tools.ytdlp?.installed ? 'alert' : 'info')}
        <div>
          <b>${!tools.ytdlp?.installed ? 'yt-dlp is required for downloads and search.' : 'ffmpeg is recommended.'}</b>
          <span class="muted">Install it, then press Re-check. Commands for this device:</span>
          <pre class="codebox" style="margin-top:6px">${esc(installHints(s))}</pre>
        </div>
      </div>` : '';
  }

  function renderSettingsFields() {
    const s = store.settings;
    if (!s) return;
    const t = $('#templateIn', root);
    if (document.activeElement !== t) t.value = s.outputTemplate || '';
    const x = $('#extraIn', root);
    if (document.activeElement !== x) x.value = s.extraArgs || '';
  }

  function renderInstall() {
    const box = $('#installBox', root);
    const prompt = ctx.getInstallPrompt();
    box.innerHTML = prompt
      ? `<p class="muted small" style="margin-bottom:14px">Install Vidyra to open it like an app, with its own icon and offline shell.</p><button class="btn btn-primary" type="button" id="installBtn">${icon('download', 'sm')} Install Vidyra</button>`
      : '<p class="muted small">Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>. Vidyra will then open like a normal app.</p>';
  }

  async function updateYt() {
    const btn = $('#updateYt', root);
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
    try {
      const res = await api('/api/tools/ytdlp/update', { method: 'POST' });
      store.tools = res.tools;
      toast(res.ok ? 'yt-dlp is up to date.' : 'The update did not complete.', { type: res.ok ? 'success' : 'error', title: 'yt-dlp', timeout: 6000 });
    } catch (e) {
      toast(e.message, { type: 'error', title: 'Update failed' });
    }
    renderTools();
  }

  async function recheck() {
    const btn = $('#recheck', root);
    btn.disabled = true;
    await ctx.refreshSettings(true);
    renderTools();
    btn.disabled = false;
    toast('Tools checked.', { type: 'info', timeout: 2000, sound: false });
  }

  const onClick = (e) => {
    if (e.target.closest('#updateYt')) return updateYt();
    if (e.target.closest('#recheck')) return recheck();
    if (e.target.closest('#installBtn')) {
      const p = ctx.getInstallPrompt();
      if (!p) return undefined;
      p.prompt();
      p.userChoice.catch(() => null).then((choice) => {
        if (choice?.outcome === 'accepted') toast('Thanks for installing Vidyra!', { type: 'success' });
        ctx.clearInstallPrompt();
      });
    }
    return undefined;
  };

  const onChange = async (e) => {
    const t = e.target;
    if (t.id === 'pAutoNight') setPref('autoNightTheme', t.checked);
    if (t.id === 'pAdvisor') setPref('formatAdvisor', t.checked);
    if (t.id === 'pStreak') setPref('streakEnabled', t.checked);
    if (t.id === 'pQuiet') setPref('quietHoursOn', t.checked);
    if (t.id === 'quietStart' || t.id === 'quietEnd') {
      setPref(t.id === 'quietStart' ? 'quietStart' : 'quietEnd', Math.min(23, Math.max(0, Number(t.value) || 0)));
    }
  };

  const onSubmit = async (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.id === 'templateForm') {
      const value = $('#templateIn', root).value.trim();
      if (await saveServer(ctx, { outputTemplate: value })) toast(value ? 'Output template saved.' : 'Output template reset to default.', { type: 'success', sound: false });
      return;
    }
    if (form.id === 'extraForm') {
      const value = $('#extraIn', root).value.trim();
      if (await saveServer(ctx, { extraArgs: value })) toast(value ? 'Extra yt-dlp arguments saved.' : 'Extra arguments cleared.', { type: 'success', sound: false });
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  const offSettings = on('settings', () => { renderTools(); renderSettingsFields(); });
  renderTools();
  renderSettingsFields();
  renderInstall();
  if (!store.settings) ctx.refreshSettings();

  return () => {
    offSettings();
    cleanupConsole?.();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    root.removeEventListener('submit', onSubmit);
  };
}
