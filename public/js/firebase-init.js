/****************************************************************************
 * firebase-init.js
 *
 * Initialises the Firebase app (anonymous auth, Firestore, Cloud Storage)
 * and provides the shared authentication helpers used by the rest of the
 * front end. Loaded as a classic script AFTER the Firebase compat SDK
 * scripts (https://www.gstatic.com/firebasejs/12.0.0/firebase-*-compat.js).
 *
 * Global API provided by this file:
 *   ensureAnonymousUser()            -> Promise<User>  sign in anonymously
 *   getFirebaseIdToken()             -> Promise<string|null>  fresh ID token
 *   initialiseAppCheckIfConfigured() -> Promise<void>  App Check (lazy)
 *   firebaseApp / firebaseAuth / firebaseDb / firebaseStorage
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/* global firebase, FIREBASE_CONFIG, RECAPTCHA_ENTERPRISE_SITE_KEY */

// The Firebase app is initialised as soon as this script runs.
var firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);

// Anonymous authentication. It is silent from the user's perspective: no
// account, no password, no upload code. The resulting uid is what
// Firestore/Storage security rules use to associate an upload with this
// browser session.
var firebaseAuth = firebase.auth(firebaseApp);

// Firestore metadata and Cloud Storage for raw/result objects.
var firebaseDb = firebase.firestore(firebaseApp);
var firebaseStorage = firebase.storage(firebaseApp);

/**
 * Make sure an anonymous user exists and return it.
 * Idempotent: resolves immediately if an anonymous user is already signed
 * in, otherwise restores a cached anonymous session or creates a new one.
 * @returns {Promise<Object>} Firebase User object.
 */
function ensureAnonymousUser() {

    if (firebaseAuth.currentUser) {

        return Promise.resolve(firebaseAuth.currentUser);

    }

    return new Promise((resolve, reject) => {

        const unsubscribe = firebaseAuth.onAuthStateChanged(async (user) => {

            try {

                if (user) {

                    // A cached anonymous session was restored.
                    unsubscribe();
                    resolve(user);

                } else {

                    // No session yet: create a fresh anonymous account.
                    const credential = await firebaseAuth.signInAnonymously();
                    unsubscribe();
                    resolve(credential.user);

                }

            } catch (error) {

                unsubscribe();
                reject(error);

            }

        });

    });

}

/**
 * Return a fresh Firebase ID token for the current anonymous user, or null
 * if no user is signed in. Used as `Authorization: Bearer <token>` when
 * talking to the quota gate.
 * @returns {Promise<string|null>}
 */
async function getFirebaseIdToken() {

    const user = firebaseAuth.currentUser;

    if (!user) {

        return null;

    }

    try {

        return await user.getIdToken(true);

    } catch (err) {

        console.warn('Could not obtain Firebase ID token: ' + err.message);

        return null;

    }

}

/**
 * Initialise Firebase App Check if a reCAPTCHA Enterprise site key has been
 * configured. The App Check SDK is loaded lazily from gstatic so that pages
 * that never touch Firestore/Storage (e.g., Configure) stay lightweight.
 * Call this before the first Firestore/Storage request.
 * @returns {Promise<void>}
 */
async function initialiseAppCheckIfConfigured() {

    if (!RECAPTCHA_ENTERPRISE_SITE_KEY || firebase.appCheck) {

        return;

    }

    await loadScript('https://www.gstatic.com/firebasejs/12.0.0/firebase-app-check-compat.js');

    firebase.initializeAppCheck(firebaseApp, {
        provider: new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_ENTERPRISE_SITE_KEY),
        isTokenAutoRefreshEnabled: true
    });

    console.log('Firebase App Check initialised.');

}

/**
 * Dynamically load a <script> tag and resolve once it has loaded.
 * @param {string} src Script URL.
 * @returns {Promise<void>}
 */
function loadScript(src) {

    return new Promise((resolve, reject) => {

        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load ' + src));
        document.head.appendChild(script);

    });

}
