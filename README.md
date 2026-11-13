# Vidyra

**Universal video & audio downloader.** Paste a link, choose the quality and format you want, and Vidyra downloads it in the background with a live queue, a library and a built-in player. Send a finished file to your phone with one tap, or keep it on the server.

Vidyra is a self-hosted web app. It runs on your computer, a home server or an Android phone (through Termux), and you use it from any browser. Its engine is [yt-dlp](https://github.com/yt-dlp/yt-dlp), with [ffmpeg](https://ffmpeg.org) for merging and conversion. The app has no third-party front-end libraries and no npm dependencies.

> **Use it responsibly.** Download only content you own, content its creator has licensed for download, or content you otherwise have the right to save. Downloading can violate a site's terms of service or copyright law in your country. You are responsible for how you use Vidyra.

---

## 2.7.0 — 12 custom-made Vidyra features (from scratch)

Original features designed for this app (not cloned from other downloaders):

1. **Watch Later shelf** — save links without downloading; one-tap open later
2. **Mood tags** — tag downloads study / music / backup / watch / work / fun
3. **Format advisor** — suggests audio for long videos
4. **Quiet hours** — soft-pause new starts in a nightly window
5. **Focus mode** — hide chrome (`F` key) for distraction-free downloading
6. **Auto night theme** — force dark 20:00–07:00 when theme is System
7. **Download streak** — consecutive days with a finished download
8. **Speed snapshot history** — rolling average KB/s shown on Queue
9. **Download receipts** — copy a text receipt of finished jobs
10. **Expandable job logs** (queue) + mood pills on cards
11. **Custom feature settings panel** — toggles for all of the above
12. **Haptic + density + offline banner** polish tied into the new modes

## 2.6.0 — 50+ feature mega update

Built on research of Seal, YTDLnis, yt-dlp app, Parabolic, Youwee and self-hosted front-ends.

### Download
1. Edit file name before download
2. SponsorBlock segment removal
3. Time-range clip (start/end seconds)
4. Embed chapters
5. Embed thumbnail
6. Embed subtitles + language list
7. Batch multi-link paste (video or audio)
8. Playlist whole-list toggle
9. Duplicate-in-library notice
10. Confirm dialog shows edited name
11. Recent links chips
12. Clipboard paste button
13. Write description sidecar (engine)
14. Write info.json sidecar (engine)
15. Safe filename sanitization

### Queue
16. Status filter chips (All / Active / Waiting / Done / Failed)
17. Search/filter by title
18. Expandable download logs
19. Copy all errors
20. Retry all failed
21. Clear finished
22. Live speed / ETA / percent
23. Pause / resume / cancel / retry

### Library & player
24. Multi-select + bulk delete
25. Picture-in-picture
26. Native Share
27. Playback speed
28. Fullscreen
29. In-app player for video & audio
30. Free space indicator
31. Leftover cleanup
32. Sort newest / largest / name
33. Type filters (video / audio / other)

### Search
34. Streamed YouTube results
35. 16 Explore categories
36. Duration filters
37. Sort (relevance / views / length / title)
38. Favorites / saved videos
39. Batch Download selected
40. One-tap Audio on cards
41. Copy selected links
42. Search history chips

### Settings & shell
43. Custom filename template
44. Extra yt-dlp arguments
45. Auto-clean finished queue (days)
46. Speed limit
47. Parallel downloads slider
48. Fragment threads
49. Cookies file path
50. Export / import preferences
51. 8 accent colours (incl. violet, teal, coral)
52. Comfortable / compact density
53. Haptic feedback toggle
54. Theme system / light / dark
55. Animations on/off
56. Sounds on/off
57. Offline banner
58. Keyboard shortcuts (documented in About)
59. Full-width 5-column bottom nav
60. PWA install + share target

## 2.5.0 — rename before download + 20+ researched power features

Researched against Seal, YTDLnis, yt-dlp app, Parabolic, Youwee and other leading yt-dlp front-ends.

**Headline**

1. **Edit file name before download** — after Fetch info, change the title; the saved file uses your name (id kept for uniqueness).

**20+ ultimate features in this release (and retained)**

2. **SponsorBlock removal** — strip sponsor / self-promo / interaction segments
3. **Time-range clip** — download only a start→end section (seconds)
4. **Embed chapters** toggle
5. **Embed thumbnail / subtitles** (existing, refined)
6. **Batch multi-link paste** — one URL per line → queue all as video or audio
7. **Custom global filename template** (Settings)
8. **Extra yt-dlp arguments** (Settings)
9. **Auto-clean finished queue entries** after N days
10. **Library multi-select + bulk delete**
11. **Picture-in-picture** player button
12. **Native file Share** from the player
13. **Export / import preferences** JSON
14. **One-tap Audio** on Search cards
15. **Batch Download selected** Search results
16. **16 Explore categories**
17. **Keyboard shortcuts** for tabs
18. **Full-width 5-column bottom nav**
19. **Playback speed** controls in the player
20. **Playlist whole-list toggle** when a playlist URL is detected
21. **Duplicate-in-library notice** before re-downloading
22. **Confirm-before-download** with the edited file name shown
23. **Recent links** chips on the Download tab
24. **Safe filename sanitization** for Windows / mobile paths

## 2.4.0 — advanced downloads, library bulk actions & player upgrades

Custom filename template, extra yt-dlp args, auto-clean queue, library multi-select, PiP, Share, export/import prefs, one-tap Audio, batch selected, Explore categories, keyboard shortcuts, full-width nav.

## 2.3.0 — full-width tabs, batch download & more discoverability

**Fixed**

- **Bottom navigation bar.** Icons and labels now span the full width of the phone bar (5 equal columns instead of an uneven 6-column grid).

**New & improved**

- Full-width tab bar, batch “Download selected”, 16 Explore categories, keyboard shortcuts, clearer selection toolbar, improved icon sizing, safer badge placement, and related polish.

## 2.2.2 — one start command, commands, sounds and tidier tabs

- `npm start` is now the only background command (`npm start -- status | stop | logs | foreground`). `scripts/daemon.sh` is removed.
- A command set that works the same from Termux and from the app: `npm start -- help`, plus **Settings → Commands**. See the Commands section below.
- Termux: test runs no longer start Android notification processes, and at most one notification runs at a time. This fixes the "Killed" stop of `npm test` on phones with many updates.
- More sounds (done, tick, pop, whoosh, warn, cancel, delete); the Settings sound button plays each one in turn.
- More animations (floating empty-state icons, striped progress bars, bouncing tab icons, staggered settings cards). All of them stop when motion is off.
- Library: search and sort sit on one row on phones.

## 2.2.0 — fixes and new features

**Fixed**

- **Quality list.** Sources report odd heights (1012, 1350, 2026). They are now shown and downloaded as the standard step (1080p, 1440p, 2160p). Before, a choice like "2026p" was silently replaced by "best available".
- **Leftover files in the Library.** Thumbnails (`.webp`), subtitle files (`.vtt`) and yt-dlp's fragment and `.part` files are no longer listed as downloads. Leftovers from finished and failed downloads are removed.
- **Video titles with a tab character** were cut at the tab in search results.
- **Library reloads** no longer happen on every progress update.
- **Search** asks for the access token instead of showing an error, and "Shortest first" sorts correctly.
- **Settings** no longer resets a slider you are dragging every minute.
- **Stopping the server** no longer marks running downloads as cancelled. They resume when Vidyra starts again.
- **Hidden panels** stay hidden.
- **File streaming** cannot take the server down when a file disappears during playback.

**Removed**

- The **Terminal** tab and its server route.

**New**

| Feature | Where |
|---|---|
| **Save to this device.** A second download button. The server finishes the file, then hands it to the browser, whose own download manager starts at once and shows progress. | Download tab |
| **Android progress notifications** through Termux:API: one notification per download with a progress bar, speed and time left, then a result. | Settings → Notifications |
| **Background notifications** in the browser show a text progress bar while Vidyra is in the background. | Settings → Notifications |
| **Keeps working in the background.** The queue is saved to disk and resumes after a restart. `npm start` runs Vidyra detached, with a wake lock on Android. | Settings → Background |
| **Automatic retries** for temporary failures (network drops, rate limits, server errors). Choose 0–3 retries. | Settings → Downloads |
| **Speed limit** for each download (500 KB/s up to 10 MB/s). | Settings → Downloads |
| **Cookies file** for private and age-restricted videos. Enter the path to a `cookies.txt` file. | Settings → Downloads |
| **Share to Vidyra.** On Android, Share → Vidyra opens the link on the Download tab. | Android share sheet |
| **Recent links** on the Download tab. | Download tab |
| **Already in your library** warning when a video was downloaded before. | Download tab |
| **Retry failed** for every failed or cancelled download at once. **Copy details** for an error report. | Queue tab |
| **Attempt count** and "retrying in N s" on queued items. | Queue tab |
| **Sort** by newest, largest or name, and **free space** on the device. | Library tab |
| **Clean up leftovers** in one tap. Finished videos and audio are never touched. | Library tab |
| **Speed limit, retries and cookies** are used by every new download. | Settings |

---

## What you need

| Requirement | Why | Get it |
|---|---|---|
| **Node.js 18.17+** | Runs the Vidyra server | <https://nodejs.org/en/download> |
| **yt-dlp** | Downloads and searches | `pip install -U yt-dlp`, or the setup script downloads it |
| **ffmpeg** | Merges video and audio, converts to MP3 and other formats | <https://ffmpeg.org/download.html> |
| **Termux:API** (optional, Android) | Progress notifications on the phone | Install the Termux:API app from F-Droid, then `pkg install termux-api` |

The Settings → Tools section shows whether yt-dlp and ffmpeg are installed and their versions. It also offers an **Update yt-dlp** button, which matters because sites change often.

---

## Quick start

### Windows, macOS or Linux

```sh
unzip vidyra.zip && cd vidyra
sh scripts/setup.sh        # checks Node.js, installs yt-dlp if needed, checks ffmpeg
npm start                  # or: sh start.sh   (Windows: double-click start.bat)
```

Open **http://127.0.0.1:8787**.

### Android (Termux), fully on your phone

1. Install **Termux** and **Termux:API** from F-Droid (the Play Store builds are outdated).
2. In Termux:
   ```sh
   pkg install unzip
   termux-setup-storage
   unzip ~/storage/downloads/vidyra.zip -d ~ 2>/dev/null || true
   cd vidyra && sh scripts/termux-setup.sh
   npm start                        # runs in the background
   ```
3. Open **http://127.0.0.1:8787** in Chrome on the same phone and choose *Add to Home screen*.
4. In Android settings, set **Termux** and **Chrome** to *Don't optimise* (battery settings), so Android does not stop downloads while the screen is off.

Files are saved to `Downloads/Vidyra` on your phone. Change the folder any time in Settings.

### From your phone, while Vidyra runs on a computer (same Wi-Fi)

```sh
HOST=0.0.0.0 npm start
```

The console prints an **access token** and the computer's address. Open `http://<computer-ip>:8787` on the phone and enter the token. Share the token only with people you trust.

### Docker

```sh
docker build -t vidyra .
docker run -p 8787:8787 -v "$PWD/downloads:/data" vidyra
```

Set `-e ACCESS_TOKEN=yourtoken` to choose the token. Otherwise a random one is printed in the logs. The queue is saved in `/data/jobs.json`, so keep the volume.

---

## Background mode

Downloads run on the server, so closing the page or switching apps does not stop them.

One command does it all:

```sh
npm start                  # start in the background (keeps a wake lock on Termux)
npm start -- status        # is it running?
npm start -- logs          # the last lines of the log
npm start -- stop          # unfinished downloads resume the next time you start
npm start -- foreground    # run in this terminal instead (Ctrl+C stops it)
```

## Commands

Everything in the app can also be done from the command line (Termux or any terminal) and from the **Settings → Commands** panel. They are the same commands, so they behave the same everywhere. Run `npm start -- help` for the list.

```sh
npm start -- info                              # version, folder, free space, tools, queue counts
npm start -- add "https://…" --height=720      # queue a video (--audio, --container=mkv, --deliver)
npm start -- list [all|active|done|failed]     # the queue
npm start -- pause|resume|cancel|retry <id>    # one download (ids come from list)
npm start -- retry-failed                      # queue every failed download again
npm start -- clear                             # remove finished entries from the list
npm start -- files                             # finished files in your folder
npm start -- delete <file name>                # delete one file
npm start -- clean                             # remove leftover thumbnails, subtitles and parts
npm start -- search lofi music --limit=5       # search videos
npm start -- settings                          # show settings
npm start -- set speed 2M                      # also: set folder|retries|parallel|fragments|cookies|notify
npm start -- update-ytdlp                      # update yt-dlp
npm start -- folder                            # print the download folder
```

The commands only run Vidyra's own actions. They are not a shell. The server must be running for them (start it with `npm start`). If you set `ACCESS_TOKEN`, pass it the same way: `ACCESS_TOKEN=… npm start -- list`.

- The queue is saved in `jobs.json`. A download that was waiting or running starts again automatically after a restart.
- When Vidyra stops, running downloads go back to the queue. yt-dlp continues from its `.part` file.
- Temporary failures are retried automatically (Settings → Downloads → *Retry temporary failures*).

### Notifications

| Where you use Vidyra | What you see |
|---|---|
| Android with Termux:API | One notification per download with a progress bar, percent, speed and time left, then *Download complete* or *Download failed*. |
| Browser, while Vidyra is in the background | A notification with a text progress bar, then the result (turn on in Settings → Notifications). |
| *Save to this device* | Chrome's own download notification with its progress bar, which is the same as any file you download on the phone. |

The Termux notification draws its progress bar as text (a bar of blocks and a percentage). Chrome's own download notification, used by *Save to this device*, shows Android's progress bar.

---

## Using Vidyra

1. **Download tab.** Paste a link (or tap *Paste*, or share a link to Vidyra), then press **Fetch info**.
2. Choose **Video** or **Audio only**.
3. Pick the **quality** and **container** (video) or **audio format**.
4. Pick an **audio language** if the menu offers one. Optionally embed the thumbnail or subtitles.
5. Press **Download in Vidyra** to keep the file in your library, or **Save to this device** to send the finished file to your browser.
6. Watch progress in the **Queue** tab. Pause, resume, cancel or retry at any time.
7. Open the **Library** tab to play, save or delete files. Use **Clean up** when leftovers show up.

**Search tab:** type a query and press **Search**. Results stream in as they are found, and **Load more** adds the next page. Press **Download** on a result to send it to the Download tab.

### Qualities

Each choice is a standard step: 144p, 240p, 360p, 480p, 720p, 1080p, 1440p (2K), 2160p (4K) or 4320p (8K). A source that offers 2026 pixels high is listed as 2160p with "source 2026p" next to it. Vidyra then downloads that source format.

### Dubbed voices

Some creators upload the same video with several audio tracks. Vidyra lists those tracks under *Audio language*. Choosing **Hindi** downloads the video with the Hindi track.

- Vidyra selects a dub that already exists. It cannot create or translate one.
- If the menu shows one track, that video has no dub.
- Some channels publish the dub as a separate video. Paste that link instead.

---

## Configuration

Settings are changed in the app (Settings tab) and saved to `config.json` next to `server.js`. An environment variable always wins at startup.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Web port |
| `HOST` | `127.0.0.1` | `0.0.0.0` allows other devices on your network (then a token is required) |
| `ACCESS_TOKEN` | random when `HOST` is not local | Token for API and file access |
| `DOWNLOAD_DIR` | Your Downloads folder + `Vidyra` | Where files are saved |
| `MAX_PARALLEL` | `2` | Simultaneous downloads (1–6) |
| `CONCURRENT_FRAGMENTS` | `8` | Connection threads per download (1–32) |
| `SPEED_LIMIT` | unlimited | Per-download speed, for example `2M` or `500K` |
| `YTDLP_BIN` | `bin/yt-dlp`, then `yt-dlp` on PATH | Path to yt-dlp |
| `FFMPEG_BIN` | `ffmpeg` on PATH | Path to ffmpeg |
| `VIDYRA_CONFIG` | `config.json` next to `server.js` | Where saved settings live. `jobs.json` is saved next to it. |

Configuration files from earlier releases are read as they are. Settings written by 2.2.0 add `speedLimit`, `retries`, `cookiesFile` and `termuxNotify`.

---

## Privacy and security

- Vidyra listens only on your own machine by default. When you open it to the network, every request needs the access token.
- Requests that change anything must be JSON. This blocks cross-site form attacks.
- Requests whose `Host` header is not `localhost` are refused in local mode, which blocks DNS-rebinding attacks.
- File names are reduced to their base name, so the API cannot read or delete anything outside the downloads folder.
- Cookies files are read only from a full path you set in Settings.
- Preferences (theme, sounds, notifications) and the saved token live only in your browser's local storage.

---

## Project layout

```
server.js              HTTP server, JSON API, routing, access checks, shutdown
src/config.js          Brand, paths, platform detection, saved settings
src/ytdlp.js           yt-dlp wrapper: safe arguments, quality tiers, info, search, downloads
src/jobs.js            Download queue: workers, pause/resume, cancel, retries, saved queue
src/notify.js          Android notifications through Termux:API
src/files.js           Library: classify, list, clean up and resolve files safely
src/tools.js           Detects yt-dlp and ffmpeg and their versions
src/events.js          Live updates to the browser (Server-Sent Events)
src/http.js            JSON replies, body limits, static files, byte-range serving
public/index.html      App shell and icon sprite
public/css/app.css     Design system: themes, layout, components, motion
public/js/             Application code (core, router, views/*)
public/sw.js           Service worker: app-shell cache and notification clicks
public/manifest.webmanifest, public/icons/, public/logo.svg   Install metadata, share target, brand
scripts/               setup.sh (Linux/macOS), termux-setup.sh (Android); cli.js and src/daemon.js (`npm start`, background control); src/commands.js (every command)
test/                  Unit, server, auth and feature tests (npm test)
```

## API

All API routes need the `x-token` header (or `?token=`) when a token is set. Send requests as JSON.

| Route | Description |
|---|---|
| `GET /api/health` | Public status and version |
| `GET /api/settings[?refresh=1]` | Folder, limits, retries, speed, cookies, notifications, folder presets and tool status |
| `POST /api/settings` | `{downloadDir?, maxParallel?, concurrentFragments?, speedLimit?, retries?, cookiesFile?, termuxNotify?}` |
| `POST /api/tools/ytdlp/update` | Update yt-dlp |
| `POST /api/info` | `{url}`: title, thumbnail, quality steps, audio languages |
| `GET /api/search?q=&limit=` | Streams results as newline-delimited JSON |
| `POST /api/download` | Queue a download (`url, mode, height, container, audioFormat, audioLang, subs, subLangs, thumbnail, playlist, deliver`) |
| `GET /api/jobs` · `DELETE /api/jobs/:id` | List jobs · remove a finished job |
| `POST /api/jobs/:id/pause \| resume \| cancel \| retry` | Control a job |
| `POST /api/jobs/retry-failed` | Queue every failed or cancelled download again |
| `POST /api/jobs/clear-finished` | Remove finished jobs |
| `GET /api/events` | Live job updates (Server-Sent Events) |
| `GET /api/files` | Library: files with their role, free space and leftovers |
| `POST /api/files/cleanup` | Remove leftover thumbnails, subtitle files and unused partial files |
| `DELETE /api/files/:name` | Delete a file |
| `GET /files/:name[?dl=1]` | Stream a file (Range supported) or download it |
| `POST /api/open-folder` | Open the downloads folder in the file manager |

---

## Troubleshooting

- **"yt-dlp is not installed."** Run `sh scripts/setup.sh`, or `pip install -U yt-dlp`. Then press **Re-check** in Settings → Tools.
- **A download fails with "HTTP Error 403" or "unsupported".** Update yt-dlp (Settings → Tools → *Update yt-dlp*) and press **Retry** in the Queue.
- **"The site is rate-limiting requests."** Wait a minute and retry, or set a speed limit or fewer threads in Settings.
- **Private or age-restricted videos.** Export `cookies.txt` with a browser extension and enter its full path in Settings → Downloads → *Cookies file*.
- **Downloads stop on the phone.** Start Vidyra with `npm start`, and set Termux and Chrome to *Don't optimise* in the battery settings.
- **No Android notifications.** Install the Termux:API app, run `pkg install termux-api`, and turn on *Android notifications (Termux)* in Settings.
- **No sound or merge errors.** Install ffmpeg (`pkg install ffmpeg` in Termux, `sudo apt install ffmpeg`, or `brew install ffmpeg`).
- **The phone cannot reach the computer.** Use `HOST=0.0.0.0`, the same Wi-Fi, and allow port 8787 in the firewall.
- **Pause and resume are missing on Windows.** Pause uses process signals that Windows does not provide. Cancel and retry work everywhere.

---

## Development

```sh
npm test          # unit, server, auth and feature tests (uses a fake yt-dlp and a real ffmpeg when available)
npm start         # run locally
```

The test suite never touches the network. `test/fixtures/fake-yt-dlp` stands in for yt-dlp, so the tests check Vidyra's own behaviour. Verify real sites with a real yt-dlp build.

## Licence

Vidyra is released under the MIT licence. yt-dlp is [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). ffmpeg is LGPL or GPL, depending on how it was built.
