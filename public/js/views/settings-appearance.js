// Settings → Appearance: 22 named themes, 12 accent colours, motion on or off, and one animation and one sound
// for each action in the app, with previews. Choices are saved in this browser.
import { $, esc, icon, prefs, setPref, toast, THEMES, ACCENTS, effectiveThemeId, THEME_BY_ID } from '../core.js';
import {
  ACTIONS, ANIMATIONS, SOUND_LABELS, ACTION_DEFAULTS, actionAnimation, actionSound, setActionChoice,
  resetActionChoices, previewAnimation, previewSound,
} from '../fx.js';
import { toggleRow } from './settings-common.js';

const ACTION_LABEL = {
  enter: 'Cards and lists appear',
  press: 'Button and link taps',
  tab: 'Switching tabs',
  success: 'Success message',
  error: 'Error message',
  delete: 'Deleting a file',
  toast: 'Notification message',
  select: 'Selecting or favouriting',
  open: 'Opening a dialog',
  close: 'Closing a dialog',
  queue: 'Added to the queue',
  complete: 'Download finished',
};

const themeCard = (t) => `
  <button type="button" class="theme-card" data-theme-id="${t.id}" aria-pressed="${prefs.theme === t.id}" aria-label="${esc(t.label)} theme">
    <span class="theme-preview" style="--c-bg:${t.c[0]};--c-surface:${t.c[1]};--c-text:${t.c[2]};--c-accent:${t.c[3]}" aria-hidden="true"><i></i></span>
    <span>${esc(t.label)}</span>
    <small>${t.mode === 'dark' ? 'Dark' : 'Light'}</small>
  </button>`;

export function mount(root, ctx) {
  const current = effectiveThemeId();
  const dark = THEMES.filter((t) => t.mode === 'dark');
  const light = THEMES.filter((t) => t.mode === 'light');
  root.innerHTML = `
    <section class="card" aria-labelledby="aTheme">
      <div class="card-head">${icon('sparkles')}<h2 id="aTheme">Theme</h2></div>
      <div class="stack" style="gap:16px">
        <div class="field">
          <span class="label">Follow the device</span>
          <div class="theme-grid" role="group" aria-label="Theme">
            <button type="button" class="theme-card" data-theme-id="system" aria-pressed="${prefs.theme === 'system'}">
              <span class="theme-preview" style="--c-bg:#0b0c10;--c-surface:#15171d;--c-text:#f5f6f8;--c-accent:#FFC61A" aria-hidden="true"><i></i></span>
              <span>System</span><small>Dark or light</small>
            </button>
          </div>
        </div>
        <div class="field">
          <span class="label">Dark themes</span>
          <div class="theme-grid" role="group" aria-label="Dark themes">${dark.map(themeCard).join('')}</div>
        </div>
        <div class="field">
          <span class="label">Light themes</span>
          <div class="theme-grid" role="group" aria-label="Light themes">${light.map(themeCard).join('')}</div>
        </div>
        <p class="hint">Now using <b>${esc(THEME_BY_ID.get(current)?.label || '')}</b>${prefs.theme === 'system' ? ' (from your device)' : ''}.</p>
      </div>
    </section>

    <section class="card" aria-labelledby="aAccent">
      <div class="card-head">${icon('sparkles')}<h2 id="aAccent">Accent colour</h2></div>
      <div class="accent-grid" role="group" aria-label="Accent colour">
        <div class="swatch-wrap">
          <button type="button" class="swatch" data-accent-id="theme" aria-pressed="${prefs.accent === 'theme'}" aria-label="Theme colour" title="Theme colour" style="--c1:var(--accent);--c2:var(--accent-2)"></button>
          <span>Theme</span>
        </div>
        ${ACCENTS.map((a) => `
          <div class="swatch-wrap">
            <button type="button" class="swatch" data-accent-id="${a.id}" aria-pressed="${prefs.accent === a.id}" aria-label="${esc(a.label)}" title="${esc(a.label)}" style="--c1:${a.c1};--c2:${a.c2}"></button>
            <span>${esc(a.label)}</span>
          </div>`).join('')}
      </div>
    </section>

    <section class="card" aria-labelledby="aMotion">
      <div class="card-head">${icon('zap')}<h2 id="aMotion">Motion and sound</h2></div>
      ${toggleRow({ id: 'pMotion', title: 'Animations', desc: 'Smooth transitions, entrances and progress shimmer. Turn off for a calmer, faster feel.', checked: prefs.motion, aria: 'Animations' })}
    </section>

    <section class="card" aria-labelledby="aAnim">
      <div class="card-head">${icon('sparkles')}<h2 id="aAnim">Animations</h2></div>
      <p class="muted small" style="margin-bottom:6px">Choose the animation for each part of the app. Press Preview to see it.</p>
      <div id="animRows">${ACTIONS.map((a) => animRow(a)).join('')}</div>
    </section>

    <section class="card" aria-labelledby="aSounds">
      <div class="card-head">${icon('volume')}<h2 id="aSounds">Sounds</h2></div>
      <p class="muted small" style="margin-bottom:6px">Choose the sound for each part of the app. Sounds play only when Sounds is on in General.</p>
      <div id="soundRows">${ACTIONS.map((a) => soundRow(a)).join('')}</div>
    </section>

    <div class="row" style="justify-content:flex-end">
      <button class="btn btn-danger" type="button" id="resetFx">${icon('refresh', 'sm')} Reset animations and sounds</button>
    </div>`;

  function animRow(action) {
    const value = actionAnimation(action);
    return `
      <div class="action-row" data-action="${action}">
        <div><div class="ttl">${esc(ACTION_LABEL[action] || action)}</div><div class="desc">Default: ${esc(ACTION_DEFAULTS[action].anim)}</div></div>
        <select class="input" data-anim="${action}" aria-label="Animation for ${esc(ACTION_LABEL[action] || action)}">
          ${ANIMATIONS.map((a) => `<option value="${a.id}" ${a.id === value ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
        </select>
        <span class="row" style="gap:8px;justify-content:flex-end"><span class="demo" data-demo="${action}" aria-hidden="true"></span><button class="btn btn-sm" type="button" data-preview-anim="${action}">Preview</button></span>
      </div>`;
  }

  function soundRow(action) {
    const value = actionSound(action);
    return `
      <div class="action-row" data-action="${action}">
        <div><div class="ttl">${esc(ACTION_LABEL[action] || action)}</div><div class="desc">Default: ${esc(ACTION_DEFAULTS[action].sound)}</div></div>
        <select class="input" data-sound="${action}" aria-label="Sound for ${esc(ACTION_LABEL[action] || action)}">
          ${SOUND_LABELS.map((s) => `<option value="${s.id}" ${s.id === value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select>
        <span class="row" style="gap:8px;justify-content:flex-end"><button class="btn btn-sm" type="button" data-preview-sound="${action}">${icon('volume', 'sm')} Preview</button></span>
      </div>`;
  }

  const paintSelection = () => {
    root.querySelectorAll('[data-theme-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeId === prefs.theme)));
    root.querySelectorAll('[data-accent-id]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.accentId === prefs.accent)));
  };

  const onClick = (e) => {
    const t = e.target;
    const themeBtn = t.closest('[data-theme-id]');
    if (themeBtn) { setPref('theme', themeBtn.dataset.themeId); paintSelection(); return; }
    const accentBtn = t.closest('[data-accent-id]');
    if (accentBtn) { setPref('accent', accentBtn.dataset.accentId); paintSelection(); return; }
    const pa = t.closest('[data-preview-anim]');
    if (pa) {
      const action = pa.dataset.previewAnim;
      const select = root.querySelector(`[data-anim="${action}"]`);
      const demo = root.querySelector(`[data-demo="${action}"]`);
      previewAnimation(select.value, demo);
      return;
    }
    const ps = t.closest('[data-preview-sound]');
    if (ps) {
      const select = root.querySelector(`[data-sound="${ps.dataset.previewSound}"]`);
      previewSound(select.value);
      return;
    }
    if (t.closest('#resetFx')) {
      resetActionChoices();
      root.querySelectorAll('[data-anim]').forEach((s) => { s.value = actionAnimation(s.dataset.anim); });
      root.querySelectorAll('[data-sound]').forEach((s) => { s.value = actionSound(s.dataset.sound); });
      toast('Animations and sounds are back to the defaults.', { type: 'success', sound: false, timeout: 2600 });
    }
  };

  const onChange = (e) => {
    const t = e.target;
    if (t.id === 'pMotion') setPref('motion', t.checked);
    if (t.dataset.anim) setActionChoice(t.dataset.anim, { anim: t.value });
    if (t.dataset.sound) setActionChoice(t.dataset.sound, { sound: t.value });
  };

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  };
}
