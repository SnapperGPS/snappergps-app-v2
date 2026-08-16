/****************************************************************************
 * encoding.js
 *
 * Helpers for the one-blob-per-upload data path:
 *   - gzip a JSON payload into a Blob (CompressionStream)
 *   - gunzip a Blob back into text/JSON
 *   - SHA-256 hex digest of a Blob (Web Crypto)
 *
 * The app already requires a Chromium-style browser for WebUSB, and
 * CompressionStream is available in the same browsers, so this is aligned
 * with the existing browser baseline.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/**
 * Gzip a JSON object into a Blob using the native CompressionStream.
 * @param {Object} obj Any JSON-serialisable object.
 * @returns {Promise<Blob>} gzip-compressed Blob.
 */
async function gzipJson(obj) {

    const jsonBlob = new Blob([JSON.stringify(obj)], { type: 'application/json' });

    return gzipBlob(jsonBlob);

}

/**
 * Gzip any Blob using the native CompressionStream.
 * @param {Blob} blob Input blob.
 * @returns {Promise<Blob>} gzip-compressed Blob.
 */
async function gzipBlob(blob) {

    if (!('CompressionStream' in window)) {

        throw new Error('This browser does not support CompressionStream. Please use a recent Chromium-based browser.');

    }

    const compressedStream = blob.stream().pipeThrough(new CompressionStream('gzip'));

    return new Response(compressedStream).blob();

}

/**
 * Decompress a gzip Blob into a Blob containing the original bytes.
 * @param {Blob} blob gzip-compressed blob.
 * @returns {Promise<Blob>} decompressed blob.
 */
async function gunzipBlob(blob) {

    if (!('DecompressionStream' in window)) {

        throw new Error('This browser does not support DecompressionStream. Please use a recent Chromium-based browser.');

    }

    const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));

    return new Response(decompressedStream).blob();

}

/**
 * Read a Blob as a UTF-8 string.
 * @param {Blob} blob Input blob.
 * @returns {Promise<string>}
 */
function blobToText(blob) {

    return blob.text();

}

/**
 * Compute the SHA-256 hex digest of a Blob.
 * @param {Blob} blob Input blob.
 * @returns {Promise<string>} Lower-case hex digest.
 */
async function sha256Blob(blob) {

    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);

    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

}
