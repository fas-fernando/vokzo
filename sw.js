// =========================================================================
// SERVICE WORKER - ALERTA VENCIMENTO (PWA CACHE BASE & OFFLINE FIRST)
// =========================================================================

const CACHE_NAME = 'alerta-pro-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/html5-qrcode.min.js',
  'https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'
];

// 1. Instalação: Realiza o cache da estrutura base
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 [PWA Service Worker]: Cacheando estrutura base (HTML, Scripts e Módulos)...');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Alguns recursos externos falharam no pre-cache inicial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 2. Ativação: Limpeza imediata de versões antigas do cache
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('🧹 [PWA Service Worker]: Removendo cache obsoleto:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Interceptação de Requisições (Fetch)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // A) ROTAS DE API (/api/*) NUNCA SÃO RETIDAS PELO SERVICE WORKER
  // A persistência offline e reenvio de produtos é gerida pela Fila Offline do app
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // B) NAVEGAÇÃO DE PÁGINA (ex: abrir o app na câmara fria sem sinal)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          // Se não houver internet (ex: câmara fria), devolve imediatamente o index.html em cache!
          return caches.match('/index.html').then((cached) => {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // C) ESTRATÉGIA CACHE-FIRST PARA ARQUIVOS ESTÁTICOS (JS, CSS, Imagens, Manifest)
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && req.method === 'GET') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, clone);
          });
        }
        return networkResponse;
      }).catch((err) => {
        console.warn('Recurso não encontrado offline:', req.url);
      });
    })
  );
});
