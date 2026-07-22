/* 서비스워커: 네트워크 우선 + 오프라인 폴백 캐시.
 * 항상 최신 코드를 먼저 받으므로 배포 후 구버전이 남는 문제가 없습니다. */
const CACHE = 'rems-v2';
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/crypto-util.js',
  './js/db.js',
  './js/data.js',
  './js/sync.js',
  './js/data.enc.js',
  './js/accounts.enc.js',
  './js/auth.js',
  './js/tax.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // GitHub API 등 외부 요청은 그대로

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true })
          .then(hit => hit || caches.match('./index.html'))
      )
  );
});
