// About tab: what Vidyra is, how to use it, FAQ, responsible-use notice and credits.
import { icon, esc, store } from '../core.js';

const FEATURES = [
  { ic: 'video', t: 'Any quality', d: 'From 144p up to 8K, or Best available. Only sizes the source really offers are listed.' },
  { ic: 'audio', t: 'Video or audio', d: 'MP4, MKV or WebM video, or audio-only MP3, M4A, Opus, AAC, WAV and FLAC.' },
  { ic: 'edit', t: 'Rename before download', d: 'Edit the file name after Fetch info. Your title becomes the saved name.' },
  { ic: 'zap', t: 'SponsorBlock', d: 'Strip sponsor, self-promo and interaction segments when the community has marked them.' },
  { ic: 'filter', t: 'Time-range clips', d: 'Download only a start→end section in seconds.' },
  { ic: 'list', t: 'Embed chapters', d: 'Keep chapter markers inside the file for supported players.' },
  { ic: 'queue', t: 'Smart queue', d: 'Parallel downloads, pause/resume, cancel, retry, filters, search and live logs.' },
  { ic: 'search', t: 'Built-in search', d: 'Streamed YouTube results, duration filters, sort, favorites and batch queue.' },
  { ic: 'download', t: 'Batch multi-link', d: 'Paste many URLs (one per line) and queue them all as video or audio.' },
  { ic: 'library', t: 'Library bulk actions', d: 'Multi-select files and delete many at once. Play, share and PiP.' },
  { ic: 'phone', t: 'Save to this device', d: 'Hand finished files to the browser’s own download with progress.' },
  { ic: 'bell', t: 'Notifications', d: 'Browser and Termux progress notifications with speed and completion alerts.' },
  { ic: 'settings', t: 'Filename templates', d: 'Global yt-dlp output templates and extra arguments for power users.' },
  { ic: 'music', t: 'Music tab', d: 'Search songs and save them as audio with one tap. Audio only, in the format you choose.' },
  { ic: 'sparkles', t: 'Themes & accents', d: '22 named themes, dark and light, and 12 accent colours. Every animation and sound can be changed.' },
  { ic: 'list', t: 'Favourites and CSV', d: 'Star library files, rename them, select many at once and export the list as a spreadsheet.' },
  { ic: 'share', t: 'Native share', d: 'Share finished media from the in-app player via the system share sheet.' },
  { ic: 'copy', t: 'Export prefs', d: 'Backup and restore browser preferences as JSON.' },
  { ic: 'gauge', t: 'Speed limit', d: 'Cap bandwidth per download so other devices stay responsive.' },
  { ic: 'shield', t: 'Cookies support', d: 'Use cookies.txt for age-restricted and members-only content.' },
  { ic: 'cpu', t: 'Self-updating tools', d: 'Update yt-dlp from Settings when sites change.' },
  { ic: 'help', t: 'Keyboard shortcuts', d: 'Ctrl+K opens the command palette. Press g then d, l, s or t to jump around.' },
];

const FAQ = [
  ['Why is a download failing?', 'Open the Queue tab and read the message under the item. Sites change often: update yt-dlp in Settings → Tools, then press Retry.'],
  ['Why is there no Hindi (or other) audio option?', 'Vidyra can only select a dubbed track that the video already has. If the menu shows one track, that video has no dub. Some creators upload the dub as a separate video; paste that link instead.'],
  ['Why is a video merged slowly?', 'Merging video and audio, and converting to MP3, is done by ffmpeg on your device. Faster processors and SSD storage make it quicker.'],
  ['Can I download private or age-restricted videos?', 'Only with a signed-in session. Export cookies.txt with a browser extension, then enter its full path in Settings → Downloads → Cookies file.'],
  ['Do downloads stop when I close the page or lock the phone?', 'No. The server keeps downloading. On Android, run npm start in Termux. It starts Vidyra in the background with a wake lock, so it keeps running.'],
  ['Does Vidyra work offline?', 'The app shell opens offline after the first visit, but downloading and search need a connection to the site and to the Vidyra server.'],
];

export function mount(root, ctx) {
  const version = store.settings?.brand?.version || '3.0.0';
  root.innerHTML = `
    <section class="card hero" aria-labelledby="aboutTitle" style="padding:26px">
      <div class="hero-about">
        <img class="logo-lg" src="/logo.svg" width="84" height="84" alt="">
        <div>
          <h2 id="aboutTitle">Vidyra</h2>
          <p class="muted small" style="margin-top:4px">Version ${esc(version)} · Universal video &amp; audio downloader</p>
        </div>
        <p class="lede">Vidyra is a fast, professional downloader for videos and audio from YouTube and hundreds of other sites. Paste a link, pick the quality and format you want, and it downloads in the background with a live queue, a built-in library and a player. It runs on your own computer or Android phone, so your files stay with you.</p>
        <div class="row">
          <a class="btn btn-primary btn-lg" href="#/download" style="width:auto">${icon('download', 'sm')} Start downloading</a>
          <a class="btn btn-lg" href="#/search" style="width:auto">${icon('search', 'sm')} Search videos</a>
        </div>
      </div>
    </section>

    <section aria-labelledby="featTitle" class="stack" style="gap:12px">
      <h2 class="section-title" id="featTitle">Features</h2>
      <div class="feature-grid">
        ${FEATURES.map((f, i) => `
          <article class="feature enter" style="--i:${i}">
            <div class="fi">${icon(f.ic)}</div>
            <h3>${esc(f.t)}</h3>
            <p>${esc(f.d)}</p>
          </article>`).join('')}
      </div>
    </section>

    <section class="card" aria-labelledby="howTitle">
      <div class="card-head">${icon('help')}<h2 id="howTitle">How to use Vidyra</h2></div>
      <ol class="steps">
        <li><div><b>Paste a link</b><span>On the Download tab, paste the video link and press <i>Fetch info</i>. Or search on the Search tab and press Download on a result.</span></div></li>
        <li><div><b>Choose what you want</b><span>Video or audio only, then the quality, container or audio format. Pick a dubbed audio language if the menu offers one.</span></div></li>
        <li><div><b>Start the download</b><span>Press <i>Download</i>. Watch progress, speed and time left in the Queue tab. Pause, resume or cancel at any time.</span></div></li>
        <li><div><b>Enjoy your files</b><span>Open the Library tab to play, save to your device or delete a file. Or press <i>Save to this device</i> instead of Download to send the finished file to your browser.</span></div></li>
      </ol>
      <div class="notice info" style="margin-top:18px">${icon('info')}<div><b>Tip</b><span class="muted">On Android, use Share → Vidyra in any app to send a link straight to the Download tab.</span></div></div>
    </section>

    <section class="card" aria-labelledby="keysTitle">
      <div class="card-head">${icon('cpu')}<h2 id="keysTitle">Keyboard shortcuts</h2></div>
      <div class="shortcut-grid">
        <kbd>Ctrl</kbd> + <kbd>K</kbd><span>Command palette: go anywhere, change theme, run a command</span>
        <kbd>g</kbd> then <kbd>d</kbd><span>Download (Video)</span>
        <kbd>g</kbd> then <kbd>l</kbd><span>Library</span>
        <kbd>g</kbd> then <kbd>s</kbd><span>Settings</span>
        <kbd>g</kbd> then <kbd>t</kbd><span>Tools</span>
        <kbd>/</kbd><span>Search box (opens Search)</span>
        <kbd>f</kbd><span>Focus mode on or off</span>
      </div>
    </section>

    <section class="card" aria-labelledby="faqTitle">
      <div class="card-head">${icon('info')}<h2 id="faqTitle">Questions</h2></div>
      ${FAQ.map(([q, a]) => `<details class="faq"><summary>${icon('chevron', 'sm')}${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    </section>

    <section class="card" aria-labelledby="legalTitle">
      <div class="card-head">${icon('shield')}<h2 id="legalTitle">Use it responsibly</h2></div>
      <p class="muted">Only download content you own, that its creator has licensed for download, or that you otherwise have the right to save. Downloading can break a site's terms of service or copyright law in your country. You are responsible for how you use Vidyra.</p>
      <p class="credits" style="margin-top:14px">Music search and download use the yt-dlp engine. Echo Music (GPL-3.0) inspired the Music tab design; no Echo Music code is included.</p>
      <p class="credits" style="margin-top:8px">Vidyra is MIT licensed. Downloads use <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noopener noreferrer">yt-dlp</a> (Unlicense) and <a href="https://ffmpeg.org" target="_blank" rel="noopener noreferrer">ffmpeg</a> (LGPL/GPL). Built with plain HTML, CSS and JavaScript, with no third-party front-end libraries.</p>
    </section>`;
  return undefined;
}
