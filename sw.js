// 앱 화면 파일을 저장해 두어 인터넷이 없어도 메모장은 열리게 한다. (받아 적기는 인터넷 필요)
const CACHE = 'hamster-0.5.0-mwlpv7n7';
const SHELL = ['./', 'index.html', 'styles.css', 'web.css', 'renderer.js', 'basic-minutes.js', 'xlsx-lite.js', 'meeting-web.js',
  'register-sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // 새 버전을 먼저 받아 보고(3초 안에), 안 되면 저장해 둔 화면으로 연다
  e.respondWith(caches.open(CACHE).then(async (c) => {
    try {
      const r = await Promise.race([fetch(e.request), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  }));
});
