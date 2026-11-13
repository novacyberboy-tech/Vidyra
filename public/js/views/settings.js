// Settings: a list of groups. Each group opens its own page with a back link. This file holds the group list,
// the General, Notifications, Data and About pages. Downloads, Appearance and Advanced have their own files.
import {
  $, esc, icon, api, store, prefs, setPref, resetPrefs, toast, confirmDialog, notificationsSupported, systemNotify,
  effectiveThemeId, THEME_BY_ID, getToken, setToken, saveTextFile, csvOf,
} from '../core.js';
import { previewSound } from '../fx.js';
import { toggleRow, backLink, saveServer } from './settings-common.js';
import * as downloads from './settings-downloads.js';
import * as appearance from './settings-appearance.js';
import * as advanced from './settings-advanced.js';
import * as about from './about.js';

const GROUPS = [
  { heading: 'Basics', items: [{ id: 'general', label: 'General', sub: 'Density, focus mode, haptics, sounds', ic: 'sliders' }] },
  { heading: 'Downloads', items: [{ id: 'downloads', label: 'Downloads', sub: 'Folder, naming, speed, retries, cookies', ic: 'hard-drive' }] },
  { heading: 'Appearance', items: [{ id: 'appearance', label: 'Appearance', sub: 'Themes, accent colours, animations, sounds', ic: 'sparkles' }] },
  { heading: 'Notifications', items: [{ id: 'notifications', label: 'Notifications', sub: 'Background progress and Android alerts', ic: 'bell' }] },
  { heading: 'Advanced & data', items: [
    { id: 'advanced', label: 'Advanced', sub: 'Tools, command console, background, extras', ic: 'cpu' },
    { id: 'data', label: 'Data', sub: 'Export, import, library CSV, link lists', ic: 'shield' },
  ] },
  { heading: 'About', items: [{ id: 'about', label: 'About', sub: 'What Vidyra does, help and credits', ic: 'info' }] },
];

const TITLE = {
  general: 'General', downloads: 'Downloads', appearance: 'Appearance', notifications: 'Notifications',
  advanced: 'Advanced', data: 'Data', about: 'About',
};

function rootHtml() {
  return GROUPS.map((g) => `
    <h2 class="group-heading">${esc(g.heading)}</h2>
    <nav class="group-list" aria-label="${esc(g.heading)}">
      ${g.items.map((it) => `
        <a class="group-row" href="#/settings/${it.id}">
          <span class="gi">${icon(it.ic)}</span>
          <span class="gt"><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></span>
          ${icon('chevron', 'sm chev')}
        </a>`).join('')}
    </nav>`).join('');
}

export function mount(root, ctx) {
  const sub = ctx.sub;
  if (!sub) {
    root.innerHTML = `<p class="muted small">Choose a group. Changes save as you make them.</p>${rootHtml()}`;
    return undefined;
  }
  root.innerHTML = `${backLink()}<div class="settings-stack" id="groupBody"></div>`;
  const body = $('#groupBody', root);
  const page = {
    general: mountGeneral,
    downloads: downloads.mount,
    appearance: appearance.mount,
    notifications: mountNotifications,
    advanced: advanced.mount,
    data: mountData,
    about: (el, c) => about.mount(el, c),
  }[sub];
  return page ? page(body, ctx) : undefined;
}

// ---------- General ----------
function mountGeneral(root, ctx) {
  const current = THEME_BY_ID.get(effectiveThemeId());
  root.innerHTML = `
    <section class="card" aria-labelledby="gGeneral">
      <div class="card-head">${icon('sliders')}<h2 id="gGeneral">General</h2></div>
      <div class="stack" style="gap:16px">
        <div class="toggle-row" style="padding-top:0;border-top:0">
          <div><div class="ttl">Theme</div><div class="desc">${esc(current?.label || 'Night')}${prefs.theme === 'system' ? ' · follows your device' : ''}</div></div>
          <a class="btn btn-sm" href="#/settings/appearance">Change</a>
        </div>
        <div class="field">
          <span class="label">Density</span>
          <div class="seg wide" role="group" aria-label="UI density">
            <button type="button" data-density="comfortable" aria-pressed="${prefs.density !== 'compact'}">Comfortable</button>
            <button type="button" data-density="compact" aria-pressed="${prefs.density === 'compact'}">Compact</button>
          </div>
        </div>
        ${toggleRow({ id: 'pFocus', title: 'Focus mode', desc: 'Hides the side bar and dims the bottom bar. Toggle anytime with F.', checked: prefs.focusMode, aria: 'Focus mode' })}
        ${toggleRow({ id: 'pHaptics', title: 'Haptic feedback', desc: 'Short vibration on key actions when the device supports it.', checked: prefs.haptics, aria: 'Haptic feedback' })}
        <div class="toggle-row">
          <div><div class="ttl">Sounds</div><div class="desc">A short sound when a download finishes or fails. Choose each sound under Appearance.</div></div>
          <button class="btn btn-sm btn-ghost" type="button" id="testSound" aria-label="Play a test sound">${icon('volume', 'sm')}</button>
          <label class="switch"><input type="checkbox" id="pSound" ${prefs.sounds ? 'checked' : ''} aria-label="Sounds"><span></span></label>
        </div>
        ${toggleRow({ id: 'pConfirm', title: 'Confirm before downloading', desc: 'Show a summary and ask once before a file is added to the queue.', checked: prefs.confirmDownloads, aria: 'Confirm before downloading' })}
      </div>
    </section>`;

  const onClick = (e) => {
    const dens = e.target.closest('[data-density]');
    if (!dens) return;
    setPref('density', dens.dataset.density);
    root.querySelectorAll('[data-density]').forEach((b) => b.setAttribute('aria-pressed', String(b === dens)));
  };
  const onChange = (e) => {
    const t = e.target;
    if (t.id === 'pFocus') setPref('focusMode', t.checked);
    if (t.id === 'pHaptics') setPref('haptics', t.checked);
    if (t.id === 'pConfirm') setPref('confirmDownloads', t.checked);
    if (t.id === 'pSound') { setPref('sounds', t.checked); if (t.checked) previewSound('chime-soft'); }
  };
  let soundIndex = 0;
  const onTest = () => {
    const names = ['chime-soft', 'bell-bright', 'pop-soft', 'rise-deep'];
    previewSound(names[soundIndex % names.length]);
    soundIndex += 1;
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  $('#testSound', root).addEventListener('click', onTest);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}

// ---------- Notifications ----------
function mountNotifications(root, ctx) {
  const s = store.settings || {};
  root.innerHTML = `
    <section class="card" aria-labelledby="gNotify">
      <div class="card-head">${icon('bell')}<h2 id="gNotify">Notifications</h2></div>
      ${toggleRow({ id: 'pNotify', title: 'Notify in the background', desc: 'Shows a notification with a progress bar while a download runs in the background, and a message when it finishes. On-screen messages always show.', checked: prefs.notify, aria: 'Notify in the background' })}
      <p class="hint" id="notifyState" style="margin-top:12px"></p>
      ${s.isTermux ? `
      <div class="toggle-row">
        <div><div class="ttl">Android notifications (Termux)</div><div class="desc">One notification per download, with a progress bar that updates on the phone. Needs the Termux:API app and the termux-api package.</div></div>
        <label class="switch"><input type="checkbox" id="pTermux" ${s.termuxNotify ? 'checked' : ''} aria-label="Android notifications through Termux"><span></span></label>
      </div>
      <p class="hint" id="termuxState" style="margin-top:6px"></p>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn btn-sm" type="button" id="testNotify">${icon('bell', 'sm')} Send a test notification</button></div>
    </section>`;

  const renderState = () => {
    const el = $('#notifyState', root);
    if (!notificationsSupported()) {
      el.textContent = 'This browser does not support notifications. Results still appear on screen.';
    } else {
      const perm = Notification.permission;
      el.textContent = perm === 'granted'
        ? 'Notifications are allowed for this browser.'
        : perm === 'denied'
          ? 'Notifications are blocked. Allow them in your browser or site settings to get alerts.'
          : 'Turn the switch on to be asked for permission.';
    }
    const tState = $('#termuxState', root);
    if (tState) {
      tState.textContent = store.settings?.termuxNotifyReady
        ? 'Ready. Progress notifications will appear while downloads run.'
        : 'Install the Termux:API app and run pkg install termux-api to use these notifications.';
    }
  };

  const onChange = async (e) => {
    const t = e.target;
    if (t.id === 'pNotify') {
      if (t.checked && notificationsSupported() && Notification.permission === 'default') {
        const result = await Notification.requestPermission().catch(() => 'denied');
        if (result !== 'granted') t.checked = false;
      }
      if (t.checked && notificationsSupported() && Notification.permission === 'denied') t.checked = false;
      setPref('notify', t.checked);
      renderState();
      if (t.checked && Notification.permission !== 'granted') toast('Notifications are blocked in this browser.', { type: 'error' });
    }
    if (t.id === 'pTermux') {
      const ok = await saveServer(ctx, { termuxNotify: t.checked });
      if (!ok) t.checked = !t.checked;
      renderState();
    }
  };
  const onClick = (e) => {
    if (!e.target.closest('#testNotify')) return;
    if (!notificationsSupported() || Notification.permission !== 'granted') {
      toast('Turn on notifications and allow them first.', { type: 'info' });
      return;
    }
    systemNotify('Vidyra', 'Notifications are working.', 'vidyra-test');
    toast('Test notification sent.', { type: 'success', timeout: 2200 });
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  renderState();
  return () => {
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}

// ---------- Data ----------
function mountData(root, ctx) {
  const token = getToken();
  root.innerHTML = `
    <section class="card" aria-labelledby="dSettings">
      <div class="card-head">${icon('download')}<h2 id="dSettings">Vidyra settings</h2></div>
      <p class="muted small">Export the server settings as a file, or import a file from another install. Secrets such as cookie files and tokens are never exported.</p>
      <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
        <button class="btn" type="button" id="exportSettings">${icon('download', 'sm')} Export settings</button>
        <button class="btn" type="button" id="importSettings">${icon('folder', 'sm')} Import settings</button>
        <input type="file" id="importSettingsFile" accept="application/json,.json" hidden>
      </div>
      <div id="importResult"></div>
    </section>

    <section class="card" aria-labelledby="dLibrary">
      <div class="card-head">${icon('list')}<h2 id="dLibrary">Library and links</h2></div>
      <div class="stack" style="gap:12px">
        <div class="toggle-row" style="padding-top:0;border-top:0">
          <div><div class="ttl">Export library list (CSV)</div><div class="desc">A spreadsheet of every file in the library: name, type, size and date.</div></div>
          <button class="btn btn-sm" type="button" id="exportCsv">${icon('download', 'sm')} Export CSV</button>
        </div>
        <div class="toggle-row">
          <div><div class="ttl">Import links from a text file</div><div class="desc">A .txt file with one link per line. The links open in the batch box on the Video tab.</div></div>
          <button class="btn btn-sm" type="button" id="importLinks">${icon('link', 'sm')} Choose file</button>
          <input type="file" id="importLinksFile" accept="text/plain,.txt" hidden>
        </div>
      </div>
    </section>

    <section class="card" aria-labelledby="dPrefs">
      <div class="card-head">${icon('shield')}<h2 id="dPrefs">Preferences and privacy</h2></div>
      <p class="muted small">Preferences are stored only in this browser. Downloads and the queue stay on the machine that runs Vidyra.</p>
      <div class="row" style="margin-top:14px;flex-wrap:wrap;gap:8px">
        <button class="btn" type="button" id="exportPrefs">${icon('download', 'sm')} Export preferences</button>
        <button class="btn" type="button" id="importPrefs">${icon('folder', 'sm')} Import preferences</button>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
        <button class="btn btn-danger" type="button" id="resetBtn">${icon('refresh', 'sm')} Reset preferences</button>
        ${token ? '<button class="btn btn-ghost" type="button" id="forgetToken">Forget access token</button>' : ''}
      </div>
    </section>`;

  const onClick = async (e) => {
    const t = e.target;
    if (t.closest('#exportSettings')) {
      try {
        const data = await api('/api/settings/export');
        saveTextFile('vidyra-settings.json', JSON.stringify(data, null, 2), 'application/json');
        toast('Settings exported.', { type: 'success', sound: false });
      } catch (err) { toast(err.message, { type: 'error', title: 'Export failed' }); }
      return undefined;
    }
    if (t.closest('#importSettings')) return $('#importSettingsFile', root).click();
    if (t.closest('#exportCsv')) {
      try {
        const data = await api('/api/files');
        const rows = data.files.filter((f) => f.role === 'media' || f.role === 'other')
          .map((f) => [f.name, f.kind, f.size, new Date(f.mtime).toISOString()]);
        if (!rows.length) { toast('The library is empty.', { type: 'info' }); return undefined; }
        saveTextFile('vidyra-library.csv', csvOf(rows, ['Name', 'Type', 'Size (bytes)', 'Modified (UTC)']), 'text/csv');
        toast(`Exported ${rows.length} row${rows.length === 1 ? '' : 's'}.`, { type: 'success', sound: false });
      } catch (err) { toast(err.message, { type: 'error', title: 'Export failed' }); }
      return undefined;
    }
    if (t.closest('#importLinks')) return $('#importLinksFile', root).click();
    if (t.closest('#exportPrefs')) {
      saveTextFile(`vidyra-prefs-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(prefs, null, 2), 'application/json');
      toast('Preferences exported.', { type: 'success', sound: false });
      return undefined;
    }
    if (t.closest('#importPrefs')) return $('#importFile', root).click();
    if (t.closest('#resetBtn')) {
      const ok = await confirmDialog({ title: 'Reset preferences?', message: 'Theme, accent, sounds, animation choices and notification choices go back to their defaults. Your downloads are not affected.', ok: 'Reset', danger: true });
      if (!ok) return undefined;
      resetPrefs();
      toast('Preferences reset.', { type: 'success' });
      ctx.navigate('settings', 'data');
      return undefined;
    }
    if (t.closest('#forgetToken')) {
      setToken('');
      toast('Access token forgotten. You will be asked for it again.', { type: 'info' });
      ctx.navigate('settings', 'data');
    }
    return undefined;
  };

  const onChange = async (e) => {
    const t = e.target;
    if (t.id === 'importSettingsFile') {
      const file = t.files?.[0];
      t.value = '';
      if (!file) return;
      const box = $('#importResult', root);
      try {
        const data = JSON.parse(await file.text());
        const res = await api('/api/settings/import', { method: 'POST', body: data });
        await ctx.refreshSettings();
        const rejected = (res.rejected || []).length;
        box.innerHTML = `
          <div class="notice ${rejected ? 'info' : 'info'} enter" style="margin-top:12px" role="status">
            ${icon('check')}
            <div><b>Settings imported</b>
              <span class="muted">${res.applied.length} applied · ${res.ignored.length} ignored${rejected ? ` · ${rejected} not accepted` : ''}</span>
            </div>
          </div>`;
        toast(`Imported ${res.applied.length} setting${res.applied.length === 1 ? '' : 's'}.`, { type: 'success', sound: false });
      } catch (err) {
        toast(err.message || 'That file is not a Vidyra settings file.', { type: 'error', title: 'Import failed' });
      }
    }
    if (t.id === 'importLinksFile') {
      const file = t.files?.[0];
      t.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const urls = [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l)))];
        if (!urls.length) { toast('No https:// links were found in that file.', { type: 'info' }); return; }
        ctx.setPendingBatch(urls.join('\n'));
        toast(`${urls.length} link${urls.length === 1 ? '' : 's'} loaded.`, { type: 'success', sound: false });
        ctx.navigate('download');
      } catch (err) {
        toast(err.message || 'The file could not be read.', { type: 'error' });
      }
    }
    if (t.id === 'importFile') {
      const file = t.files?.[0];
      t.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || typeof data !== 'object') throw new Error('Invalid preferences file');
        let n = 0;
        Object.keys(data).forEach((k) => { if (k in prefs) { setPref(k, data[k]); n += 1; } });
        toast(`Imported ${n} preference${n === 1 ? '' : 's'}.`, { type: 'success' });
        ctx.navigate('settings', 'data');
      } catch (err) {
        toast(err.message || 'Could not import preferences.', { type: 'error' });
      }
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
