// Service worker for the I CAN Safeguarding PWA.
//
// Strategy: network-first for the HTML shell (so staff always get the latest
// deployed version while online — this app changes often), cache-first for
// versioned static assets (vendor JS, icons, manifest). Nothing from the
// Apps Script backend is ever cached — those calls are POST-only (see
// README "Security model"), and this worker never intercepts non-GET or
// cross-origin requests, so live case data always goes straight to network.
//
// Auto-update: skipWaiting()+clients.claim() mean a newly deployed worker
// takes over immediately rather than waiting for every tab to close, and
// network-first HTML means the next load picks up the new version with no
// "update available" prompt needed.

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'safeguarding-shell-' + CACHE_VERSION;

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './vendor/lucide-0.462.0.js',
  './vendor/chart-4.4.7.umd.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-32.png',
  './icons/icon-16.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const shell = await caches.match('./index.html');
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  cache.put(req, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POSTs (every backend call)

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let CDN/fonts/Apps Script pass straight through

  if (req.mode === 'navigate' || req.url.endsWith('/index.html') || url.pathname === '/') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});
