#!/data/data/com.termux/files/usr/bin/sh
# One-time setup for Android (Termux). Install Termux from F-Droid first (see README).
set -e
cd "$(dirname "$0")/.."
pkg update -y
pkg install -y nodejs python ffmpeg termux-api
termux-setup-storage || true            # lets Vidyra save into Downloads on your phone
pip install -U yt-dlp
mkdir -p "$HOME/storage/downloads/Vidyra" 2>/dev/null || true
echo ""
echo "Setup complete. Start Vidyra in the background (it keeps downloading when you switch apps):"
echo "  npm start"
echo "Stop it with: npm start -- stop      (all commands: npm start -- help)"
echo "For progress notifications, install the Termux:API app from F-Droid as well."
echo "Then open http://127.0.0.1:8787 in Chrome on this phone."
echo "Files are saved to Downloads/Vidyra (change the folder any time in Settings)."
