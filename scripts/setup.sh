#!/bin/sh
# Vidyra setup for Linux and macOS.
# Checks Node.js, makes sure yt-dlp is available (uses the one on PATH, otherwise downloads a standalone
# copy into ./bin) and reports whether ffmpeg is installed.
set -e
cd "$(dirname "$0")/.."
mkdir -p bin downloads

echo "==> Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is required. Install it from https://nodejs.org/en/download and run this again."
  exit 1
fi
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' || {
  echo "Node.js $(node -v) is too old. Vidyra needs version 18 or newer."
  exit 1
}
echo "    found $(node -v)"

echo "==> yt-dlp (downloader engine)"
if command -v yt-dlp >/dev/null 2>&1; then
  echo "    found on PATH: $(yt-dlp --version)"
else
  case "$(uname -s)" in
    Darwin) ASSET=yt-dlp_macos ;;
    *) ASSET=yt-dlp ;;
  esac
  URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/$ASSET"
  echo "    downloading $URL"
  if command -v curl >/dev/null 2>&1; then curl -fL --progress-bar "$URL" -o bin/yt-dlp
  else wget -O bin/yt-dlp "$URL"; fi
  chmod +x bin/yt-dlp
  echo "    installed bin/yt-dlp: $(bin/yt-dlp --version)"
fi

echo "==> ffmpeg (merges video and audio, converts to MP3, FLAC and more)"
if command -v ffmpeg >/dev/null 2>&1; then
  echo "    found: $(ffmpeg -version | head -n 1)"
else
  echo "    NOT FOUND. Install it, then run this script again:"
  echo "      Debian/Ubuntu:  sudo apt install ffmpeg"
  echo "      Fedora:         sudo dnf install ffmpeg"
  echo "      macOS:          brew install ffmpeg"
fi

echo ""
echo "Done. Start Vidyra with:  npm start   (or:  sh start.sh)"
echo "Then open http://127.0.0.1:8787 in your browser."
