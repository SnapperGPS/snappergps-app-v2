/****************************************************************************
 * download-google.js
 *
 * Read access to Firestore metadata and Cloud Storage result objects.
 * Replaces the old server routes getUploadInformation / getPositions /
 * getFirstLastSnapshotTimestamps.
 *
 * The view page reads the upload document, confirms status == "complete",
 * and downloads results/{uploadId}/preview.geojson for the map plus the
 * full result objects for the download buttons. Individual positions are
 * NEVER queried from Firestore (a 50k-snapshot upload could produce tens of
 * thousands of position records; that would recreate the row-scaling
 * problem). Positions live only in the result objects.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/* global firebase, ensureAnonymousUser, initialiseAppCheckIfConfigured, normaliseUploadDoc */

/**
 * Read the upload document uploads/{uploadId}.
 * @param {string} uploadId Upload ID.
 * @returns {Promise<Object|null>} Normalised upload record, or null if the
 *   document does not exist or is not accessible to this anonymous user.
 */
async function getUploadStatus(uploadId) {

    await ensureAnonymousUser();
    await initialiseAppCheckIfConfigured();

    try {

        const snapshot = await firebaseDb.collection('uploads').doc(uploadId).get();

        if (!snapshot.exists) {

            return null;

        }

        return normaliseUploadDoc(snapshot.data(), uploadId);

    } catch (err) {

        // permission-denied and network errors look the same to the user:
        // the upload cannot be viewed from this browser.
        console.warn('Could not read upload ' + uploadId + ': ' + err.message);

        return null;

    }

}

/**
 * Read the reference points subcollection of an upload.
 * @param {string} uploadId Upload ID.
 * @returns {Promise<Array>} Reference points [{lat, lng, datetime}].
 */
async function getReferencePoints(uploadId) {

    await ensureAnonymousUser();

    try {

        const snapshot = await firebaseDb
            .collection('uploads').doc(uploadId)
            .collection('referencePoints')
            .get();

        const points = [];

        snapshot.forEach((doc) => {

            const data = doc.data();
            points.push({
                lat: data.lat,
                lng: data.lng,
                datetime: data.datetime
            });

        });

        return points;

    } catch (err) {

        console.warn('Could not read reference points of ' + uploadId + ': ' + err.message);

        return [];

    }

}

/**
 * Get a download URL for a Storage object.
 * @param {string} uploadId Upload ID.
 * @param {string} fileName Result file name (see RESULT_FILE_NAMES).
 * @returns {Promise<string>} HTTPS download URL.
 */
async function getResultUrl(uploadId, fileName) {

    await ensureAnonymousUser();
    await initialiseAppCheckIfConfigured();

    const ref = firebaseStorage.ref('results/' + uploadId + '/' + fileName);

    return ref.getDownloadURL();

}

/**
 * Download a result object as a Blob.
 * @param {string} uploadId Upload ID.
 * @param {string} fileName Result file name.
 * @returns {Promise<Blob>} Object contents.
 */
async function fetchResultBlob(uploadId, fileName) {

    const url = await getResultUrl(uploadId, fileName);

    const response = await fetch(url);

    if (!response.ok) {

        throw new Error('Could not download ' + fileName + ' from the cloud.');

    }

    return response.blob();

}
