// Small helpers shared by the Settings group pages: switch rows, back link, and saving a server setting.
import { esc, icon, api, toast } from '../core.js';

/** A switch row. checked: boolean. id is the input id the group page listens for. */
export function toggleRow({ id, title, desc = '', checked, aria }) {
  return `
    <div class="toggle-row">
      <div><div class="ttl">${esc(title)}</div>${desc ? `<div class="desc">${esc(desc)}</div>` : ''}</div>
      <label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} aria-label="${esc(aria || title)}"><span></span></label>
    </div>`;
}

/** The "‹ Settings" link at the top of a group page. */
export function backLink() {
  return `<a class="back-link" href="#/settings">${icon('back', 'sm')} Settings</a>`;
}

/** Saves one or more server settings, refreshes the cached settings, and reports the result. */
export async function saveServer(ctx, body, okText) {
  try {
    await api('/api/settings', { method: 'POST', body });
    await ctx.refreshSettings();
    if (okText) toast(okText, { type: 'success', sound: false, timeout: 2400 });
    return true;
  } catch (e) {
    toast(e.message, { type: 'error', title: 'Setting not saved' });
    return false;
  }
}
