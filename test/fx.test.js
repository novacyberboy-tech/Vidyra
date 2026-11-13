// Tests for public/js/fx.js: library sizes, unique ids, generated CSS, storage fallbacks and guarded playback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from '../public/js/fx.js';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// In-memory stand-in for localStorage.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

// Minimal element with classList, event listeners and dispatch.
function fakeElement() {
  const classes = new Set();
  const listeners = {};
  return {
    classes,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    dispatch(type, event) { [...(listeners[type] || [])].forEach((f) => f(event)); },
    listenerCount: (t) => (listeners[t] || []).length,
  };
}

test('sound library has at least 50 unique, kebab-case ids and labels', () => {
  assert.ok(fx.SOUND_LABELS.length >= 50, `only ${fx.SOUND_LABELS.length} sounds`);
  const ids = fx.SOUND_LABELS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(fx.SOUND_LABELS.map((s) => s.label)).size, fx.SOUND_LABELS.length);
  ids.forEach((id) => assert.match(id, KEBAB));
  assert.ok(fx.SOUND_LABELS.some((s) => s.id === 'chime-soft' && s.label === 'Chime · Soft'));
});

test('every sound variant keeps tone gain at or below 0.15', () => {
  fx.SOUND_VARIANTS.forEach((v) => assert.ok(v.gain > 0 && v.gain <= 0.15, `${v.id} gain ${v.gain}`));
});

test('animation library has at least 50 unique, kebab-case ids and labels', () => {
  assert.ok(fx.ANIMATIONS.length >= 50, `only ${fx.ANIMATIONS.length} animations`);
  const ids = fx.ANIMATIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(fx.ANIMATIONS.map((a) => a.label)).size, fx.ANIMATIONS.length);
  ids.forEach((id) => assert.match(id, KEBAB));
});

test('keyframesCss has one @keyframes and one class rule per animation, with matching names', () => {
  const css = fx.keyframesCss();
  const keyframeCount = css.match(/@keyframes /g).length;
  assert.equal(keyframeCount, fx.ANIMATIONS.length);
  for (const { id } of fx.ANIMATIONS) {
    assert.ok(css.includes(`@keyframes fx-${id} {`), `missing @keyframes fx-${id}`);
    assert.ok(css.includes(`.fx-${id} { animation: fx-${id} `), `missing rule for fx-${id}`);
  }
});

test('actions: every action has a default sound and animation that exist in the libraries', () => {
  const soundIds = new Set(fx.SOUND_LABELS.map((s) => s.id));
  const animIds = new Set(fx.ANIMATIONS.map((a) => a.id));
  assert.deepEqual(fx.ACTIONS, Object.keys(fx.ACTION_DEFAULTS));
  for (const action of fx.ACTIONS) {
    const d = fx.ACTION_DEFAULTS[action];
    assert.ok(soundIds.has(d.sound), `${action}: unknown sound ${d.sound}`);
    assert.ok(animIds.has(d.anim), `${action}: unknown animation ${d.anim}`);
  }
});

test('actionSound and actionAnimation fall back to defaults without localStorage', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    for (const action of fx.ACTIONS) {
      assert.equal(fx.actionSound(action), fx.ACTION_DEFAULTS[action].sound);
      assert.equal(fx.actionAnimation(action), fx.ACTION_DEFAULTS[action].anim);
    }
    assert.equal(fx.actionSound('nope'), null);
    assert.doesNotThrow(() => fx.setActionChoice('enter', { anim: 'fade' }));
    assert.doesNotThrow(() => fx.resetActionChoices());
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
  }
});

test('stored action choices are used, invalid ones fall back, reset restores defaults', () => {
  const storage = fakeStorage({
    'vidyra.fx': JSON.stringify({ actions: { success: { anim: 'flip-x', sound: 'bell-deep' }, error: { anim: 'bogus', sound: 'nope' } } }),
  });
  globalThis.localStorage = storage;
  try {
    assert.equal(fx.actionAnimation('success'), 'flip-x');
    assert.equal(fx.actionSound('success'), 'bell-deep');
    assert.equal(fx.actionAnimation('error'), fx.ACTION_DEFAULTS.error.anim);
    assert.equal(fx.actionSound('error'), fx.ACTION_DEFAULTS.error.sound);

    fx.setActionChoice('tab', { anim: 'blur-in', sound: 'ping-retro' });
    assert.equal(fx.actionAnimation('tab'), 'blur-in');
    assert.equal(fx.actionSound('tab'), 'ping-retro');
    assert.equal(fx.actionAnimation('success'), 'flip-x', 'other actions keep their choice');

    fx.resetActionChoices();
    assert.equal(fx.actionSound('success'), fx.ACTION_DEFAULTS.success.sound);
    assert.equal(fx.actionAnimation('tab'), fx.ACTION_DEFAULTS.tab.anim);
  } finally {
    delete globalThis.localStorage;
  }
});

test('playback never throws and does nothing when sounds are disabled', () => {
  const created = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, start() {}, stop() {}, frequency: param(), gain: param(), Q: param(), type: '' });
  class FakeAudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    createOscillator() { created.push('osc'); return node(); }
    createGain() { created.push('gain'); return node(); }
    createBiquadFilter() { created.push('filter'); return node(); }
    createBufferSource() { created.push('src'); return node(); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    resume() { return Promise.resolve(); }
  }
  globalThis.AudioContext = FakeAudioContext;
  try {
    globalThis.localStorage = fakeStorage({ 'vidyra.prefs': JSON.stringify({ sounds: false }) });
    assert.doesNotThrow(() => fx.playSound('chime-soft'));
    assert.equal(created.length, 0, 'sounds off: no audio nodes');

    globalThis.localStorage = fakeStorage({ 'vidyra.prefs': '{broken json' });
    assert.doesNotThrow(() => fx.playSound('chime-soft'));
    assert.ok(created.length > 0, 'bad prefs fall back to sounds on');

    const before = created.length;
    assert.doesNotThrow(() => fx.playSound('no-such-sound'));
    assert.doesNotThrow(() => fx.previewSound('swoosh-retro'));
    assert.ok(created.length > before, 'preview plays a noise sound');
    assert.doesNotThrow(() => fx.fire('press'));
  } finally {
    delete globalThis.AudioContext;
    delete globalThis.localStorage;
  }
});

test('playback without any AudioContext is silent and does not throw', () => {
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  assert.doesNotThrow(() => fx.playSound('bell-deep'));
  assert.doesNotThrow(() => fx.previewSound('bell-deep'));
  assert.doesNotThrow(() => fx.fire('success'));
});

test('animate adds the animation class and removes it on its own animationend', () => {
  delete globalThis.localStorage;
  const el = fakeElement();
  fx.animate(el, 'enter');
  assert.ok(el.classes.has('fx-rise'));
  el.dispatch('animationend', { animationName: 'fx-other' });
  assert.ok(el.classes.has('fx-rise'), 'child or other animation ends are ignored');
  el.dispatch('animationend', { animationName: 'fx-rise' });
  assert.equal(el.classes.has('fx-rise'), false);
  assert.equal(el.listenerCount('animationend'), 0);
});

test('animate and previewAnimation do nothing when motion is off', () => {
  globalThis.localStorage = fakeStorage({ 'vidyra.prefs': JSON.stringify({ motion: false }) });
  try {
    const el = fakeElement();
    fx.animate(el, 'enter');
    fx.previewAnimation('pop', el);
    assert.equal(el.classes.size, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

test('previewAnimation applies a known id and ignores unknown ones', () => {
  delete globalThis.localStorage;
  const el = fakeElement();
  fx.previewAnimation('glow-in', el);
  assert.ok(el.classes.has('fx-glow-in'));
  const other = fakeElement();
  assert.doesNotThrow(() => fx.previewAnimation('no-such-animation', other));
  assert.equal(other.classes.size, 0);
});

test('installAnimations and other browser-only calls are no-ops in node', () => {
  assert.doesNotThrow(() => fx.installAnimations());
  assert.doesNotThrow(() => fx.installAnimations());
  assert.doesNotThrow(() => fx.animate(null, 'enter'));
});
