// Command console: the same fixed command list as the command line (npm start -- <command>). Shared by the
// Tools tab and Settings → Advanced. Mounts into a container and returns a cleanup function.
import { $, esc, icon, api, toast } from '../core.js';

const CHANGES_SETTINGS = /^(add|set|settings|pause|resume|cancel|retry|retry-failed|clean|delete|clear|update-ytdlp)\b/;

export function mountConsole(container, ctx, { compact = false } = {}) {
  container.innerHTML = `
    <div class="term-wrap" aria-label="Command console">
      <div class="term-out" id="cOut" aria-live="polite">Type a command, or tap one below. Try <b>info</b> or <b>list</b>.</div>
      <form class="term-line" id="cForm" autocomplete="off">
        <span class="term-prompt" aria-hidden="true">vidyra $</span>
        <input id="cIn" type="text" placeholder="add https://… --height=720" aria-label="Command to run" spellcheck="false" autocapitalize="off" autocorrect="off">
        <button class="btn" type="submit" id="cRun">${icon('play', 'sm')}<span>Run</span></button>
      </form>
    </div>
    <div class="term-chips cmd-chips" id="cChips" aria-label="Command shortcuts"></div>
    ${compact ? '' : '<p class="hint" style="margin-top:8px">Everything here also works in Termux with <code>npm start -- &lt;command&gt;</code>.</p>'}`;

  const out = $('#cOut', container);
  const run = $('#cRun', container);
  const chips = $('#cChips', container);

  async function loadCommands() {
    try {
      const list = await api('/api/commands');
      chips.innerHTML = list.map((c) => `<button class="chip" type="button" data-cmd="${esc(c.name)}" title="${esc(c.summary)}">${esc(c.name)}</button>`).join('');
    } catch (e) {
      chips.innerHTML = `<span class="chip-hint">Commands could not be loaded. ${esc(e.message)}</span>`;
    }
  }

  async function runLine(line) {
    const text = String(line || '').trim();
    if (!text) { toast('Type a command first. Try info or list.', { type: 'info' }); return; }
    run.disabled = true;
    out.innerHTML = '';
    out.textContent = 'Running…';
    try {
      const res = await api('/api/command', { method: 'POST', body: { line: text } });
      out.textContent = `$ ${text}\n${res.text || 'Done.'}`;
      if (CHANGES_SETTINGS.test(text)) ctx.refreshSettings?.();
    } catch (e) {
      out.innerHTML = '';
      const err = document.createElement('span');
      err.className = 'err';
      err.textContent = e.message;
      out.append(err);
    } finally {
      run.disabled = false;
    }
  }

  const onChip = (e) => {
    const cmd = e.target.closest('[data-cmd]');
    if (!cmd) return;
    const input = $('#cIn', container);
    input.value = `${cmd.dataset.cmd} `;
    input.focus();
  };
  const onSubmit = (e) => {
    e.preventDefault();
    runLine($('#cIn', container).value);
  };
  chips.addEventListener('click', onChip);
  $('#cForm', container).addEventListener('submit', onSubmit);
  loadCommands();

  return () => {
    chips.removeEventListener('click', onChip);
  };
}
