/****************************************************************************
 * ui.js
 *
 * Small, shared UI helpers that are used by several views. Names are
 * prefixed to avoid clashing with view-local functions (e.g., the
 * createDownloadLink() helpers that already exist in uploadUI.js/viewUI.js).
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/**
 * Trigger a browser download of a Blob with the given file name.
 * @param {Blob} blob File content.
 * @param {string} fileName Name of the downloaded file.
 */
function downloadBlob(blob, fileName) {

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

}

/**
 * Show a message in the standard "error card" that exists on the upload and
 * configure pages. Safe to call even if the card is not present.
 * @param {string} message Message text.
 */
function showErrorMessage(message) {

    console.error(message);

    const errorCard = document.getElementById('error-card') || document.getElementById('error-display');

    if (!errorCard) {

        return;

    }

    errorCard.style.display = '';
    const errorText = document.getElementById('error-text');

    if (errorText) {

        errorText.innerHTML = message;

    }

    window.scrollTo(0, 0);

}
