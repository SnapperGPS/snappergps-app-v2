/****************************************************************************
 * quota.js
 *
 * Client for the tiny quota gate ("reserve upload slot"). The gate runs as
 * a Cloud Run service (a Python function) at RESERVE_UPLOAD_SLOT_URL and is
 * the ONLY component that may:
 *   - check the daily/monthly quotas (count, bytes, Class A operations),
 *   - create the uploads/{uploadId} Firestore document, and
 *   - reserve quota in quotaDaily/{YYYY-MM-DD} and quotaMonthly/{YYYY-MM}.
 *
 * The browser calls it with a Firebase ID token
 * (Authorization: Bearer <token>) and an App Check token, if configured.
 *
 * Response contract (identical to the spec, the Python function behaves the
 * same way):
 *   accepted:
 *     { accepted: true, uploadId: "u_...", rawObject: "uploads/.../raw.snapper.json.gz" }
 *   rejected:
 *     { accepted: false, reason: "daily_quota_exceeded", nextAvailableAt: "..." }
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/* global RESERVE_UPLOAD_SLOT_URL, ensureAnonymousUser, getFirebaseIdToken */

/**
 * Ask the quota gate to reserve an upload slot.
 * @param {Object} input Upload parameters.
 * @param {number} input.estimatedRawGzipBytes Compressed size of the raw upload.
 * @param {number} input.snapshotCount Number of snapshots.
 * @param {string} input.deviceId Receiver ID.
 * @param {string|null} input.nickname Optional nickname.
 * @param {string|null} input.earliestSnapshotTime ISO timestamp of 1st snapshot.
 * @param {string|null} input.latestSnapshotTime ISO timestamp of last snapshot.
 * @param {string|null} input.startDate Optional start date/time.
 * @param {string|null} input.endDate Optional end date/time.
 * @param {number|null} input.maxVelocity Optional max velocity in m/s.
 * @param {string|null} input.frequencyOffset Optional frequency offset.
 * @param {string|null} input.email Optional notification e-mail.
 * @param {string|null} input.chatId Optional Telegram chat ID.
 * @param {string|null} input.pushSubscription Optional push subscription JSON.
 * @returns {Promise<Object>} Normalised gate response (see file header).
 */
async function reserveUploadSlot(input) {

    // The gate requires an authenticated caller.
    await ensureAnonymousUser();

    const idToken = await getFirebaseIdToken();

    const headers = {
        'Content-Type': 'application/json'
    };

    if (idToken) {

        headers['Authorization'] = 'Bearer ' + idToken;

    }

    // Attach an App Check token if App Check is enabled for this app.
    try {

        if (typeof firebase !== 'undefined' && firebase.appCheck) {

            const appCheckToken = await firebase.appCheck().getToken();

            if (appCheckToken && appCheckToken.token) {

                headers['X-Firebase-AppCheck'] = appCheckToken.token;

            }

        }

    } catch (err) {

        console.warn('Could not obtain App Check token: ' + err.message);

    }

    let response;

    try {

        // Abort the request if the server does not answer within 60 s.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {

            response = await fetch(RESERVE_UPLOAD_SLOT_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    estimatedRawGzipBytes: input.estimatedRawGzipBytes,
                    snapshotCount: input.snapshotCount,
                    deviceId: input.deviceId,
                    nickname: input.nickname || null,
                    earliestSnapshotTime: input.earliestSnapshotTime || null,
                    latestSnapshotTime: input.latestSnapshotTime || null,
                    startDate: input.startDate || null,
                    endDate: input.endDate || null,
                    maxVelocity: input.maxVelocity || null,
                    frequencyOffset: input.frequencyOffset || null,
                    email: input.email || null,
                    chatId: input.chatId || null,
                    pushSubscription: input.pushSubscription || null
                }),
                signal: controller.signal
            });

        } finally {

            clearTimeout(timeout);

        }

    } catch (err) {

        throw new Error('Could not reach the upload server. Please check your internet connection and try again.');

    }

    // Parse the response body, tolerating JSON or plain text.
    let data = null;
    const text = await response.text();

    try {

        data = JSON.parse(text);

    } catch {

        data = { message: text };

    }

    if (!response.ok) {

        const message = (data && (data.message || data.error)) || 'The upload server returned an error (' + response.status + ').';

        throw new Error(message);

    }

    // Normalise: accept both the documented camelCase response and
    // snake_case variants from the server implementation.
    const normalised = {
        accepted: data.accepted === true || data.accepted === 'true',
        uploadId: data.uploadId || data.upload_id || null,
        rawObject: data.rawObject || data.raw_object || null,
        reason: data.reason || null,
        nextAvailableAt: data.nextAvailableAt || data.next_available_at || null,
        message: data.message || null
    };

    return normalised;

}
