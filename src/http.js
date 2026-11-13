'use strict';
// Small HTTP helpers: JSON replies, guarded body parsing, static files, byte-range file serving.
const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.vtt': 'text/vtt',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

/** Reads a JSON body. Rejects oversized bodies and invalid JSON with a 4xx status. */
function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Request is too large');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        const parsed = JSON.parse(text);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        const err = new Error('Request body must be valid JSON');
        err.status = 400;
        reject(err);
      }
    });
  });
}

/**
 * Serves a file with HTTP Range support (needed for seeking in the in-app player).
 * options.attachment → Content-Disposition: attachment (used by the Save button).
 */
function serveFile(req, res, full, { attachment = false } = {}) {
  let stat;
  try { stat = fs.statSync(full); } catch { res.writeHead(404); return res.end('Not found'); }
  const headers = {
    'Content-Type': mimeFor(full),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (attachment) {
    headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start;
    let end;
    if (!range[1]) {
      // suffix range: last N bytes
      start = Math.max(0, stat.size - parseInt(range[2], 10));
      end = stat.size - 1;
    } else {
      start = parseInt(range[1], 10);
      end = range[2] ? Math.min(parseInt(range[2], 10), stat.size - 1) : stat.size - 1;
    }
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    return pipeFile(full, res, { start, end });
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  return pipeFile(full, res);
}

/** Streams a file to the response. A file that disappears or cannot be read ends that reply; it never crashes the server. */
function pipeFile(full, res, range) {
  const stream = range ? fs.createReadStream(full, range) : fs.createReadStream(full);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
  return true;
}

/** Serves a file from the public folder. Returns false when it does not exist. */
function serveStatic(req, res, publicDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  const rel = pathname === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = path.resolve(publicDir, rel);
  if (!full.startsWith(publicDir + path.sep) && full !== publicDir) return false;
  let stat;
  try { stat = fs.statSync(full); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': mimeFor(full),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  return pipeFile(full, res);
}

module.exports = { sendJson, sendError, readJson, serveFile, serveStatic, mimeFor };
