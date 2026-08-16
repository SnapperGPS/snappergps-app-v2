/****************************************************************************
 * storage-model.js
 *
 * Cloud Storage object layout (see docs/firebase-data-model.md).
 *
 *   uploads/{uploadId}/raw.snapper.json.gz   one gzip JSON file per upload
 *   results/{uploadId}/positions.csv.gz
 *   results/{uploadId}/positions.geojson.gz
 *   results/{uploadId}/preview.geojson
 *   results/{uploadId}/summary.json
 *
 * There is deliberately ONE raw object per upload: individual snapshot
 * objects would blow the free Cloud Storage operation quota (5,000 Class A
 * operations/month) on a single 50k-snapshot upload.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

// Result file names that the processor writes and the browser may download.
const RESULT_FILE_NAMES = [
    'positions.csv.gz',
    'positions.geojson.gz',
    'preview.geojson',
    'summary.json'
];

/**
 * Path of the raw upload object for an upload.
 * @param {string} uploadId Upload ID.
 * @returns {string} Storage object path.
 */
function rawObjectPath(uploadId) {

    return 'uploads/' + uploadId + '/raw.snapper.json.gz';

}

/**
 * Path of a result object for an upload.
 * @param {string} uploadId Upload ID.
 * @param {string} fileName One of RESULT_FILE_NAMES.
 * @returns {string} Storage object path.
 */
function resultObjectPath(uploadId, fileName) {

    return 'results/' + uploadId + '/' + fileName;

}
