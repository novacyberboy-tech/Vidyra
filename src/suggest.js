'use strict';
// Home screen suggestions: a few fixed searches per kind (video or music), run with the existing search helper.
// The whole answer is cached in memory for 15 minutes per kind, and sections run two at a time so that
// Android phones are not overloaded. A section that fails comes back empty with an error text; it never fails the rest.
const { searchStream } = require('./ytdlp');
const { detectTools } = require('./tools');
const { searchSourceFor } = require('./features');

const CACHE_MS = 5 * 60_000; // suggestions are rebuilt at most every 5 minutes, so they stay current
const SECTION_LIMIT = 8;
const CONCURRENCY = 2;
const FAILED_TEXT = 'Could not load this section. Try again later.';
const TIMEOUT_TEXT = 'This section took too long to load.';

const SECTIONS = {
  music: [
    { id: 'trending-music', title: 'Trending music', query: 'top hits this week' },
    { id: 'party', title: 'Party music', query: 'party songs mix' },
    { id: 'bollywood', title: 'Bollywood hits', query: 'bollywood superhits songs' },
    { id: 'ghazal', title: 'Ghazal and Sufi', query: 'ghazal sufi classics' },
    { id: 'lofi', title: 'Lo-fi to study', query: 'lofi study beats' },
    { id: 'workout', title: 'Workout energy', query: 'workout motivation songs' },
  ],
  video: [
    { id: 'trending', title: 'Trending', query: 'trending videos today' },
    { id: 'music-videos', title: 'Music videos', query: 'official music video hits' },
    { id: 'learning', title: 'Learning', query: 'tutorial explained' },
    { id: 'gaming', title: 'Gaming highlights', query: 'gaming highlights' },
    { id: 'shorts', title: 'Short clips', query: 'funny short clips' },
  ],
};

/** One search result as the home screen needs it. */
function toItem(it) {
  return {
    id: String(it.id || ''),
    title: String(it.title || 'Untitled'),
    url: String(it.url || ''),
    duration: Number(it.duration) || 0,
    channel: String(it.uploader || ''),
    thumbnail: String(it.thumbnail || ''),
    views: Number(it.view_count) || 0,
  };
}

/**
 * Builds the suggestions service. Options exist so tests can inject the search and the tool check.
 * get(kind, { fresh }) resolves to { kind, updatedAt, needsSetup, sections }.
 */
function createSuggestions({
  search = searchStream,
  detect = () => detectTools(false),
  ttlMs = CACHE_MS,
  now = () => Date.now(),
  concurrency = CONCURRENCY,
} = {}) {
  const cache = new Map(); // kind -> { at, value }
  const inflight = new Map(); // kind -> Promise of a response

  /** Runs one search. Never rejects: a failure becomes an error text on the section. */
  function loadSection(kind, section) {
    const base = { id: section.id, title: section.title, query: section.query, items: [] };
    return new Promise((resolve) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        resolve(error ? { ...base, error } : base);
      };
      try {
        search(section.query, SECTION_LIMIT, {
          onItem: (item) => { if (!settled) base.items.push(toItem(item)); },
          onDone: ({ timedOut } = {}) => finish(timedOut ? TIMEOUT_TEXT : ''),
          onError: () => finish(FAILED_TEXT),
        }, { source: searchSourceFor(kind) });
      } catch {
        finish(FAILED_TEXT);
      }
    });
  }

  /** Runs the sections with at most `concurrency` searches at once. Keeps the section order. */
  async function loadAll(kind, sections) {
    const out = new Array(sections.length);
    let next = 0;
    const worker = async () => {
      while (next < sections.length) {
        const i = next;
        next += 1;
        out[i] = await loadSection(kind, sections[i]);
      }
    };
    const workers = Math.max(1, Math.min(concurrency, sections.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return out;
  }

  async function build(kind) {
    const defs = SECTIONS[kind];
    const updatedAt = new Date(now()).toISOString();
    const tools = await detect();
    if (!tools || !tools.ytdlp || !tools.ytdlp.installed) {
      // Without yt-dlp nothing can be searched: every section is empty and the app shows the setup hint.
      return {
        kind,
        updatedAt,
        needsSetup: true,
        sections: defs.map((s) => ({ id: s.id, title: s.title, query: s.query, items: [] })),
      };
    }
    return { kind, updatedAt, needsSetup: false, sections: await loadAll(kind, defs) };
  }

  function get(kind, { fresh = false } = {}) {
    if (!SECTIONS[kind]) return Promise.reject(new Error(`Unknown suggestions kind: ${kind}`));
    const hit = cache.get(kind);
    if (!fresh && hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    if (!fresh && inflight.has(kind)) return inflight.get(kind);
    const p = build(kind)
      .then((value) => {
        // A missing yt-dlp is not cached, so the answer is right as soon as it is installed.
        value.updatedAt = new Date(now()).toISOString(); // when these suggestions were built
        if (!value.needsSetup) cache.set(kind, { at: now(), value });
        return value;
      })
      .finally(() => { if (inflight.get(kind) === p) inflight.delete(kind); });
    inflight.set(kind, p);
    return p;
  }

  return { get };
}

module.exports = { createSuggestions, SECTIONS, SECTION_LIMIT, CONCURRENCY, CACHE_MS };
