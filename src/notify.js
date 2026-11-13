'use strict';
// Android notifications through Termux:API. Each download gets one notification that is updated while it
// runs (a text progress bar, percent, speed and time left) and is replaced by a result when it ends.
// Only used on Termux with the termux-api package installed; everywhere else it does nothing.
const { spawn, spawnSync } = require('node:child_process');

const CELLS = 20;
const THROTTLE_MS = 2500;
const FINAL = { done: 'Download complete', error: 'Download failed', cancelled: 'Download cancelled' };

/** A text progress bar, for example ████████░░░░░░░░░░░░ 40%. */
function progressBar(percent) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const filled = Math.round((pct / 100) * CELLS);
  return `${'█'.repeat(filled)}${'░'.repeat(CELLS - filled)} ${pct}%`;
}

/** Arguments for termux-notification for one job, or null when the job needs no notification now. */
function notificationArgs(job) {
  const id = `vidyra-${job.id}`;
  const title = String(job.title || 'Download').slice(0, 120);
  if (job.status === 'downloading' || job.status === 'paused') {
    const detail = job.status === 'paused'
      ? 'Paused'
      : [job.speed, job.eta ? `${job.eta} left` : ''].filter(Boolean).join(' · ');
    return ['--id', id, '--title', `Downloading · ${title}`,
      '--content', `${progressBar(job.percent)}${detail ? `\n${detail}` : ''}`,
      '--ongoing', '--alert-once', '--priority', 'low'];
  }
  if (FINAL[job.status]) {
    const content = job.status === 'error' ? String(job.error || 'Open Vidyra to see the reason.').slice(0, 200) : title;
    return ['--id', id, '--title', FINAL[job.status], '--content', content, '--priority', 'default'];
  }
  return null;
}

function commandExists(bin) {
  try {
    return spawnSync('sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const MAX_WAIT_MS = 8000; // a notification call that hangs longer than this is stopped

class TermuxNotifier {
  constructor({ enabled = false, bin = 'termux-notification' } = {}) {
    this.bin = bin;
    this.wanted = Boolean(enabled);
    this.available = null;
    this.lastSent = new Map();
    // At most one termux-notification process runs at a time. Updates that arrive meanwhile replace each
    // other per notification id, so a busy phone never piles up processes.
    this.busy = false;
    this.pending = new Map();
  }

  setEnabled(on) {
    this.wanted = Boolean(on);
  }

  ready() {
    if (!this.wanted) return false;
    if (this.available === null) this.available = commandExists(this.bin);
    return this.available;
  }

  send(args) {
    const id = args[1];
    this.pending.set(id, args);
    this.pump();
  }

  pump() {
    if (this.busy || this.pending.size === 0) return;
    const next = this.pending.entries().next().value;
    this.pending.delete(next[0]);
    this.busy = true;
    let child;
    let timer = null;
    let done = false;
    // Runs once per child, even when a timeout and a close event both fire.
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      this.busy = false;
      this.pump();
    };
    try {
      child = spawn(this.bin, next[1], { stdio: 'ignore' });
    } catch {
      this.available = false;
      return finish();
    }
    child.on('error', () => { this.available = false; finish(); });
    child.on('close', finish);
    timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } finish(); }, MAX_WAIT_MS);
    timer.unref();
    return undefined;
  }

  onJob(job) {
    if (!this.ready()) return;
    const args = notificationArgs(job);
    if (!args) return;
    const active = job.status === 'downloading' || job.status === 'paused';
    if (active) {
      const now = Date.now();
      if (now - (this.lastSent.get(job.id) || 0) < THROTTLE_MS) return;
      this.lastSent.set(job.id, now);
    } else {
      // Send the result once, then forget the job.
      if (this.lastSent.has(`final-${job.id}`)) return;
      this.lastSent.set(`final-${job.id}`, Date.now());
      this.lastSent.delete(job.id);
    }
    this.send(args);
  }
}

module.exports = { TermuxNotifier, notificationArgs, progressBar };
