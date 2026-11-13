@echo off
title Vidyra
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 18 or newer is required. Get it from https://nodejs.org/en/download
  pause
  exit /b 1
)
node server.js
pause
