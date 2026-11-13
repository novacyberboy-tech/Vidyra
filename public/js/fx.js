// Vidyra sound and animation library.
// Sounds are synthesized with Web Audio from the pattern and variant tables below.
// Animations are CSS keyframes generated from the animation table.
// No imports and no DOM access at load time, so node can import this module.

const PREFS_KEY = 'vidyra.prefs';
const FX_KEY = 'vidyra.fx';
const STYLE_ID = 'fx-anims';
const G = typeof globalThis !== 'undefined' ? globalThis : {};

// ---------- Sound tables ----------
// Pattern = the shape of a sound. kinds: tone, arp (notes in turn), bell (tone + overtone),
// sweep (pitch glide from -> to), noise (filtered noise glide).
export const SOUND_PATTERNS = [
  { id: 'chime', label: 'Chime', kind: 'arp', freqs: [880, 1320, 1760], step: 0.085, dur: 0.5 },
  { id: 'bell', label: 'Bell', kind: 'bell', freq: 660, dur: 1.1 },
  { id: 'pop', label: 'Pop', kind: 'sweep', from: 640, to: 240, dur: 0.09 },
  { id: 'tick', label: 'Tick', kind: 'sweep', from: 1800, to: 1500, dur: 0.03 },
  { id: 'drop', label: 'Drop', kind: 'sweep', from: 990, to: 220, dur: 0.42 },
  { id: 'rise', label: 'Rise', kind: 'sweep', from: 220, to: 990, dur: 0.42 },
  { id: 'fall', label: 'Fall', kind: 'sweep', from: 660, to: 330, dur: 0.32 },
  { id: 'blip', label: 'Blip', kind: 'sweep', from: 520, to: 560, dur: 0.07 },
  { id: 'swoosh', label: 'Swoosh', kind: 'noise', from: 400, to: 2400, dur: 0.35 },
  { id: 'ping', label: 'Ping', kind: 'tone', freq: 1046, dur: 0.6 },
];

// Variant = the timbre and feel. gain stays at or below 0.15 per tone.
export const SOUND_VARIANTS = [
  { id: 'soft', label: 'Soft', wave: 'sine', gain: 0.07, pitch: 1, len: 1.2 },
  { id: 'bright', label: 'Bright', wave: 'triangle', gain: 0.1, pitch: 1.5, len: 0.8 },
  { id: 'deep', label: 'Deep', wave: 'sine', gain: 0.12, pitch: 0.5, len: 1.4 },
  { id: 'bubbly', label: 'Bubbly', wave: 'sine', gain: 0.09, pitch: 1.25, len: 0.7, wobble: 0.03 },
  { id: 'retro', label: 'Retro', wave: 'square', gain: 0.05, pitch: 1, len: 0.8, lowpass: 1800 },
];

// Every pattern x variant pair is one named sound, e.g. 'chime-soft' / 'Chime · Soft'.
export const SOUND_LABELS = SOUND_PATTERNS.flatMap((p) =>
  SOUND_VARIANTS.map((v) => ({ id: `${p.id}-${v.id}`, label: `${p.label} · ${v.label}` })));
const SOUND_BY_ID = new Map(SOUND_PATTERNS.flatMap((p) =>
  SOUND_VARIANTS.map((v) => [`${p.id}-${v.id}`, { p, v }])));

// ---------- Animation tables ----------
// State keys: x, y (px), s (scale), r (deg), rx, ry (flip deg), o (opacity), blur (px), glow (rgb).
// `from` is the start state, `mid` (optional) is the state at 60%, and the end is the identity state.
const EASINGS = {
  out: 'cubic-bezier(.2,.8,.2,1)',
  back: 'cubic-bezier(.34,1.56,.64,1)',
  io: 'cubic-bezier(.45,0,.25,1)',
  in: 'cubic-bezier(.5,0,.8,.4)',
};

const ANIM_DEFS = [
  // Slides
  { id: 'rise', label: 'Rise', ms: 420, ease: 'out', from: { y: 24, o: 0 } },
  { id: 'drop', label: 'Drop', ms: 420, ease: 'out', from: { y: -24, o: 0 } },
  { id: 'slide-left', label: 'Slide Left', ms: 380, ease: 'out', from: { x: -32, o: 0 } },
  { id: 'slide-right', label: 'Slide Right', ms: 380, ease: 'out', from: { x: 32, o: 0 } },
  { id: 'slide-up-far', label: 'Slide Up Far', ms: 600, ease: 'out', from: { y: 60, o: 0 } },
  { id: 'slide-down-far', label: 'Slide Down Far', ms: 600, ease: 'out', from: { y: -60, o: 0 } },
  { id: 'nudge-left', label: 'Nudge Left', ms: 260, ease: 'out', from: { x: -8, o: 0.4 } },
  { id: 'nudge-right', label: 'Nudge Right', ms: 260, ease: 'out', from: { x: 8, o: 0.4 } },
  { id: 'float-up', label: 'Float Up', ms: 900, ease: 'io', from: { y: 12, o: 0 } },
  { id: 'drift-fade', label: 'Drift Fade', ms: 1100, ease: 'io', from: { x: 20, y: -6, o: 0 } },
  // Scale
  { id: 'pop', label: 'Pop', ms: 260, ease: 'back', from: { s: 0.8, o: 0 } },
  { id: 'pop-bounce', label: 'Pop Bounce', ms: 500, ease: 'back', from: { s: 0.6, o: 0 }, mid: { s: 1.08 } },
  { id: 'grow', label: 'Grow', ms: 350, ease: 'out', from: { s: 0.92, o: 0 } },
  { id: 'zoom-out', label: 'Zoom Out', ms: 350, ease: 'out', from: { s: 1.12, o: 0 } },
  { id: 'settle', label: 'Settle', ms: 300, ease: 'out', from: { s: 1.15 } },
  { id: 'mini-pop', label: 'Mini Pop', ms: 180, ease: 'out', from: { s: 0.9 } },
  { id: 'big-pop', label: 'Big Pop', ms: 450, ease: 'back', from: { s: 0.4, o: 0 } },
  { id: 'jelly', label: 'Jelly', ms: 650, ease: 'io', from: { s: 0.7 }, mid: { s: 1.1 } },
  // Rotation and flips
  { id: 'spin-in', label: 'Spin In', ms: 600, ease: 'out', from: { r: -180, s: 0.5, o: 0 } },
  { id: 'spin-quarter', label: 'Spin Quarter', ms: 400, ease: 'out', from: { r: -90 } },
  { id: 'pop-spin', label: 'Pop Spin', ms: 480, ease: 'back', from: { r: -45, s: 0.5, o: 0 } },
  { id: 'flip-x', label: 'Flip X', ms: 500, ease: 'out', from: { rx: -90, o: 0 } },
  { id: 'flip-y', label: 'Flip Y', ms: 500, ease: 'out', from: { ry: -90, o: 0 } },
  { id: 'unfold', label: 'Unfold', ms: 500, ease: 'out', from: { ry: 70, o: 0 } },
  { id: 'fold-in', label: 'Fold In', ms: 500, ease: 'out', from: { rx: 70, o: 0 } },
  { id: 'tilt-in', label: 'Tilt In', ms: 300, ease: 'out', from: { r: -8, x: -12 } },
  { id: 'tilt-right', label: 'Tilt Right', ms: 300, ease: 'out', from: { r: 8, x: 12 } },
  { id: 'swing-in', label: 'Swing In', ms: 500, ease: 'io', from: { r: 12, y: -10 }, mid: { r: -6 } },
  { id: 'wobble-in', label: 'Wobble In', ms: 520, ease: 'io', from: { r: 6 }, mid: { r: -4 } },
  { id: 'roll-in', label: 'Roll In', ms: 600, ease: 'out', from: { x: -40, r: -120, o: 0 } },
  // Fades
  { id: 'fade', label: 'Fade', ms: 300, ease: 'out', from: { o: 0 } },
  { id: 'fade-slow', label: 'Fade Slow', ms: 900, ease: 'in', from: { o: 0 } },
  { id: 'fade-soft', label: 'Fade Soft', ms: 400, ease: 'out', from: { o: 0.3 } },
  { id: 'fade-rise-soft', label: 'Fade Rise Soft', ms: 350, ease: 'out', from: { y: 8, o: 0 } },
  { id: 'fade-scale-soft', label: 'Fade Scale Soft', ms: 280, ease: 'out', from: { s: 0.97, o: 0 } },
  // Blur
  { id: 'blur-in', label: 'Blur In', ms: 450, ease: 'out', from: { blur: 8, o: 0 } },
  { id: 'blur-rise', label: 'Blur Rise', ms: 500, ease: 'out', from: { blur: 6, y: 12, o: 0 } },
  { id: 'blur-sharp', label: 'Blur Sharp', ms: 700, ease: 'out', from: { blur: 12, s: 1.03, o: 0 } },
  { id: 'blur-pop', label: 'Blur Pop', ms: 320, ease: 'back', from: { blur: 4, s: 0.9, o: 0 } },
  // Glow (soft coloured halo that fades out once)
  { id: 'glow-in', label: 'Glow In', ms: 600, ease: 'out', from: { glow: '120,140,255', o: 0 } },
  { id: 'glow-warm', label: 'Glow Warm', ms: 600, ease: 'out', from: { glow: '255,180,80', o: 0 } },
  { id: 'glow-green', label: 'Glow Green', ms: 600, ease: 'out', from: { glow: '80,220,140' } },
  { id: 'glow-red', label: 'Glow Red', ms: 600, ease: 'out', from: { glow: '255,90,90' } },
  { id: 'glow-violet', label: 'Glow Violet', ms: 600, ease: 'out', from: { glow: '170,120,255' } },
  { id: 'glow-pop', label: 'Glow Pop', ms: 500, ease: 'back', from: { glow: '120,140,255', s: 0.95 } },
  { id: 'glow-slide', label: 'Glow Slide', ms: 500, ease: 'out', from: { glow: '120,140,255', x: -12 } },
  { id: 'glow-rise', label: 'Glow Rise', ms: 500, ease: 'out', from: { glow: '120,140,255', y: 10 } },
  // Combinations
  { id: 'rise-tilt', label: 'Rise Tilt', ms: 450, ease: 'out', from: { y: 16, r: -3 } },
  { id: 'slide-scale', label: 'Slide Scale', ms: 420, ease: 'out', from: { x: 24, s: 0.95, o: 0 } },
  { id: 'corner-in', label: 'Corner In', ms: 500, ease: 'out', from: { x: 40, y: 40, s: 0.8, o: 0 } },
  { id: 'corner-out', label: 'Corner Out', ms: 500, ease: 'out', from: { x: -40, y: -40, s: 0.8, o: 0 } },
  { id: 'shake-in', label: 'Shake In', ms: 420, ease: 'io', from: { x: -10 }, mid: { x: 8 } },
  { id: 'hop', label: 'Hop', ms: 520, ease: 'out', from: { y: 10 }, mid: { y: -6 } },
  { id: 'soft-bounce', label: 'Soft Bounce', ms: 600, ease: 'back', from: { y: -14 }, mid: { y: 3 } },
];

const IDENTITY = { x: 0, y: 0, s: 1, r: 0, rx: 0, ry: 0, o: 1, blur: 0, glow: null };

export const ANIMATIONS = ANIM_DEFS.map(({ id, label }) => ({ id, label }));
const ANIM_BY_ID = new Map(ANIM_DEFS.map((a) => [a.id, a]));

// ---------- Action mapping ----------
export const ACTIONS = ['enter', 'press', 'tab', 'success', 'error', 'delete',
  'toast', 'select', 'open', 'close', 'queue', 'complete'];

// Default animation and sound for each action. Both ids must exist in the tables above.
export const ACTION_DEFAULTS = {
  enter: { anim: 'rise', sound: 'rise-soft' },
  press: { anim: 'pop', sound: 'tick-soft' },
  tab: { anim: 'fade-soft', sound: 'blip-soft' },
  success: { anim: 'glow-green', sound: 'chime-bright' },
  error: { anim: 'shake-in', sound: 'fall-deep' },
  delete: { anim: 'fade-scale-soft', sound: 'drop-deep' },
  toast: { anim: 'slide-right', sound: 'pop-soft' },
  select: { anim: 'mini-pop', sound: 'blip-bright' },
  open: { anim: 'unfold', sound: 'swoosh-soft' },
  close: { anim: 'fade', sound: 'fall-soft' },
  queue: { anim: 'float-up', sound: 'ping-soft' },
  complete: { anim: 'jelly', sound: 'bell-bright' },
};

// ---------- Settings and storage (all guarded) ----------
function readJson(key) {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

const isObject = (v) => !!v && typeof v === 'object';

function soundsOn() {
  return readJson(PREFS_KEY).sounds !== false;
}

function motionOn() {
  if (readJson(PREFS_KEY).motion === false) return false;
  try {
    return document.documentElement?.getAttribute('data-motion') !== 'off';
  } catch {
    return true; // no DOM (node) or no attribute: motion stays on
  }
}

// ---------- Web Audio ----------
let audio = null;      // shared AudioContext, created on first use
let noiseBuf = null;   // shared white-noise buffer for the swoosh sounds
let noiseCtx = null;

function getAudio() {
  try {
    if (audio) return audio;
    const Ctor = G.AudioContext || G.webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
    return audio;
  } catch {
    return null;
  }
}

// Browsers keep audio suspended until a user gesture; resume on the first one.
let unlockBound = false;
function unlockOnGesture() {
  if (unlockBound || typeof document === 'undefined') return;
  unlockBound = true;
  const unlock = () => {
    if (!soundsOn()) return;
    const c = getAudio();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  ['pointerdown', 'keydown', 'touchend'].forEach((t) =>
    document.addEventListener(t, unlock, { capture: true, passive: true }));
}

function envelope(g, gain, start, dur) {
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
}

function playTone(c, o) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, o.start);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, o.start + o.dur);
  envelope(g, o.gain, o.start, o.dur);
  let src = osc;
  if (o.lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    osc.connect(f);
    src = f;
  }
  src.connect(g);
  g.connect(o.out);
  if (o.wobble) { // slow vibrato on the pitch
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 9;
    depth.gain.value = o.f0 * o.wobble;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(o.start);
    lfo.stop(o.start + o.dur + 0.05);
  }
  osc.start(o.start);
  osc.stop(o.start + o.dur + 0.05);
}

function playNoise(c, o) {
  if (!noiseBuf || noiseCtx !== c) {
    noiseCtx = c;
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(o.from, o.start);
  bp.frequency.exponentialRampToValueAtTime(o.to, o.start + o.dur);
  const g = c.createGain();
  envelope(g, o.gain * 0.8, o.start, o.dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(o.out);
  src.start(o.start, 0, o.dur + 0.05);
}

// Build one sound from its pattern and variant.
function buildSound(c, { p, v }, start) {
  const len = p.dur * v.len;
  const base = { type: v.wave, gain: v.gain, lowpass: v.lowpass, wobble: v.wobble, out: c.destination, start };
  switch (p.kind) {
    case 'arp':
      p.freqs.forEach((f, i) => playTone(c, { ...base, f0: f * v.pitch, dur: len, start: start + i * p.step }));
      break;
    case 'bell':
      playTone(c, { ...base, f0: p.freq * v.pitch, dur: len });
      playTone(c, { ...base, f0: p.freq * v.pitch * 2.76, gain: v.gain * 0.35, dur: len * 0.5 });
      break;
    case 'sweep':
      playTone(c, { ...base, f0: p.from * v.pitch, f1: p.to * v.pitch, dur: len });
      break;
    case 'noise':
      playNoise(c, { ...base, from: p.from, to: p.to, dur: len });
      break;
    default:
      playTone(c, { ...base, f0: p.freq * v.pitch, dur: len });
  }
}

function playNow(id) {
  const entry = SOUND_BY_ID.get(id);
  const c = getAudio();
  if (!entry || !c) return;
  unlockOnGesture();
  if (c.state === 'suspended') c.resume().catch(() => {});
  buildSound(c, entry, c.currentTime + 0.01);
}

// Play a sound if sounds are enabled in prefs. Never throws.
export function playSound(id) {
  try {
    if (soundsOn()) playNow(id);
  } catch { /* audio unavailable */ }
}

// Audition a sound from the settings UI. Plays even when sounds are off, since the user asked for it.
export function previewSound(id) {
  try { playNow(id); } catch { /* audio unavailable */ }
}

// ---------- Action choices ----------
function storedChoice(action) {
  const actions = readJson(FX_KEY).actions;
  const choice = isObject(actions) ? actions[action] : null;
  return isObject(choice) ? choice : {};
}

export function actionSound(action) {
  const d = ACTION_DEFAULTS[action];
  if (!d) return null;
  const s = storedChoice(action).sound;
  return SOUND_BY_ID.has(s) ? s : d.sound;
}

export function actionAnimation(action) {
  const d = ACTION_DEFAULTS[action];
  if (!d) return null;
  const a = storedChoice(action).anim;
  return ANIM_BY_ID.has(a) ? a : d.anim;
}

// Save the user's animation and sound for one action. Invalid ids are ignored.
export function setActionChoice(action, choice) {
  if (!ACTION_DEFAULTS[action]) return;
  const next = {};
  if (ANIM_BY_ID.has(choice?.anim)) next.anim = choice.anim;
  if (SOUND_BY_ID.has(choice?.sound)) next.sound = choice.sound;
  const store = readJson(FX_KEY);
  const actions = isObject(store.actions) ? { ...store.actions } : {};
  actions[action] = { ...storedChoice(action), ...next };
  writeJson(FX_KEY, { actions });
}

// Forget all custom choices so every action uses its default again.
export function resetActionChoices() {
  writeJson(FX_KEY, { actions: {} });
}

// Play the sound chosen for an action.
export function fire(action) {
  const s = actionSound(action);
  if (s) playSound(s);
}

// ---------- Animations ----------
function transformOf(s) {
  return `perspective(800px) translate(${s.x}px, ${s.y}px) scale(${s.s}) rotate(${s.r}deg) ` +
    `rotateX(${s.rx}deg) rotateY(${s.ry}deg)`;
}

// Glow is a soft halo that fades out. Blur is a filter that clears up.
function frameCss(s, color, glowOn, hasBlur, hasGlow) {
  let css = `transform: ${transformOf(s)}; opacity: ${s.o};`;
  if (hasBlur) css += ` filter: blur(${s.blur}px);`;
  if (hasGlow) {
    css += glowOn
      ? ` box-shadow: 0 0 22px 4px rgba(${color}, .55);`
      : ` box-shadow: 0 0 0 0 rgba(${color}, 0);`;
  }
  return css;
}

function keyframeBlock(a) {
  const from = { ...IDENTITY, ...a.from };
  const hasBlur = !!a.from.blur;
  const hasGlow = !!a.from.glow;
  const color = a.from.glow || '0,0,0';
  const frames = [`0% { ${frameCss(from, color, true, hasBlur, hasGlow)} }`];
  if (a.mid) {
    const mid = { ...IDENTITY, ...a.mid, glow: from.glow };
    frames.push(`60% { ${frameCss(mid, color, true, hasBlur, hasGlow)} }`);
  }
  frames.push(`100% { ${frameCss(IDENTITY, color, false, hasBlur, hasGlow)} }`);
  const name = `fx-${a.id}`;
  return `@keyframes ${name} {\n  ${frames.join('\n  ')}\n}\n` +
    `.${name} { animation: ${name} ${a.ms}ms ${EASINGS[a.ease]} both; }`;
}

// One CSS string with a @keyframes block and a class rule for every animation.
export function keyframesCss() {
  return ANIM_DEFS.map(keyframeBlock).join('\n\n');
}

// Inject the keyframes once into <head>. No-op outside a browser.
export function installAnimations() {
  try {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = keyframesCss();
    document.head.appendChild(style);
  } catch { /* no DOM */ }
}

// Run one animation class on an element and remove it when that animation ends.
function runAnimation(el, name) {
  installAnimations();
  const cls = `fx-${name}`;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation if it is already running
  el.classList.add(cls);
  const done = (e) => {
    if (e && e.animationName && e.animationName !== cls) return; // ignore child animations
    el.classList.remove(cls);
    el.removeEventListener('animationend', done);
  };
  el.addEventListener('animationend', done);
}

// Apply the animation chosen for an action, once. Does nothing when motion is off.
export function animate(el, action) {
  try {
    const name = actionAnimation(action);
    if (!name || !el || !motionOn()) return;
    runAnimation(el, name);
  } catch { /* no DOM */ }
}

// Apply one animation by id, for previews in the settings UI.
export function previewAnimation(id, el) {
  try {
    if (!ANIM_BY_ID.has(id) || !el || !motionOn()) return;
    runAnimation(el, id);
  } catch { /* no DOM */ }
}
