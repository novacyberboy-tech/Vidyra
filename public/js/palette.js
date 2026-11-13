// Command palette (Ctrl+K): jump to any screen or settings group, switch theme or accent, or run a command
// from GET /api/commands. Type to filter, arrow keys to move, Enter to run.
import { api, esc, icon, dialog, setPref, toast, THEMES, ACCENTS } from './core.js';

const VIEWS = [
  { label: 'Video', hint: 'Paste a link', route: 'download', ic: 'download' },
  { label: 'Search', hint: 'Find videos', route: 'search', ic: 'search' },
  { label: 'Music', hint: 'Find songs', route: 'music', ic: 'audio' },
  { label: 'Queue', hint: 'Live progress', route: 'queue', ic: 'queue' },
  { label: 'Tools', hint: 'Stats, history, console', route: 'tools', ic: 'tools' },
  { label: 'Library', hint: 'Your files', route: 'library', ic: 'library' },
  { label: 'Settings', hint: 'Preferences', route: 'settings', ic: 'settings' },
  { label: 'Settings · Downloads', hint: 'Folder, naming, limits', route: 'settings/downloads', ic: 'hard-drive' },
  { label: 'Settings · Appearance', hint: 'Themes, accents, animations', route: 'settings/appearance', ic: 'sparkles' },
  { label: 'Settings · Notifications', hint: 'Alerts', route: 'settings/notifications', ic: 'bell' },
  { label: 'Settings · Data', hint: 'Export and import', route: 'settings/data', ic: 'shield' },
  { label: 'About Vidyra', hint: 'Help and credits', route: 'about', ic: 'info' },
];

/** Builds the list of items for the current filter. Each item has label, hint, ic and run(). */
function itemsFor(ctx, commands) {
  const items = VIEWS.map((v) => ({ label: v.label, hint: v.hint, ic: v.ic, run: () => ctx.navigate(v.route) }));
  for (const t of THEMES) {
    items.push({
      label: `Theme: ${t.label}`,
      hint: t.mode === 'dark' ? 'Dark theme' : 'Light theme',
      ic: t.mode === 'dark' ? 'moon' : 'sun',
      run: () => setPref('theme', t.id),
    });
  }
  for (const a of ACCENTS) {
    items.push({ label: `Accent: ${a.label}`, hint: 'Colour', ic: 'sparkles', run: () => setPref('accent', a.id) });
  }
  items.push({ label: 'Accent: theme default', hint: 'Use the theme colour', ic: 'sparkles', run: () => setPref('accent', 'theme') });
  for (const c of commands) {
    const needsInput = /[<[]/.test(c.usage || '');
    items.push({
      label: `Command: ${c.name}`,
      hint: needsInput ? `${c.summary || ''} (needs input: opens the console)` : (c.summary || 'Run'),
      ic: 'cpu',
      run: async () => {
        if (needsInput) { ctx.navigate('tools'); return; }
        try {
          const res = await api('/api/command', { method: 'POST', body: { line: c.name } });
          toast(String(res.text || 'Done.').slice(0, 300), { type: 'success', title: c.name, timeout: 5000, sound: false });
          ctx.refreshSettings?.();
        } catch (e) {
          toast(e.message, { type: 'error', title: c.name });
        }
      },
    });
  }
  return items;
}

export async function openPalette(ctx) {
  if (document.querySelector('.palette-root')) return;
  let commands = [];
  try { commands = await api('/api/commands'); } catch { /* commands are optional here */ }
  const body = document.createElement('div');
  body.className = 'palette-root';
  body.innerHTML = `
    <div class="input-wrap" style="flex:1 1 auto">
      ${icon('search', 'sm')}
      <input id="palQ" type="search" placeholder="Go to, theme, accent or command…" aria-label="Filter commands" autocomplete="off" spellcheck="false">
    </div>
    <div class="palette-list" id="palList" role="listbox" aria-label="Commands"></div>`;
  const all = itemsFor(ctx, commands);
  let shown = all;
  let index = 0;
  const list = body.querySelector('#palList');

  const paint = () => {
    list.innerHTML = shown.length
      ? shown.map((it, i) => `
        <button type="button" class="palette-item" role="option" data-i="${i}" aria-selected="${i === index}">
          ${icon(it.ic, 'sm')}<span style="min-width:0;flex:1"><span>${esc(it.label)}</span><small>${esc(it.hint || '')}</small></span>
        </button>`).join('')
      : '<p class="muted small" style="padding:10px 12px">Nothing matches. Try another word.</p>';
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  };

  const run = async (i) => {
    const item = shown[i];
    if (!item) return;
    close();
    await item.run();
  };

  let closeFn = null;
  const close = () => { closeFn?.(); };

  const done = dialog({
    title: 'Command palette',
    body,
    dismissible: true,
    actions: [],
    onOpen: (modal, finish) => {
      modal.classList.add('palette');
      closeFn = () => finish(null);
      const input = modal.querySelector('#palQ');
      paint();
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        shown = q ? all.filter((it) => `${it.label} ${it.hint || ''}`.toLowerCase().includes(q)) : all;
        index = 0;
        paint();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(shown.length - 1, index + 1); paint(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); paint(); }
        else if (e.key === 'Enter') { e.preventDefault(); run(index); }
      });
      list.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-i]');
        if (btn) run(Number(btn.dataset.i));
      });
      input.focus();
    },
  });
  await done;
}
