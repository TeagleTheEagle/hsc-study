// Bands for Days service worker (blueprint phase D).
// What it does: keeps the app shell (app.html, index.html, icons, manifest) and the subject files a student has
// opened so the cards and typed papers work offline. AI marking, sign-in and sync always need the network and are
// never cached. VERSION is written by tools/sw_version.py on every build; a new version replaces the old shell on
// the next visit and the page offers a reload.
const VERSION = 'db200cedfd';
const SHELL = 'bfd-shell-' + VERSION;
const DATA = 'bfd-data-v1';     // subjects/*.json, data/*.json (versioned by ?v=, so cache-first is safe)
const MEDIA = 'bfd-media-v1';   // papers/img/*, icons, fonts, vendor scripts (stale-while-revalidate)
const PRECACHE = ['./', 'index.html', 'app.html', 'manifest.webmanifest', 'favicon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-rounded.png', 'icons/apple-touch-icon.png',
  'data/nesa-papers.json'];
const MEDIA_LIMIT = 400;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(PRECACHE.map(async u => { try { await c.add(new Request(u, { cache: 'reload' })); } catch (_) { /* optional */ } }));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('bfd-shell-') && n !== SHELL).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
});

const sameOrigin = u => u.origin === self.location.origin;
const isHTML = u => u.pathname.endsWith('.html') || u.pathname.endsWith('/');

async function networkFirst(req, cacheName, fallbackUrl) {
  const c = await caches.open(cacheName);
  try {
    const r = await fetch(req);
    if (r && r.ok) c.put(req, r.clone());
    return r;
  } catch (_) {
    const hit = await c.match(req, { ignoreSearch: isHTML(new URL(req.url)) });
    if (hit) return hit;
    if (fallbackUrl) { const f = await c.match(fallbackUrl); if (f) return f; }
    return new Response('You are offline and this page is not saved on this device yet.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }
}

async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r && r.ok) c.put(req, r.clone());
  return r;
}

async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const refresh = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); trim(c); } return r; }).catch(() => null);
  return hit || (await refresh) || Response.error();   // behave like no worker: a network error, not a fake status
}

async function trim(c) {
  const keys = await c.keys();
  if (keys.length > MEDIA_LIMIT) await Promise.all(keys.slice(0, keys.length - MEDIA_LIMIT).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (sameOrigin(u)) {
    if (u.pathname.startsWith('/api/')) return;                       // marking and quota: network only
    if (req.mode === 'navigate' || isHTML(u)) { e.respondWith(networkFirst(req, SHELL, 'app.html')); return; }
    if (u.pathname.startsWith('/subjects/') || u.pathname.startsWith('/data/')) {
      e.respondWith(u.search.includes('v=') ? cacheFirst(req, DATA) : networkFirst(req, DATA)); return;
    }
    if (u.pathname.startsWith('/papers/img/') || u.pathname.startsWith('/icons/') || u.pathname === '/favicon.svg' || u.pathname === '/manifest.webmanifest') {
      e.respondWith(staleWhileRevalidate(req, u.pathname.startsWith('/papers/img/') ? MEDIA : SHELL)); return;
    }
    return;                                                           // PDFs and everything else: network
  }
  if (/supabase\.co$/.test(u.hostname) || u.hostname === 'api.anthropic.com') return;   // never cached
  if (u.hostname === 'cdn.jsdelivr.net' || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(staleWhileRevalidate(req, MEDIA));
  }
});
