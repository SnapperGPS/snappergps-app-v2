/****************************************************************************
 * searchUI.js
 * March 2021 (updated for the static GitHub Pages site)
 *
 * Search page: enter an upload ID to view the track, and show the most
 * recent uploads of this browser/session (stored in localStorage). If the
 * view page cannot read an upload (not found, or belonging to another
 * browser), it redirects back here with ?error=<uploadID> and the error is
 * displayed, exactly like the old server-rendered search page.
 *****************************************************************************/

const idInput = document.getElementById('id-input');
const searchButton = document.getElementById('search-button');

const uploadTable = document.getElementById("upload-table");
const uploadTableRow = document.getElementById("upload-table-row");
const clearButton = document.getElementById("clear-button");

function searchId() {

    let id = idInput.value;

    if (id === '') {

        return;

    }

    // Remove all spaces as ID cannot contain them

    id = id.replace(' ', '');

    // Redirect to page which will contain upload information if it exists

    window.location.href = 'view.html?uploadid=' + id;

}

searchButton.addEventListener('click', searchId);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        searchId();
    }
});

clearButton.addEventListener('click', () => {

    // Clear "uploadIDs" in localStorage

    localStorage.removeItem('uploadData');

    // make table row invisible

    uploadTableRow.style.display = 'none';

});

// If the view page redirected back with an error, show it.

(function displayErrorFromUrl() {

    const urlParams = new URLSearchParams(window.location.search);
    const errorUploadID = urlParams.get('error');
    const reason = urlParams.get('reason');

    if (errorUploadID) {

        const errorDisplay = document.getElementById('error-display');

        if (errorDisplay) {

            const errorText = document.getElementById('error-text');

            if (reason === 'permission') {

                errorText.innerHTML = 'Your upload <i>' + errorUploadID + '</i> could not be read: ' +
                    'this browser does not have permission to view it. If the track was just ' +
                    'migrated or uploaded from another browser, make sure the Firebase security ' +
                    'rules are deployed (firestore.rules and storage.rules, e.g. ' +
                    '<i>firebase deploy --only firestore:rules,storage</i>) and that App Check ' +
                    'enforcement is not rejecting this browser.';

            } else if (reason === 'error') {

                errorText.innerHTML = 'We could not read the data for your upload ID <i>' +
                    errorUploadID + '</i>. Please check your internet connection and try again.';

            } else {

                errorText.innerHTML = 'We could not find any data with your ' +
                                      'upload ID <i>' + errorUploadID + '</i>. ' +
                                      'Please double check and try again.';

            }

            errorDisplay.style.display = '';

        }

    }

})();

// Call async function that displays upload IDs in table

displayUploadIDs();

// Display upload IDs in table

async function displayUploadIDs() {

    // Check if uploadIDs exist in localStorage, if it is an array, and if it has at least one element

    if (localStorage.getItem('uploadData') !== null &&
        Array.isArray(JSON.parse(localStorage.getItem('uploadData'))) &&
        JSON.parse(localStorage.getItem('uploadData')).length > 0) {

        // Make table row visible

        uploadTableRow.style.display = '';

        // Clear existing table

        uploadTable.innerHTML = '';

        // Add upload IDs to table
        
        JSON.parse(localStorage.getItem('uploadData')).forEach((upload) => {

            const tableRow = uploadTable.insertRow();
            const linkCell = tableRow.insertCell(0);
            linkCell.innerHTML = '<a class="text-link" href="view.html?uploadid=' + upload[0] + '">' + upload[0] + '</a>';
            const nicknameCell = tableRow.insertCell(1);
            nicknameCell.textContent = upload[1];

        });

    }

}
