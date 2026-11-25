'use strict';

const mediaPath = new URL('media/mobile/', self.registration.scope).pathname;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.pathname.startsWith(mediaPath) || !url.pathname.endsWith('.mp4')) return;

  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!range) return;

  const start = Number(range[1]);
  const last = start + (start === 0 ? 256 : 512) * 1024 - 1;
  if (range[2] && Number(range[2]) <= last) return;

  // Return the server's real partial response. The video element owns scheduling and seeks.
  event.respondWith(fetch(url, {
    headers: { Range: 'bytes=' + start + '-' + last },
    credentials: 'same-origin',
    signal: request.signal
  }));
});

