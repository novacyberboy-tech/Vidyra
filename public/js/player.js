// Media player dialog for finished files. Plays video or audio from the Vidyra server, with playback speed,
// loop, a sleep timer (pauses after 5, 15, 30 or 60 minutes), full screen, picture-in-picture and share.
import { esc, fileUrl, dialog, toast, icon } from './core.js';

const SLEEP_CHOICES = [
  { value: '0', label: 'Sleep timer: off' },
  { value: '5', label: 'Pause in 5 min' },
  { value: '15', label: 'Pause in 15 min' },
  { value: '30', label: 'Pause in 30 min' },
  { value: '60', label: 'Pause in 60 min' },
];

/** Opens the player for one file. file: { name, kind: 'video' | 'audio' | other }. */
export function openPlayer(file) {
  const isVideo = file.kind === 'video';
  const body = document.createElement('div');
  body.className = 'vidyra-player';
  const el = document.createElement(isVideo ? 'video' : 'audio');
  el.controls = true;
  el.playsInline = true;
  el.preload = 'metadata';
  el.src = fileUrl(file.name);
  el.setAttribute('aria-label', `${isVideo ? 'Video' : 'Audio'} player`);
  if (isVideo) el.style.cssText = 'width:100%;max-height:60vh;background:#000;border-radius:14px;';

  const tools = document.createElement('div');
  tools.className = 'player-tools';

  const speed = document.createElement('select');
  speed.className = 'input';
  speed.setAttribute('aria-label', 'Playback speed');
  [0.5, 0.75, 1, 1.25, 1.5, 2].forEach((rate) => {
    const opt = document.createElement('option');
    opt.value = String(rate);
    opt.textContent = `${rate}×`;
    if (rate === 1) opt.selected = true;
    speed.append(opt);
  });
  speed.addEventListener('change', () => { el.playbackRate = Number(speed.value); });
  tools.append(speed);

  const loop = document.createElement('button');
  loop.type = 'button';
  loop.className = 'btn btn-sm';
  loop.setAttribute('aria-pressed', 'false');
  loop.textContent = 'Loop: off';
  loop.addEventListener('click', () => {
    el.loop = !el.loop;
    loop.setAttribute('aria-pressed', String(el.loop));
    loop.textContent = `Loop: ${el.loop ? 'on' : 'off'}`;
  });
  tools.append(loop);

  const sleep = document.createElement('select');
  sleep.className = 'input';
  sleep.setAttribute('aria-label', 'Sleep timer');
  sleep.innerHTML = SLEEP_CHOICES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('');
  let sleepTimer = null;
  let sleepNote = null;
  sleep.addEventListener('change', () => {
    clearTimeout(sleepTimer);
    sleepTimer = null;
    const mins = Number(sleep.value);
    if (sleepNote) sleepNote.remove();
    if (!mins) return;
    sleepTimer = setTimeout(() => {
      el.pause();
      toast('Sleep timer: playback paused.', { type: 'info', timeout: 3000, sound: false });
      sleep.value = '0';
      sleepTimer = null;
    }, mins * 60 * 1000);
    sleepNote = document.createElement('span');
    sleepNote.className = 'sleep-note';
    sleepNote.textContent = `Pauses in ${mins} min`;
    tools.append(sleepNote);
  });
  tools.append(sleep);

  if (isVideo) {
    const full = document.createElement('button');
    full.type = 'button';
    full.className = 'btn btn-sm';
    full.textContent = 'Full screen';
    full.addEventListener('click', () => { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); });
    tools.append(full);
    if (document.pictureInPictureEnabled) {
      const pip = document.createElement('button');
      pip.type = 'button';
      pip.className = 'btn btn-sm';
      pip.textContent = 'Picture in picture';
      pip.addEventListener('click', async () => {
        try {
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else { await el.play(); await el.requestPictureInPicture(); }
        } catch (err) { toast(err.message || 'Picture-in-picture is not available.', { type: 'error' }); }
      });
      tools.append(pip);
    }
  }
  if (navigator.share) {
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn btn-sm';
    shareBtn.innerHTML = `${icon('share', 'sm')} Share`;
    shareBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(fileUrl(file.name));
        const blob = await res.blob();
        const f = new File([blob], file.name, { type: blob.type || 'application/octet-stream' });
        if (navigator.canShare && !navigator.canShare({ files: [f] })) throw new Error('Sharing this file is not supported here');
        await navigator.share({ files: [f], title: file.name });
      } catch (err) {
        if (err?.name !== 'AbortError') toast(err.message || 'Share failed.', { type: 'error' });
      }
    });
    tools.append(shareBtn);
  }

  body.append(el, tools);
  const done = dialog({
    title: file.name,
    body,
    wide: true,
    actions: [{ label: 'Close', value: true, variant: 'ghost' }],
  });
  done.finally(() => {
    clearTimeout(sleepTimer);
    el.pause();
    el.removeAttribute('src');
    el.load();
  });
  el.play().catch(() => { /* autoplay blocked: the controls still work */ });
  return done;
}
