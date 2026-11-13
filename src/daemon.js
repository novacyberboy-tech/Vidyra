'use strict';
// Runs Vidyra in the background and controls it: start, stop, status, logs. Plain Node, so it works the same on
// Termux (Android), Linux, macOS and Windows. Downloads keep going after you close the terminal or switch apps.
// On Termux it also holds a wake lock, so the phone does not sleep the download away.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { ROOT, isTermux } = require('./config');

const PID_FILE = path.join(ROOT, 'vidyra.pid');
const LOG_FILE = path.join(ROOT, 'vidyra.log');
const PORT = Math.min(65535, Math.max(1, Number(process.env.PORT) || 8787));
const HOST = process.env.HOST || '127.0.0.1';
// The address this machine uses to reach its own server (0.0.0.0 is "all interfaces", not a place to connect to).
const CONNECT_HOST = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
const URL_HERE = `http://${CONNECT_HOST}:${PORT}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readPid() {
  try {
    const n = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists, but belongs to someone else
  }
}

/** The pid of the running background server, or null. Removes a stale pid file. */
function runningPid() {
  const pid = readPid();
  if (pid && alive(pid)) return pid;
  try { fs.rmSync(PID_FILE, { force: true }); } catch { /* nothing to remove */ }
  return null;
}

/** True when the server answers its health check. */
async function answering() {
  try {
    const res = await fetch(`${URL_HERE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function wakeLock(on) {
  if (!isTermux) return;
  spawnSync(on ? 'termux-wake-lock' : 'termux-wake-unlock', { stdio: 'ignore' });
}

async function start() {
  const existing = runningPid();
  if (existing) {
    console.log(`Vidyra is already running (pid ${existing}). Open ${URL_HERE}`);
    return 0;
  }
  fs.appendFileSync(LOG_FILE, `\n--- started ${new Date().toISOString()} ---\n`);
  const out = fs.openSync(LOG_FILE, 'a');
  wakeLock(true);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
    env: process.env,
  });
  let exited = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { exited = true; });
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(PID_FILE, String(child.pid));

  for (let i = 0; i < 24; i += 1) {
    if (await answering()) {
      console.log(`Vidyra is running in the background (pid ${child.pid}).`);
      console.log(`Open it:      ${URL_HERE}`);
      console.log('Commands:     npm start -- help');
      console.log('Check it:     npm start -- status     Stop it: npm start -- stop');
      return 0;
    }
    if (exited) break;
    await sleep(500);
  }
  fs.rmSync(PID_FILE, { force: true });
  wakeLock(false);
  console.error('Vidyra did not start. Read the log with: npm start -- logs');
  return 1;
}

async function stop() {
  const pid = runningPid();
  if (!pid) {
    wakeLock(false);
    console.log('Vidyra is not running.');
    return 0;
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  // Give it a moment to park unfinished downloads in the queue file.
  for (let i = 0; i < 20 && alive(pid); i += 1) await sleep(250);
  fs.rmSync(PID_FILE, { force: true });
  wakeLock(false);
  console.log('Vidyra stopped. Unfinished downloads resume the next time it starts.');
  return 0;
}

async function status() {
  const pid = runningPid();
  if (!pid) {
    console.log('Vidyra is not running. Start it with: npm start');
    return 1;
  }
  if (await answering()) {
    console.log(`Vidyra is running (pid ${pid}). Open ${URL_HERE}`);
    return 0;
  }
  console.log(`Vidyra process is running (pid ${pid}) but is not answering yet. Try again in a moment, or read: npm start -- logs`);
  return 1;
}

function logs(lines = 60) {
  let text;
  try {
    text = fs.readFileSync(LOG_FILE, 'utf8');
  } catch {
    console.log('No log yet.');
    return 0;
  }
  console.log(text.split(/\r?\n/).slice(-lines).join('\n').trimEnd());
  return 0;
}

/** Runs the server in this terminal (stops when the terminal closes). Ctrl+C stops it. */
function foreground() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, stdio: 'inherit', env: process.env,
    });
    const forward = (sig) => () => { try { child.kill(sig); } catch { /* already gone */ } };
    process.once('SIGINT', forward('SIGINT'));
    process.once('SIGTERM', forward('SIGTERM'));
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

/** Sends one command to the running server and prints its text. */
async function remote(words) {
  if (!(await answering())) {
    console.log('Vidyra is not running. Start it first with: npm start');
    return 1;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.ACCESS_TOKEN) headers['x-token'] = process.env.ACCESS_TOKEN;
  let res;
  try {
    res = await fetch(`${URL_HERE}/api/command`, {
      method: 'POST', headers, body: JSON.stringify({ args: words }), signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    console.error(`Could not reach Vidyra (${e.message}).`);
    return 1;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) console.error('This Vidyra needs a token. Run again with ACCESS_TOKEN=your-token set.');
    else console.error(body.error || `Command failed (${res.status}).`);
    return 1;
  }
  console.log(body.text || 'Done.');
  return 0;
}

module.exports = {
  start, stop, status, logs, foreground, remote, runningPid, answering, URL_HERE, LOG_FILE, PID_FILE,
};
