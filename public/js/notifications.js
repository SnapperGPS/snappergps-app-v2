/****************************************************************************
 * notifications.js
 *
 * Web Push notification handling. The upload page offers an optional push
 * notification. If the user allows it, the browser subscribes to the push
 * service and the resulting subscription JSON is stored in the upload
 * document (uploads/{uploadId}.pushSubscription) via the quota gate, so
 * that the Python processor can send a notification when processing is
 * complete. The front end never talks to the processor directly.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

// VAPID public key for push notifications.
const vapidPublicKey = 'BE20bzDq0YubQSxrJ2ekzU1g9rsmv7I2ZCqqwS7mO2GV0kgPJZjvQ6a04TRUMoeZ33JioQ8S0WhX7ZwpESO4sEs';

/**
 * Convert a URL-safe base64 VAPID key to a Uint8Array, as required by
 * pushManager.subscribe (Chrome does not accept the base64 string directly).
 * @param {string} base64String URL-safe base64 string.
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {

    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {

        outputArray[i] = rawData.charCodeAt(i);

    }

    return outputArray;

}

/**
 * Get the current push subscription JSON (or '{}' if none).
 * @returns {Promise<string>} JSON string of the subscription or '{}'.
 */
async function getCurrentPushSubscriptionJson() {

    if (!('serviceWorker' in navigator)) {

        return '{}';

    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    return subscription ? JSON.stringify(subscription) : '{}';

}

/**
 * Subscribe to push notifications (if enable is true) and return the
 * subscription as a JSON string. If enable is false the current
 * subscription is kept but '{}' is returned (no notification requested).
 * @param {boolean} enable Whether the user wants push notifications.
 * @returns {Promise<string>} Subscription JSON string or '{}'.
 */
async function getPushSubscriptionJson(enable) {

    if (!enable) {

        return '{}';

    }

    if (!('serviceWorker' in navigator)) {

        throw new Error('This browser does not support push notifications.');

    }

    const registration = await navigator.serviceWorker.ready;

    // Reuse an existing subscription if present.
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {

        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });

    }

    return JSON.stringify(subscription);

}
