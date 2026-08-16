/****************************************************************************
 * upload-google.js
 *
 * The new one-blob upload flow. Replaces the old per-snapshot HTTP POSTs to
 * the Node/Express backend with:
 *
 *   1. collect all snapshots in the browser (as before),
 *   2. gzip the whole recording into ONE JSON object (CompressionStream),
 *   3. call the quota gate (reserveUploadSlot),
 *   4. if accepted, write the reference points to Firestore,
 *   5. upload the single raw object to Cloud Storage with progress,
 *   6. mark the upload document as "waiting" so the Python processor picks
 *      it up.
 *
 * One object per upload is essential: 50k snapshots as individual objects
 * would blow the free Cloud Storage operation quota on a single upload.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/* global firebase, ensureAnonymousUser, initialiseAppCheckIfConfigured, reserveUploadSlot,
   gzipJson, sha256Blob, rawObjectPath, UPLOAD_STATUS_UPLOADING, UPLOAD_STATUS_WAITING,
   MAX_SNAPSHOTS_PER_UPLOAD, MAX_GZIP_BYTES_PER_UPLOAD */

/**
 * Upload a SnapperGPS recording (snapshots + reference points) to
 * Firebase/Google. Returns either an acceptance or a quota rejection;
 * throws an Error on technical failures.
 *
 * @param {Object} uploadFormState Form state.
 * @param {string} uploadFormState.deviceId Receiver ID.
 * @param {string|null} uploadFormState.firmware Firmware description.
 * @param {string|null} uploadFormState.firmwareVersion Firmware version string.
 * @param {string|null} uploadFormState.nickname Optional nickname.
 * @param {string|null} uploadFormState.email Optional e-mail.
 * @param {string|null} uploadFormState.chatId Optional Telegram chat ID.
 * @param {string|null} uploadFormState.pushSubscription Optional push JSON.
 * @param {string|null} uploadFormState.startDate ISO or null.
 * @param {string|null} uploadFormState.endDate ISO or null.
 * @param {number|null} uploadFormState.maxVelocity m/s or null.
 * @param {number|null} uploadFormState.frequencyOffset Hz or null.
 * @param {string|null} uploadFormState.earliestSnapshotTime ISO or null.
 * @param {string|null} uploadFormState.latestSnapshotTime ISO or null.
 * @param {Array} snapshots Raw snapshot array:
 *   [{i, datetime (ISO), battery, hxfoCount, lxfoCount, temperature, dataBase64}].
 * @param {Array} referencePoints Reference points:
 *   [{lat, lng, datetime (Date|string)}].
 * @param {Function} [onProgress] Progress callback
 *   (progress: {stage: string, value: number}).
 * @returns {Promise<Object>} Either
 *   {accepted: true, uploadId} or
 *   {accepted: false, reason, nextAvailableAt}.
 */
async function uploadSnapperData(uploadFormState, snapshots, referencePoints, onProgress) {

    const progress = (stage, value) => {

        if (onProgress) {

            onProgress({ stage: stage, value: value });

        }

    };

    // Sanity check client-side; the quota gate enforces this authoritatively.
    if (snapshots.length > MAX_SNAPSHOTS_PER_UPLOAD) {

        throw new Error('This upload contains more than ' + MAX_SNAPSHOTS_PER_UPLOAD.toLocaleString() + ' snapshots.');

    }

    // 1. Build the raw payload (format snappergps.raw-upload.v1).
    const earliestSnapshotTime = uploadFormState.earliestSnapshotTime ||
                                 (snapshots.length > 0 ? snapshots[0].datetime : null);
    const latestSnapshotTime = uploadFormState.latestSnapshotTime ||
                               (snapshots.length > 0 ? snapshots[snapshots.length - 1].datetime : null);

    const rawPayload = {
        format: 'snappergps.raw-upload.v1',
        uploadClientVersion: 'firebase-v1',
        createdAt: new Date().toISOString(),
        deviceId: uploadFormState.deviceId,
        firmware: uploadFormState.firmware || null,
        firmwareVersion: uploadFormState.firmwareVersion || null,
        snapshots: snapshots,
        referencePoints: referencePoints.map((rp) => ({
            lat: rp.lat,
            lng: rp.lng,
            // Accept both the current 'datetime' key and the legacy 'dt' key.
            datetime: (rp.datetime || rp.dt) instanceof Date
                ? (rp.datetime || rp.dt).toISOString()
                : new Date(rp.datetime || rp.dt).toISOString()
        })),
        options: {
            startDate: uploadFormState.startDate || null,
            endDate: uploadFormState.endDate || null,
            maxVelocity: uploadFormState.maxVelocity || null,
            frequencyOffset: uploadFormState.frequencyOffset || null
        }
    };

    // 2. Compress the payload.
    progress('compressing', 0);
    const gzBlob = await gzipJson(rawPayload);
    progress('compressing', 1);

    if (gzBlob.size > MAX_GZIP_BYTES_PER_UPLOAD) {

        throw new Error('The compressed recording is larger than ' +
                        Math.round(MAX_GZIP_BYTES_PER_UPLOAD / 1024 / 1024) +
                        ' MB and cannot be uploaded.');

    }

    // Make sure an anonymous user exists and App Check is initialised
    // before any Firestore/Storage write.
    await ensureAnonymousUser();
    await initialiseAppCheckIfConfigured();

    // 3. Reserve an upload slot with the quota gate.
    progress('reserving', 0);

    const reservation = await reserveUploadSlot({
        estimatedRawGzipBytes: gzBlob.size,
        snapshotCount: snapshots.length,
        deviceId: uploadFormState.deviceId,
        nickname: uploadFormState.nickname,
        earliestSnapshotTime: earliestSnapshotTime,
        latestSnapshotTime: latestSnapshotTime,
        startDate: uploadFormState.startDate,
        endDate: uploadFormState.endDate,
        maxVelocity: uploadFormState.maxVelocity,
        frequencyOffset: uploadFormState.frequencyOffset,
        email: uploadFormState.email,
        chatId: uploadFormState.chatId,
        pushSubscription: uploadFormState.pushSubscription
    });

    progress('reserving', 1);

    if (!reservation.accepted) {

        // Quota full: return the rejection; the UI keeps the upload
        // pending and shows "please try again on ...".
        return {
            accepted: false,
            reason: reservation.reason,
            nextAvailableAt: reservation.nextAvailableAt,
            message: reservation.message
        };

    }

    const uploadId = reservation.uploadId;
    const rawObject = reservation.rawObject || rawObjectPath(uploadId);

    // Steps 4-6 (reference points, Storage upload, status "waiting").
    // If anything fails here, the upload document remains in "created" or
    // "uploading". The processor only ever picks up "waiting" uploads and
    // the storage lifecycle rules delete stray raw objects after two days,
    // so no work is lost. The reservation itself cannot be released from
    // the browser (the security rules forbid client deletes); expiring
    // stale reservations is a server-side concern (see the data model doc).
    try {

        // 4. Write the reference points as a Firestore subcollection so the
        //    processor can read them without parsing the raw object.
        for (const rp of referencePoints) {

            await firebaseDb
                .collection('uploads').doc(uploadId)
                .collection('referencePoints')
                .add({
                    lat: rp.lat,
                    lng: rp.lng,
                    datetime: (rp.datetime || rp.dt) instanceof Date
                        ? (rp.datetime || rp.dt)
                        : new Date(rp.datetime || rp.dt)
                });

        }

        // Tell the world that the raw object is about to appear (optional
        // "uploading" state, allowed by the security rules). The rules
        // require rawGzipBytes on every allowed update, so it is set here
        // as well.
        await firebaseDb.collection('uploads').doc(uploadId).update({
            status: UPLOAD_STATUS_UPLOADING,
            rawGzipBytes: gzBlob.size
        });

        // 5. Upload the single raw object directly to Cloud Storage.
        const rawRef = firebaseStorage.ref(rawObject);

        const metadata = {
            contentType: 'application/gzip',
            customMetadata: {
                uploadId: uploadId,
                format: 'snappergps.raw-upload.v1'
            }
        };

        await new Promise((resolve, reject) => {

            const task = rawRef.put(gzBlob, metadata);

            task.on('state_changed',
                (snapshot) => {

                    progress('uploading', snapshot.bytesTransferred / Math.max(snapshot.totalBytes, 1));

                },
                (error) => {

                    console.error(error);
                    reject(new Error('The upload to the cloud failed. Please check your internet connection and try again.'));

                },
                () => {

                    resolve();

                });

        });

        // 6. Finalise: SHA-256 checksum + status "waiting".
        const rawSha256 = await sha256Blob(gzBlob);

        const finalUpdate = {
            status: UPLOAD_STATUS_WAITING,
            uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
            rawGzipBytes: gzBlob.size,
            rawSha256: rawSha256
        };

        try {

            await firebaseDb.collection('uploads').doc(uploadId).update(finalUpdate);

        } catch (err) {

            // Transient network failure: retry the final status update once.
            console.warn('Retrying final upload status update: ' + err.message);
            await firebaseDb.collection('uploads').doc(uploadId).update(finalUpdate);

        }

    } catch (err) {

        console.error('Upload failed after the quota gate accepted it: ' + err.message);

        throw new Error('The upload could not be completed. Please try again.');

    }

    return {
        accepted: true,
        uploadId: uploadId
    };

}
