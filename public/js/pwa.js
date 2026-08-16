/****************************************************************************
 * pwa.js
 *
 * Progressive Web App glue: registers the service worker and precaches the
 * static resources so the app runs offline (Home, Configure, Upload,
 * Transfer). Load this file on every page.
 *
 * The cache list must be kept in sync with the list in service-worker.js.
 * Firebase SDK scripts, Cloud Storage results, and map tiles are NOT
 * precached: large result files would consume user storage and make the
 * result-expiry semantics confusing.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

// Cache name; bump the version whenever the cached file set changes.
const CACHE = 'snappergps-static-v2';

// Resources required for the offline experience. Keep in sync with the
// list inside service-worker.js.
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
 * Called on every page load so that a user who has not visited the home
 * page first still gets the offline experience.
 * @returns {Promise<void>}
 */
async function updateCache() {

    try {

        const cache = await caches.open(CACHE);
        await cache.addAll(CACHE_RESOURCES);
        console.log('Updated all resources in cache.');

    } catch (err) {

        // E.g., a resource failed to download. The service worker's
        // network-first fetch handler still caches on demand.
        console.warn('Could not precache all resources: ' + err.message);

    }

}

// Register the service worker (idempotent). The same file also works when
// it is loaded as a classic script (it defines the updateCache() global
// above), which keeps the old behaviour of caching the page's assets.
if ('serviceWorker' in navigator) {

    window.addEventListener('load', () => {

        navigator.serviceWorker.register('service-worker.js')
            .then(() => console.log('Service worker registered.'))
            .catch((err) => console.warn('Could not register service worker: ' + err.message));

    });

}

// Precache immediately (the registration above happens on load).
updateCache();
