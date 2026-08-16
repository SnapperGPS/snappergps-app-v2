/****************************************************************************
 * offline.js
 *
 * Local (IndexedDB) storage of transfers made in the field, when there is
 * no internet connection (see section "Preserve offline field transfer").
 *
 * The "Transfer data" button on the upload page reads all snapshots from a
 * connected receiver. Besides downloading the usual .json file it stores the
 * same recording in IndexedDB (NOT localStorage, because 50k snapshots can
 * be large) and marks it as a pending upload. When the device is back
 * online the user can upload such a pending transfer with the normal
 * reserve-upload-slot -> Storage upload -> Firestore "waiting" flow. If the
 * quota is full the record is kept and the UI shows "please try again on ...".
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/* global uploadSnapperData, UPLOAD_STATUS_WAITING */

const PENDING_UPLOADS_DB = 'snappergps-pending-uploads';
const PENDING_UPLOADS_STORE = 'pendingUploads';
const PENDING_UPLOADS_VERSION = 1;

/**
 * Open (and create, if necessary) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openPendingUploadsDb() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(PENDING_UPLOADS_DB, PENDING_UPLOADS_VERSION);

        request.onupgradeneeded = () => {

            const db = request.result;

            if (!db.objectStoreNames.contains(PENDING_UPLOADS_STORE)) {

                db.createObjectStore(PENDING_UPLOADS_STORE, { keyPath: 'id' });

            }

        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);

    });

}

/**
 * Store a transferred recording as a pending upload.
 * @param {Object} record Recording data.
 * @param {string} record.deviceId Receiver ID.
 * @param {string|null} record.firmwareDescription Firmware description.
 * @param {string|null} record.firmwareVersion Firmware version string.
 * @param {Array} record.snapshots Snapshots in the JSON-file format
 *   ({timestamp, temperature, batteryVoltage, data}).
 * @returns {Promise<string>} ID of the stored record.
 */
async function savePendingUpload(record) {

    const db = await openPendingUploadsDb();

    return new Promise((resolve, reject) => {

        const entry = {
            id: 'pending_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
            createdAt: new Date().toISOString(),
            deviceId: record.deviceId,
            firmwareDescription: record.firmwareDescription || null,
            firmwareVersion: record.firmwareVersion || null,
            snapshots: record.snapshots,
            status: 'pendingUpload'
        };

        const transaction = db.transaction(PENDING_UPLOADS_STORE, 'readwrite');
        transaction.objectStore(PENDING_UPLOADS_STORE).put(entry);
        transaction.oncomplete = () => resolve(entry.id);
        transaction.onerror = () => reject(transaction.error);

    });

}

/**
 * List all pending uploads, newest first.
 * @returns {Promise<Array>}
 */
async function listPendingUploads() {

    const db = await openPendingUploadsDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(PENDING_UPLOADS_STORE, 'readonly');
        const request = transaction.objectStore(PENDING_UPLOADS_STORE).getAll();

        request.onsuccess = () => {

            const records = request.result || [];
            records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            resolve(records);

        };

        request.onerror = () => reject(request.error);

    });

}

/**
 * Delete a pending upload by ID.
 * @param {string} id Pending upload ID.
 * @returns {Promise<void>}
 */
async function deletePendingUpload(id) {

    const db = await openPendingUploadsDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(PENDING_UPLOADS_STORE, 'readwrite');
        transaction.objectStore(PENDING_UPLOADS_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);

    });

}

/**
 * Upload a stored pending transfer using the normal upload flow. The stored
 * snapshots use the JSON-file field names and are converted to the raw
 * upload snapshot format first.
 * @param {Object} record Pending upload record (see savePendingUpload).
 * @param {Object} uploadFormState Form state (see uploadSnapperData).
 * @param {Array} referencePoints Reference points.
 * @param {Function} [onProgress] Progress callback.
 * @returns {Promise<Object>} Result of uploadSnapperData.
 */
async function uploadPendingRecord(record, uploadFormState, referencePoints, onProgress) {

    const snapshots = record.snapshots.map((snapshot, i) => ({

        i: i,
        datetime: new Date(snapshot.timestamp).toISOString(),
        battery: snapshot.batteryVoltage,
        hxfoCount: snapshot.hxfoCount === undefined ? 1 : snapshot.hxfoCount,
        lxfoCount: snapshot.lxfoCount === undefined ? 1 : snapshot.lxfoCount,
        temperature: snapshot.temperature,
        dataBase64: snapshot.data

    }));

    uploadFormState.deviceId = record.deviceId;
    uploadFormState.firmware = record.firmwareDescription || null;
    uploadFormState.firmwareVersion = record.firmwareVersion || null;

    return uploadSnapperData(uploadFormState, snapshots, referencePoints, onProgress);

}
