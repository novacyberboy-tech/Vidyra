'use strict';
// Vidyra opening splash. Shown once per browser session; the stages are timed in css/splash.css.
// JS only builds the overlay and handles the end: a leave at 2.6 s, removal at 2.92 s, and a hard
// removal at 3.2 s, so the app is never held back by this screen.

const SEEN_KEY = 'vidyra.splashSeen';
const LEAVE_AT = 2600;   // stage 5 ends (yellow reveal 2.2–2.6 s), then the fade starts
const LEAVE_MS = 320;    // fade-out length
const SIMPLE_MS = 600;   // reduced-motion fade
const HARD_MS = 3200;    // never block the app for longer than this

const MARK = `
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="sp-g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366f1"/>
        <stop offset="1" stop-color="#0891b2"/>
      </linearGradient>
    </defs>
    <rect class="sp-bar b1" x="30" y="22" width="40" height="7" rx="3.5" fill="url(#sp-g)"/>
    <rect class="sp-bar b2" x="37" y="34" width="26" height="7" rx="3.5" fill="url(#sp-g)"/>
    <g class="sp-arrow">
      <path d="M50 44 V68" fill="none" stroke="url(#sp-g)" stroke-width="8" stroke-linecap="round"/>
      <path d="M36 55 L50 69 L64 55" fill="none" stroke="url(#sp-g)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;

function sessionSeen() {
  try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
}

function markSeen() {
  try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* private mode: the splash may repeat, which is fine */ }
}

function wantsSimple() {
  try {
    if (document.documentElement.getAttribute('data-motion') === 'off') return true;
    return Boolean(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { return false; }
}

/**
 * Show the opening splash once per session.
 * @param {{shared?: boolean}} opts shared: true when the page was opened from a share link, so it loads at once.
 */
export function showSplash({ shared = false } = {}) {
  try {
    if (shared || /url=|text=/.test(location.search) || sessionSeen()) return false;
    if (document.getElementById('splash')) return false;
    markSeen();

    const simple = wantsSimple();
    const el = document.createElement('div');
    el.id = 'splash';
    el.className = 'splash' + (simple ? ' is-simple' : '');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <div class="sp-hero">
        <div class="sp-ring"></div>
        <div class="sp-ring r2"></div>
        <div class="sp-circle"></div>
        <div class="sp-card">${MARK}</div>
      </div>
      <div class="sp-word">
        <p class="sp-name">Vidyra</p>
        <p class="sp-tag">Download anything</p>
      </div>
      <div class="sp-reveal"></div>`;

    const status = document.createElement('p');
    status.className = 'splash-sr';
    status.setAttribute('role', 'status');
    status.textContent = 'Vidyra is starting';

    document.body.append(el, status);

    const timers = [];
    let gone = false;

    const done = () => {
      if (gone) return;
      gone = true;
      timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey);
      el.remove();
      status.remove();
    };

    // Fade out, then remove. Pointer events stop at once so a tap cannot reach the app underneath.
    const leave = (quick) => {
      if (gone || el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      if (quick) el.classList.add('is-quick');
      timers.push(setTimeout(done, quick ? 220 : LEAVE_MS));
    };

    const onKey = (e) => { if (e.key === 'Escape') leave(true); };

    el.addEventListener('click', () => leave(true));
    document.addEventListener('keydown', onKey);

    if (simple) timers.push(setTimeout(() => leave(false), SIMPLE_MS - LEAVE_MS));
    else timers.push(setTimeout(() => leave(false), LEAVE_AT));
    timers.push(setTimeout(done, HARD_MS));
    return true;
  } catch (e) {
    // Any failure here must not leave an overlay behind or stop the app.
    document.getElementById('splash')?.remove();
    return false;
  }
}
