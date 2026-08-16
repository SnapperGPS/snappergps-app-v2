/****************************************************************************
 * firestore-model.js
 *
 * Shared definitions of the Firestore data model and the upload status
 * state machine (see docs/firebase-data-model.md). Both the browser and the
 * external Python processor use these statuses.
 *
 * Status state machine:
 *   created     the quota gate created the upload document
 *   uploading   the browser has started the Cloud Storage upload
 *   waiting     raw object uploaded, ready for the processor
 *   processing  the Python worker has claimed the upload
 *   complete    result objects uploaded and metadata updated
 *   failed      the processor failed, errorMessage is set
 *   expired     optional, result files deleted
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

// Upload statuses.
const UPLOAD_STATUS_CREATED = 'created';
const UPLOAD_STATUS_UPLOADING = 'uploading';
const UPLOAD_STATUS_WAITING = 'waiting';
const UPLOAD_STATUS_PROCESSING = 'processing';
const UPLOAD_STATUS_COMPLETE = 'complete';
const UPLOAD_STATUS_FAILED = 'failed';
const UPLOAD_STATUS_EXPIRED = 'expired';

// Firestore collection names.
const COLLECTION_UPLOADS = 'uploads';
const COLLECTION_REFERENCE_POINTS = 'referencePoints';
const COLLECTION_QUOTA_DAILY = 'quotaDaily';
const COLLECTION_QUOTA_MONTHLY = 'quotaMonthly';

/**
 * Normalise a value that may be a Firestore server timestamp into a string
 * or null. The compat SDK returns JavaScript Date objects for timestamps.
 * @param {*} value Raw value from a Firestore document.
 * @returns {string|null} ISO 8601 string or null.
 */
function timestampToString(value) {

    if (value === null || value === undefined) {

        return null;

    }

    if (value instanceof Date && !isNaN(value)) {

        return value.toISOString();

    }

    if (typeof value === 'object' && typeof value.toDate === 'function') {

        return value.toDate().toISOString();

    }

    if (typeof value === 'object' && value.seconds !== undefined) {

        return new Date(value.seconds * 1000).toISOString();

    }

    if (typeof value === 'string') {

        return value;

    }

    return null;

}

/**
 * Normalise an upload document read from Firestore into the plain object
 * shape used by the UI. Missing fields become null/0 so that the view code
 * does not have to guard against undefined everywhere.
 * @param {Object} data Raw Firestore document data.
 * @param {string} uploadId Document ID.
 * @returns {Object} Normalised upload record.
 */
function normaliseUploadDoc(data, uploadId) {

    if (!data) {

        return null;

    }

    const upload = { uploadId: uploadId, ...data };

    upload.createdAt = timestampToString(upload.createdAt);
    upload.uploadedAt = timestampToString(upload.uploadedAt);
    upload.processingStartedAt = timestampToString(upload.processingStartedAt);
    upload.processingCompletedAt = timestampToString(upload.processingCompletedAt);
    upload.earliestSnapshotTime = timestampToString(upload.earliestSnapshotTime);
    upload.latestSnapshotTime = timestampToString(upload.latestSnapshotTime);
    upload.startDate = timestampToString(upload.startDate);
    upload.endDate = timestampToString(upload.endDate);

    return upload;

}
