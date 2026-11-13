'use strict';
// Download queue: parallel workers, pause/resume (SIGSTOP/SIGCONT), cancel, retry, automatic retry for
// temporary failures, cleanup of leftover files, and a saved snapshot so unfinished downloads continue
// after Vidyra restarts (for example after a reboot or when the phone sleeps and Termux is restarted).
const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startDownload, fail } = require('./ytdlp');
const { removeSidecarsFor, baseOf } = require('./files');

const ACTIVE = new Set(['queued', 'downloading', 'paused']);
const FINISHED = new Set(['done', 'error', 'cancelled']);
const THROTTLE_MS = 200;
const PERSIST_MS = 1000;
const KEEP_FINISHED = 200;
// Failures that are worth another try. Private videos, removed videos and unsupported sites are not.
const RETRYABLE = /(429|HTTP Error 5\d\d|timed out|timeout|connection|reset|network|temporar|unable to download|incomplete|disconnected|fragment|read error)/i;

function describe(opts) {
  if (opts.mode === 'audio') {
    return `Audio · ${String(opts.audioFormat || 'mp3').toUpperCase()}`;
  }
  const quality = opts.height && opts.height !== 'best' ? `${opts.height}p` : 'Best';
  const lang = opts.audioLang && opts.audioLang !== 'auto' ? ` · ${opts.audioLang}` : '';
  return `${quality} · ${String(opts.container || 'mp4').toUpperCase()}${lang}`;
}

function lastError(log) {
  for (let i = log.length - 1; i >= 0; i--) if (/ERROR/i.test(log[i])) return log[i].replace(/^ERROR:\s*/, '');
  return '';
}

/** Size in bytes of a finished file, or 0 when it cannot be read. */
function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

class JobQueue extends EventEmitter {
  constructor({
    getOutDir, getMaxParallel, getRate = () => '', getCookies = () => '', getRetries = () => 0,
    getOutputTemplate = () => '', getNameTemplate = () => '', getExtraArgs = () => '', persistFile = '',
  }) {
    super();
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.getOutDir = getOutDir;
    this.getMaxParallel = getMaxParallel;
    this.getRate = getRate;
    this.getCookies = getCookies;
    this.getRetries = getRetries;
    this.getOutputTemplate = getOutputTemplate;
    this.getNameTemplate = getNameTemplate;
    this.getExtraArgs = getExtraArgs;
    this.persistFile = persistFile;
    this.timers = new Map();
    this.retryTimers = new Map();
    this.persistTimer = null;
    this.stopping = false;
    this.load();
  }

  /** Restores the saved queue. Downloads that were waiting or running start again automatically. */
  load() {
    if (!this.persistFile) return;
    let saved;
    try { saved = JSON.parse(fs.readFileSync(this.persistFile, 'utf8')); } catch { return; }
    if (!Array.isArray(saved)) return;
    for (const row of saved) {
      if (!row || typeof row.id !== 'string' || typeof row.url !== 'string' || !row.opts) continue;
      const resumed = ACTIVE.has(row.status);
      const job = {
        ...row,
        status: resumed ? 'queued' : row.status,
        error: resumed ? '' : row.error || '',
        child: null,
        dests: new Set(Array.isArray(row.dests) ? row.dests : []),
        log: Array.isArray(row.log) ? row.log.slice(-60) : [],
        speed: '', eta: '', size: '', retryAt: 0,
        startedAt: Number(row.startedAt) || 0,
        bytes: Number(row.bytes) || 0,
        attempt: Number(row.attempt) || 1,
        retriesLeft: Number.isFinite(row.retriesLeft) ? row.retriesLeft : 0,
      };
      this.jobs.set(job.id, job);
      if (resumed) this.queue.push(job);
    }
    if (this.queue.length) setImmediate(() => this.pump());
  }

  add(opts) {
    const id = crypto.randomBytes(5).toString('hex');
    const job = {
      id, url: opts.url, title: opts.title || opts.url, status: 'queued', percent: 0,
      speed: '', eta: '', size: '', file: '', error: '', log: [], created: Date.now(), finished: 0,
      startedAt: 0, bytes: 0,
      opts, label: describe(opts), child: null, dests: new Set(),
      attempt: 1, retriesLeft: this.getRetries(), retryAt: 0,
    };
    this.jobs.set(id, job);
    this.queue.push(job);
    this.emitJob(job, true);
    this.pump();
    return job;
  }

  pump() {
    const max = this.getMaxParallel();
    while (this.running < max && this.queue.length) {
      const job = this.queue.shift();
      if (job.status === 'queued') this.start(job);
    }
  }

  start(job) {
    this.running++;
    job.status = 'downloading';
    job.error = '';
    job.retryAt = 0;
    job.startedAt = Date.now();
    this.emitJob(job, true);
    let run;
    try {
      // The folder may have been deleted or moved since startup; recreate it before writing.
      const outDir = this.getOutDir();
      fs.mkdirSync(outDir, { recursive: true });
      run = startDownload({
        ...job.opts,
        outDir,
        rate: this.getRate(),
        cookies: this.getCookies(),
        outputTemplate: this.getOutputTemplate(),
        nameTemplate: this.getNameTemplate(),
        extraArgs: this.getExtraArgs(),
      }, {
        onProgress: (p) => { Object.assign(job, p); this.emitJob(job); },
        onFile: (f) => { job.file = f; },
        onDest: (d) => { job.dests.add(d); },
        onLog: (l) => { job.log.push(l); if (job.log.length > 60) job.log.shift(); },
      });
    } catch (e) {
      this.running--;
      job.status = 'error';
      job.error = e.message;
      job.finished = Date.now();
      this.emitJob(job, true);
      return this.pump();
    }
    job.child = run.child;
    run.done.then((r) => this.finish(job, r));
    return undefined;
  }

  finish(job, result) {
    this.running--;
    job.child = null;
    // Shutting down: the snapshot already holds this job as queued, so it resumes on the next start.
    if (this.stopping) return undefined;

    if (job.status !== 'cancelled') {
      if (result.code === 0) {
        job.status = 'done';
        job.percent = 100;
        job.finished = Date.now();
        job.bytes = fileSize(job.file);
        if (job.file) removeSidecarsFor(path.dirname(job.file), job.file);
      } else {
        const reason = result.error || lastError(job.log) || `yt-dlp stopped with code ${result.code}`;
        if (job.retriesLeft > 0 && RETRYABLE.test(reason)) {
          this.scheduleRetry(job, reason);
          this.emitJob(job, true);
          return this.pump();
        }
        job.status = 'error';
        job.error = reason;
        job.finished = Date.now();
      }
    }
    if (job.status === 'cancelled' || job.status === 'error') this.removeFailedSidecars(job);
    this.emitJob(job, true);
    this.pump();
    return undefined;
  }

  /** Puts a failed download back in line after a short pause, so a flaky network gets another chance. */
  scheduleRetry(job, reason) {
    job.retriesLeft--;
    job.attempt++;
    const seconds = Math.min(60, 5 * (job.attempt - 1));
    job.status = 'queued';
    job.speed = '';
    job.eta = '';
    job.error = reason;
    job.retryAt = Date.now() + seconds * 1000;
    job.log.push(`Retrying in ${seconds} s after: ${reason}`);
    const timer = setTimeout(() => {
      this.retryTimers.delete(job.id);
      if (job.status !== 'queued' || !this.jobs.has(job.id)) return;
      this.queue.push(job);
      this.emitJob(job, true);
      this.pump();
    }, seconds * 1000);
    this.retryTimers.set(job.id, timer);
  }

  removeFailedSidecars(job) {
    for (const d of job.dests) removeSidecarsFor(path.dirname(d), d);
  }

  get(id) {
    const job = this.jobs.get(id);
    if (!job) throw fail(404, 'That download no longer exists');
    return job;
  }

  pause(id) {
    const job = this.get(id);
    if (job.status !== 'downloading' || !job.child) throw fail(409, 'Only a running download can be paused');
    job.child.kill('SIGSTOP');
    job.status = 'paused';
    this.emitJob(job, true);
    return job;
  }

  resume(id) {
    const job = this.get(id);
    if (job.status !== 'paused' || !job.child) throw fail(409, 'This download is not paused');
    job.child.kill('SIGCONT');
    job.status = 'downloading';
    this.emitJob(job, true);
    return job;
  }

  /** Pauses every running download. Returns how many were paused. */
  pauseAll() {
    return this.applyToAll('downloading', (id) => this.pause(id));
  }

  /** Resumes every paused download. Returns how many were resumed. */
  resumeAll() {
    return this.applyToAll('paused', (id) => this.resume(id));
  }

  applyToAll(status, act) {
    let count = 0;
    for (const job of [...this.jobs.values()]) {
      if (job.status !== status) continue;
      try { act(job.id); count++; } catch { /* changed while we looped */ }
    }
    return count;
  }

  /** Moves a waiting download to the front of the line. Only queued (not yet running) downloads can move. */
  prioritise(id) {
    const job = this.get(id);
    if (job.status !== 'queued') throw fail(409, 'Only a waiting download can be moved to the front');
    // A download waiting out a retry pause joins the line now instead of when its timer ends.
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    job.retryAt = 0;
    this.queue = this.queue.filter((j) => j !== job);
    this.queue.unshift(job);
    this.emitJob(job, true);
    this.pump();
    return job;
  }

  cancel(id) {
    const job = this.get(id);
    if (job.status === 'queued') {
      this.queue = this.queue.filter((j) => j !== job);
      clearTimeout(this.retryTimers.get(id));
      this.retryTimers.delete(id);
    } else if (ACTIVE.has(job.status) && job.child) {
      // A stopped process ignores SIGTERM until it is continued, so wake it first.
      if (job.status === 'paused') job.child.kill('SIGCONT');
      job.child.kill('SIGTERM');
    } else {
      throw fail(409, 'This download already finished');
    }
    job.status = 'cancelled';
    job.finished = Date.now();
    this.emitJob(job, true);
    return job;
  }

  retry(id) {
    const old = this.get(id);
    if (!FINISHED.has(old.status) || old.status === 'done') throw fail(409, 'Only failed or cancelled downloads can be retried');
    this.jobs.delete(id);
    this.emit('remove', { id });
    return this.add(old.opts);
  }

  /** Queues every failed or cancelled download again. Returns how many were queued. */
  retryFailed() {
    const failed = [...this.jobs.values()].filter((j) => j.status === 'error' || j.status === 'cancelled');
    for (const job of failed) this.retry(job.id);
    return failed.length;
  }

  remove(id) {
    const job = this.get(id);
    if (ACTIVE.has(job.status)) throw fail(409, 'Cancel the download before removing it');
    this.jobs.delete(id);
    this.emit('remove', { id });
    this.schedulePersist();
    return { ok: true };
  }

  clearFinished() {
    let removed = 0;
    for (const job of [...this.jobs.values()]) {
      if (FINISHED.has(job.status)) {
        this.jobs.delete(job.id);
        this.emit('remove', { id: job.id });
        removed++;
      }
    }
    if (removed) this.schedulePersist();
    return removed;
  }

  list() {
    return [...this.jobs.values()].map((j) => this.publicJob(j)).sort((a, b) => b.created - a.created);
  }

  /** Base names (see files.baseOf) of files that running or waiting downloads will write. */
  activeBases() {
    const bases = new Set();
    for (const job of this.jobs.values()) {
      if (!ACTIVE.has(job.status)) continue;
      for (const d of job.dests) bases.add(baseOf(path.basename(d)));
      if (job.file) bases.add(baseOf(path.basename(job.file)));
    }
    return bases;
  }

  publicJob(j) {
    return {
      id: j.id, url: j.url, title: j.title, status: j.status, percent: j.percent, speed: j.speed, eta: j.eta,
      size: j.size, file: j.file ? path.basename(j.file) : '', error: j.error, log: j.log.slice(-6),
      created: j.created, finished: j.finished, label: j.label, mode: j.opts.mode,
      deliver: Boolean(j.opts.deliver), attempt: j.attempt || 1, retryAt: j.retryAt || 0,
      startedAt: j.startedAt || 0, finishedAt: j.finished || 0, bytes: j.bytes || 0,
    };
  }

  /** Writes the queue to disk. Finished items are kept up to KEEP_FINISHED; active ones are always kept. */
  persistNow() {
    if (!this.persistFile) return;
    clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const rows = [];
    let finishedKept = 0;
    for (const j of [...this.jobs.values()].sort((a, b) => b.created - a.created)) {
      if (!ACTIVE.has(j.status)) {
        if (finishedKept >= KEEP_FINISHED) continue;
        finishedKept++;
      }
      rows.push({
        id: j.id, url: j.url, title: j.title, status: j.status, percent: j.percent, file: j.file,
        error: j.error, log: j.log.slice(-20), created: j.created, finished: j.finished, label: j.label,
        opts: j.opts, dests: [...j.dests], attempt: j.attempt, retriesLeft: j.retriesLeft,
        startedAt: j.startedAt || 0, finishedAt: j.finished || 0, bytes: j.bytes || 0,
      });
    }
    try {
      const tmp = `${this.persistFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rows));
      fs.renameSync(tmp, this.persistFile);
    } catch (e) {
      console.warn(`[vidyra] could not save the queue (${e.code || e.message})`);
    }
  }

  schedulePersist() {
    if (!this.persistFile || this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.persistNow(), PERSIST_MS);
    this.persistTimer.unref?.();
  }

  /** Stops every running download without marking it failed, so it resumes when Vidyra starts again. */
  shutdown() {
    this.stopping = true;
    for (const job of this.jobs.values()) {
      clearTimeout(this.retryTimers.get(job.id));
      if (job.child) {
        if (job.status === 'paused') job.child.kill('SIGCONT');
        job.child.kill('SIGTERM');
      }
      if (ACTIVE.has(job.status)) job.status = 'queued';
    }
    this.persistNow();
  }

  /** Throttled so progress bursts do not flood clients. Status changes are sent immediately. */
  emitJob(job, immediate = false) {
    const send = () => {
      this.timers.delete(job.id);
      this.emit('update', this.publicJob(job));
    };
    if (immediate) {
      clearTimeout(this.timers.get(job.id));
      this.timers.delete(job.id);
      this.schedulePersist();
      return send();
    }
    if (!this.timers.has(job.id)) this.timers.set(job.id, setTimeout(send, THROTTLE_MS));
    return undefined;
  }
}

module.exports = { JobQueue, describe, RETRYABLE };
