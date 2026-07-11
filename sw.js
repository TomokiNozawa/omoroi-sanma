// おもろい三麻 — Service Worker (オフライン対応 + 通信料削減)
// 戦略:
//   - 牌画像 (assets/*.png) / CSS / JS: キャッシュ優先 (2回目以降は通信ゼロ、
//     CSS/JS は ?v= 付き URL がキーなので バージョンが変われば自動で取り直す)
//   - HTML: ネットワーク優先 + オフライン時はキャッシュ (更新が確実に届く)
//   - version.json: ネットワーク優先 (最新バージョン表示用)
// ※ リリース時は SW_VERSION を index/game.html の ?v= と同じ値に bump すること
const SW_VERSION = '0.9.4';
const CACHE_NAME = `omoroi-sanma-${SW_VERSION}`;

const TILE_FILES = [
  '1m.png', '9m.png',
  '1p.png', '2p.png', '3p.png', '4p.png', '5p.png', '6p.png', '7p.png', '8p.png', '9p.png',
  '1s.png', '2s.png', '3s.png', '4s.png', '5s.png', '6s.png', '7s.png', '8s.png', '9s.png',
  '東.png', '南.png', '西.png', '北.png', '白.png', '発.png', '中.png',
  '背面_緑.png', '背面_青.png', '背面_黄.png',
];

const PRECACHE = [
  './',
  'index.html',
  'game.html',
  'game',  // Cloudflare Pages の クリーンURL (308リダイレクト先)
  `style.css?v=${SW_VERSION}`,
  `script.js?v=${SW_VERSION}`,
  `firebase-config.js?v=${SW_VERSION}`,
  `net.js?v=${SW_VERSION}`,
  `netgame.js?v=${SW_VERSION}`,
  'manifest.json',
  ...TILE_FILES.map(f => 'assets/' + encodeURIComponent(f)),
  // ボイスファイル (未配置なら 404 → allSettled で skip、 配置後に自動キャッシュ)
  ...['riichi', 'ron', 'tsumo', 'kita'].flatMap(k => [`assets/voice/${k}.mp3`, `assets/voice/${k}.wav`]),
];

self.addEventListener('install', (event) => {
  // 個別 add + allSettled: 1ファイルの失敗で install 全体を落とさない
  // (取り漏れは fetch ハンドラの ランタイムキャッシュで補完される)
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(PRECACHE.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // version.json: ネットワーク優先 (オフライン時のみキャッシュ)
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // 画像 / CSS / JS: キャッシュ優先 (通信料削減の本体)
  if (/\.(png|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // HTML 等: ネットワーク優先、 オフライン時はキャッシュ
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true })
        .then(hit => hit || caches.match('index.html'))
    )
  );
});
