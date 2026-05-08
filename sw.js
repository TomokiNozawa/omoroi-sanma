// おもろい三麻 — Service Worker (Phase 1 minimal)
// Phase 2 で cache 戦略を本実装、 現段階は登録のみ
const SW_VERSION = '0.1.0';
const CACHE_NAME = `omoroi-sanma-${SW_VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Phase 1 はネットワーク優先 (Cloudflare Pages の CDN に頼る)
self.addEventListener('fetch', (event) => {
  // pass-through
});
