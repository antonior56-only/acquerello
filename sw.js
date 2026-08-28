/*
 * Service Worker di Acquerello Pro.
 *
 * Va pubblicato nella STESSA cartella del file HTML dell'app (registrazione relativa:
 * navigator.serviceWorker.register('sw.js')). Funziona solo su connessioni HTTPS o su
 * localhost, come richiesto dallo standard dei Service Worker.
 *
 * Strategia di cache:
 *  - pagina dell'app: network-first (si tenta sempre la versione più recente online),
 *    con fallback alla copia in cache quando manca la connessione;
 *  - font di Google e altre risorse dello stesso dominio: cache-first con aggiornamento
 *    in background, dato che sono risorse statiche che cambiano raramente.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = 'acquerello-pro-cache-' + CACHE_VERSION;

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Non conosciamo in anticipo il nome esatto con cui questo file viene pubblicato
            // (index.html, acquerello-pro.html, ...): mettiamo in cache la pagina che ha
            // effettivamente registrato questo Service Worker, così il ricaricamento offline
            // funziona qualunque sia il nome scelto in fase di pubblicazione.
            const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
            const urlsToCache = new Set(clients.map((client) => client.url));
            urlsToCache.add(self.registration.scope);

            await Promise.all(
                Array.from(urlsToCache).map((url) =>
                    cache.add(url).catch(() => {
                        // Non blocchiamo l'installazione se una singola URL non è raggiungibile
                        // in questo momento: verrà comunque messa in cache alla prima visita utile.
                    })
                )
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key.startsWith('acquerello-pro-cache-') && key !== CACHE_NAME)
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

function isGoogleFontRequest(url) {
    return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

async function cacheFirstWithRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const networkFetchPromise = fetch(request)
        .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        // Aggiorniamo la cache in background senza far attendere la risposta all'utente.
        networkFetchPromise.catch(() => {});
        return cached;
    }
    const networkResponse = await networkFetchPromise;
    return networkResponse || new Response('Risorsa non disponibile offline.', { status: 503 });
}

async function networkFirstWithCacheFallback(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        const scopeFallback = await cache.match(self.registration.scope);
        if (scopeFallback) return scopeFallback;
        return new Response(
            'Sei offline e questa pagina non è ancora stata salvata in cache. Aprila almeno una volta con la connessione attiva.',
            { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (isGoogleFontRequest(url)) {
        event.respondWith(cacheFirstWithRevalidate(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstWithCacheFallback(request));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(cacheFirstWithRevalidate(request));
    }
});
