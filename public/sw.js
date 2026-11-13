'use strict';
// Vidyra service worker.
//  1. Shell cache: network-first, so a new version reaches the phone as soon as it is online;
//     the cached copy is used only when offline. API and file routes are never cached.
//  2. Notifications: Android Chrome requires ServiceWorkerRegistration.showNotification(), and a tap
//     on the notification focuses the app (or opens it) on the Queue tab.
const VERSION = 'vidyra-3.4.1';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/css/splash.css',
  '/js/app.js',
  '/js/splash.js',
  '/js/core.js',
  '/js/fx.js',
  '/js/palette.js',
  '/js/player.js',
  '/js/music-player.js',
  '/js/views/download.js',
  '/js/views/search.js',
  '/js/views/music.js',
  '/js/views/queue.js',
  '/js/views/tools.js',
  '/js/views/console.js',
  '/js/views/library.js',
  '/js/views/settings.js',
  '/js/views/settings-common.js',
  '/js/views/settings-downloads.js',
  '/js/views/settings-appearance.js',
  '/js/views/settings-advanced.js',
  '/js/views/about.js',
  '/logo.svg',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/'))) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/#/queue', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.location.origin));
      if (open) {
        open.postMessage({ type: 'navigate', url: target });
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
