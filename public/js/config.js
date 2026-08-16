/****************************************************************************
 * config.js
 * Firebase / cloud configuration for the SnapperGPS web app.
 *
 * This is the single place where the cloud endpoints and limits are
 * configured. The app is served as a static site on GitHub Pages and talks
 * to Firebase (anonymous auth, Firestore, Cloud Storage) plus one tiny
 * server-side quota gate (Cloud Run) that is the only place which may
 * create upload documents.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

// Your web app's Firebase configuration.
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCPrA528T7xQr4HKNvGRmT9FaKcylYAGfc',
    authDomain: 'snappergps-prod-data.firebaseapp.com',
    projectId: 'snappergps-prod-data',
    storageBucket: 'snappergps-prod-data.firebasestorage.app',
    messagingSenderId: '862041235274',
    appId: '1:862041235274:web:feae362e48307c10c1abb3'
};

// HTTPS endpoint of the tiny quota gate ("reserve upload slot").
// It runs as a Cloud Run service (a Python function) and is the ONLY
// component that may create uploads/{uploadId} documents in Firestore and
// reserve quota in quotaDaily/quotaMonthly. The browser calls it with a
// Firebase ID token in the Authorization header.
const RESERVE_UPLOAD_SLOT_URL = 'https://reserve-upload-slot-862041235274.us-central1.run.app';

// reCAPTCHA Enterprise site key for Firebase App Check.
// Leave empty to skip App Check initialisation (e.g., while App Check is
// still in monitor mode). Once a key exists, paste it here and the app
// will load the App Check SDK on demand and attach App Check tokens to
// Firestore/Storage requests.
const RECAPTCHA_ENTERPRISE_SITE_KEY = '6LfAKIktAAAAAD4gl6sADdrrD-eFZGWlNh_9Kytt';

// Hard limits enforced client-side as a first line of defence. The quota
// gate enforces the authoritative limits server-side; these mirrors only
// avoid obviously invalid requests.
const MAX_SNAPSHOTS_PER_UPLOAD = 50000;
const MAX_GZIP_BYTES_PER_UPLOAD = 150 * 1024 * 1024; // 150 MB
const MAX_UPLOADS_PER_DAY = 25;
const MAX_RESERVED_GZIP_BYTES_PER_DAY = 600 * 1024 * 1024; // 600 MB
const MAX_UPLOADS_PER_MONTH = 250;
const MAX_RESERVED_GZIP_BYTES_PER_MONTH = 18 * 1024 * 1024 * 1024; // 18 GB
const MAX_CLASS_A_ESTIMATE_PER_MONTH = 4000;
const MAX_CLASS_B_ESTIMATE_PER_MONTH = 40000;
