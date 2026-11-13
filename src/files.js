'use strict';
// Library: lists, classifies, resolves and cleans up files in the download folder. Every name is reduced to
// a basename first, so a request can never reach outside the download folder.
//
// Roles:
//   media    finished video or audio (shown in the Library)
//   sidecar  thumbnails, subtitles and info files yt-dlp leaves next to a video (leftovers)
//   partial  unfinished downloads and separate video/audio fragments (kept so a retry can resume)
//   other    anything else the person put in the folder (shown, never touched automatically)
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./ytdlp');

const VIDEO_EXT = new Set(['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.opus', '.ogg', '.aac', '.wav', '.flac']);
const SIDECAR_EXT = /\.(webp|jpe?g|png|gif|vtt|srt|ass|ssa|ttml|sbv|lrc|json3|srv[123]|json|description)$/i;
const PARTIAL_RE = /(\.part|\.ytdl|\.temp|\.f\d+\.[a-z0-9]+)$/i;

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return 'file';
}

/** "Title [id].mp4" → "Title [id]". yt-dlp names every file this way, so all its files share this base. */
function baseOf(name) {
  const m = /^(.*\[[^\]]+\])/.exec(name);
  return m ? m[1] : name;
}

function roleOf(name) {
  if (PARTIAL_RE.test(name)) return 'partial';
  if (SIDECAR_EXT.test(name) && /\[[^\]]+\]/.test(name)) return 'sidecar';
  const kind = kindOf(name);
  return kind === 'file' ? 'other' : 'media';
}

/** Lists the folder. activeBases: Set of baseOf() names for downloads that are still running. */
function listFiles(dir, activeBases = new Set()) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const files = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    try {
      const stat = fs.statSync(path.join(dir, name));
      if (!stat.isFile()) continue;
      const role = roleOf(name);
      files.push({
        name,
        size: stat.size,
        mtime: stat.mtimeMs,
        kind: kindOf(name),
        ext: path.extname(name).slice(1).toLowerCase(),
        role,
        active: role !== 'media' && role !== 'other' && activeBases.has(baseOf(name)),
      });
    } catch { /* vanished while listing */ }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

/** Leftovers are sidecars and partial files that no running download is using. */
function leftoversOf(files) {
  const items = files.filter((f) => (f.role === 'sidecar' || f.role === 'partial') && !f.active);
  return { count: items.length, bytes: items.reduce((n, f) => n + f.size, 0), items };
}

function cleanupLeftovers(dir, activeBases = new Set()) {
  const { items } = leftoversOf(listFiles(dir, activeBases));
  let removed = 0;
  let bytes = 0;
  for (const f of items) {
    try {
      fs.unlinkSync(path.join(dir, f.name));
      removed++;
      bytes += f.size;
    } catch { /* already gone */ }
  }
  return { removed, bytes };
}

/** After a successful download, the thumbnail and subtitle files that belong to it are no longer needed. */
function removeSidecarsFor(dir, finalName) {
  const base = baseOf(path.basename(finalName));
  let removed = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === path.basename(finalName) || roleOf(name) !== 'sidecar') continue;
      if (baseOf(name) !== base) continue;
      try { fs.unlinkSync(path.join(dir, name)); removed++; } catch { /* best effort */ }
    }
  } catch { /* folder missing */ }
  return removed;
}

async function freeSpace(dir) {
  try {
    const s = await fs.promises.statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

function resolveFile(dir, rawName) {
  let name;
  try { name = path.basename(decodeURIComponent(String(rawName || ''))); } catch { return null; }
  if (!name || name.startsWith('.')) return null;
  const full = path.join(dir, name);
  if (path.dirname(full) !== path.resolve(dir)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

function deleteFile(dir, rawName) {
  const full = resolveFile(dir, rawName);
  if (!full) return false;
  fs.unlinkSync(full);
  return true;
}

/** A plain file name: no folders, no "..", no leading dot, no control characters. Returns null when refused. */
function cleanBaseName(raw) {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 200 || name.startsWith('.') || name.includes('..')) return null;
  if (/[\\/\x00-\x1f\x7f]/.test(name) || path.basename(name) !== name) return null;
  return name;
}

function isFile(full) {
  try { return fs.statSync(full).isFile(); } catch { return false; }
}

/**
 * Renames one file in the download folder. The extension must stay the same and an existing file is never
 * overwritten. activeBases: downloads still writing, which cannot be renamed yet. Returns the new name.
 */
function renameFile(dir, rawFrom, rawTo, activeBases = new Set()) {
  const from = cleanBaseName(rawFrom);
  const to = cleanBaseName(rawTo);
  if (!from || !to) throw fail(400, 'Use plain file names: no folders, no "..", no control characters');
  if (path.extname(from).toLowerCase() !== path.extname(to).toLowerCase()) {
    throw fail(400, 'The new name must keep the same file extension');
  }
  const src = path.join(dir, from);
  if (!isFile(src)) throw fail(404, 'That file no longer exists');
  if (activeBases.has(baseOf(from))) throw fail(409, 'Wait for this download to finish before renaming it');
  const dst = path.join(dir, to);
  if (fs.existsSync(dst)) throw fail(409, 'A file with that name already exists');
  fs.renameSync(src, dst);
  return to;
}

module.exports = {
  listFiles, resolveFile, deleteFile, kindOf, roleOf, baseOf, leftoversOf, cleanupLeftovers,
  removeSidecarsFor, freeSpace, cleanBaseName, renameFile,
};
