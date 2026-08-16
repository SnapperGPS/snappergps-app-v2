// Service worker that makes the website run offline.
// Author: Jonas Beuchert
// Sources:
// https://web.dev/offline-cookbook/
// https://developers.google.com/web/fundamentals/codelabs/offline
//
// The same file is also loaded as a classic script on some pages (see
// pwa.js), where it defines the global updateCache() helper that precaches
// the app shell on the first visit.

// Cache name; bump the version whenever the cached file set changes.
// Must be kept in sync with pwa.js.
const CACHE = 'snappergps-static-v2';

// Resources required for the offline experience (same list as in pwa.js).
// Firebase SDK scripts, Cloud Storage result files, and map tiles are
// deliberately NOT precached.
const CACHE_RESOURCES = [
    './',
    './index.html',
    './configure.html',
    './upload.html',
    './search.html',
    './view.html',
    './success.html',
    './privacy.html',
    './offline.html',
    './flash.html',
    './accelerometer.html',
    './animate.html',
    './manifest.json',
    './css/style.css',
    './css/upload.css',
    './images/favicon.ico',
    './images/icon-192.png',
    './images/icon-512.png',
    './images/icon-512-maskable.png',
    './js/deviceCommunication.js',
    './js/deviceInfo.js',
    './js/config.js',
    './js/firebase-init.js',
    './js/firestore-model.js',
    './js/storage-model.js',
    './js/encoding.js',
    './js/ui.js',
    './js/date-utils.js',
    './js/quota.js',
    './js/notifications.js',
    './js/offline.js',
    './js/upload-google.js',
    './js/download-google.js',
    './js/pwa.js',
    './js/configure/configureComms.js',
    './js/configure/configureUI.js',
    './js/configure/flashUI.js',
    './js/upload/uploadUI.js',
    './js/view/searchUI.js',
    './js/view/viewUI.js',
    './js/accelerometer/accelerometerUI.js',
    './js/animate/animateUI.js',
    './strftime-min.js',
    './FileSaver.js',
    './jszip.min.js',
    './firmware/SnapperGPS-Basic.bin',
    './firmware/SnapperGPS-Capacitance-Triggered.bin',
    './firmware/SnapperGPS-Accelerometer.bin'
];

/**
 * Populate the cache with all resources listed in CACHE_RESOURCES.
 * @returns {Promise<void>}
 */
async function updateCache() {

    try {

        const cache = await caches.open(CACHE);
        await cache.addAll(CACHE_RESOURCES);
        console.log('Updated all resources in cache.');

    } catch (err) {

        console.warn('Could not precache all resources: ' + err.message);

    }

}

// Precache the app shell as soon as the service worker is installed.
self.addEventListener('install', function (event) {

    event.waitUntil(updateCache());

    // Activate immediately, without waiting for all clients to close.
    self.skipWaiting();

});

// Take control of already-open pages as soon as the new worker is active.
self.addEventListener('activate', function (event) {

    event.waitUntil(
        caches.keys().then(function (keys) {

            return Promise.all(
                keys.filter(function (key) {
                    return key !== CACHE;
                }).map(function (key) {
                    return caches.delete(key);
                })
            );

        }).then(function () {

            return self.clients.claim();

        })
    );

});

// Service worker intercepts requests to resources.
// Mode: network, falling back to cache. Navigation requests that fail
// (offline) are answered with the offline page.
self.addEventListener('fetch', function (event) {

    const request = event.request;

    // Only handle same-origin GET requests. Firebase/Cloud Storage traffic
    // is cross-origin (and mostly XHR) and is left untouched, so result
    // files are never cached by the service worker.
    if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {

        return;

    }

    // Navigations: network first, offline page as fallback.
    if (request.mode === 'navigate') {

        event.respondWith(
            fetch(request)
                .then(function (response) {
                    return response;
                })
                .catch(function () {
                    return caches.match('offline.html');
                })
        );
        return;

    }

    // Static resources: network first, cache as fallback.
    event.respondWith(
        fetch(request)
            .then(function (response) {

                // Store successful responses in the cache for later offline use.
                if (response.ok) {

                    const copy = response.clone();
                    caches.open(CACHE).then(function (cache) {
                        cache.put(request, copy);
                    }).catch(function () {});

                }

                return response;

            })
            .catch(function () {
                return caches.match(request);
            })
    );

});

// Register event listener for the 'push' event.
self.addEventListener('push', function (event) {

    console.log('Push notification received.');

    // The payload is the upload ID; ignore empty payloads.
    const uploadID = event.data ? event.data.text() : '';

    if (!uploadID) {

        return;

    }

    // Keep the service worker alive until the notification is created.
    event.waitUntil(
        self.registration.showNotification('SnapperGPS - ' + uploadID, {
            body: 'I have processed your data. Click here ' +
                  'to view and download your track.',
            icon: 'images/icon-512.png',
            data: uploadID
        })
    );

});

self.addEventListener('notificationclick', function (event) {

    console.log('Notification click received.');

    const uploadID = event.notification.data;

    event.notification.close();

    // Build the view URL relative to the site's root (GitHub Pages
    // project site), so this works regardless of the deployment domain.
    const viewUrl = new URL('./view.html?uploadid=' + encodeURIComponent(uploadID), self.registration.scope);

    event.waitUntil(
        clients.openWindow(viewUrl.href)
    );

});
