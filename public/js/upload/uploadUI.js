/****************************************************************************
 * uploadUI.js
 * March 2021 (updated for the Firebase/Google data plane)
 *
 * Handles the upload page: WebUSB device pairing, transferring raw data to
 * the host computer (offline-capable), and uploading recordings to the
 * cloud. Uploads now go through upload-google.js (one gzip object per
 * recording + Firestore metadata) instead of the old per-snapshot HTTP
 * POSTs to the Node/Express backend.
 *****************************************************************************/

/* global L, Blob, device, getDeviceInformation, requestDevice, setDisconnectFunction, resetDeviceInfo, connectToDevice, isDeviceAvailable, snapshotCountSpan, deviceIDSpan, deviceID, firmwareDescription, firmwareVersion, AM_USB_MSG_TYPE_GET_INFO, uploadSnapperData, uploadPendingRecord, savePendingUpload, listPendingUploads, deletePendingUpload, getPushSubscriptionJson, getCurrentPushSubscriptionJson, formatNextAvailableAt, dateFromInputs, timezoneLabel, showErrorMessage */

const mapboxAccessToken = 'pk.eyJ1Ijoiamdyb3Nza3JldXoiLCJhIjoiY2tseWIxNTRoMHFvODJxbHlyanRobzBmZiJ9.xz2KrKBy5MRCf9XLOOPdzA';

const USE_MAX_VELOCITY = true;

const USE_ZIP = false;  // Offer .bin and .csv files as .zip download

// Status variable which locks out certain actions when upload is in process
var uploading = false;
var transferring = false;
var uploadingDevice = false;
var uploadingFile = false;
var transferringDevice = false;

// Object to manage push notification subscription
let subscriptionJson = '{}';

// Error display UI

const errorCard = document.getElementById('error-card');
const errorText = document.getElementById('error-text');

// UI elements which are duplicated for start and end points (start = 0, end = 1)

const dateInputs = [document.getElementById('start-date-input'), document.getElementById('end-date-input')];
const timeInputs = [document.getElementById('start-time-input'), document.getElementById('end-time-input')];
const timezones = [document.getElementById('start-timezone'), document.getElementById('end-timezone')];

const latInputs = [document.getElementById('start-latitude-input')]; //, document.getElementById('end-latitude-input')];
const lngInputs = [document.getElementById('start-longitude-input')]; //, document.getElementById('end-longitude-input')];

const aimsPink = window.getComputedStyle(errorCard).getPropertyValue('--aims-pink');

// Custom marker icon
const zebraIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-violet.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],  // size of the icon
    iconAnchor: [12, 41],  // point of the icon which will correspond to marker's location
    popupAnchor: [1, -34],  // point from which the popup should open relative to the iconAnchor
    shadowSize: [41, 41]
});

const markers = [L.marker([null, null], { interactive: false, icon: zebraIcon }), L.marker()];

// Maximum distance between 2 plausible positions as defined in back-end.
const maxDistancePlausible = 10e3;

// Circle for confidence of start location.
const confidenceCircles = [L.circle([null, null], {
    interactive: false,
    color: aimsPink,
    fill: false,
    radius: maxDistancePlausible
}), L.circle()];

// Non-duplicated UI elements

const fileInput = document.getElementById('file-input');

const pairButton = document.getElementById('pair-button');

const uploadSelectedButton = document.getElementById('upload-selected-button');
const uploadSelectedSpinner = document.getElementById('upload-selected-spinner');

const uploadDeviceButton = document.getElementById('upload-device-button');
const uploadDeviceSpinner = document.getElementById('upload-device-spinner');

const transferButton = document.getElementById('transfer-button');
const transferSpinner = document.getElementById('transfer-spinner');

// Count snapshots found on device
const snapshotCountLabelTransfer = document.getElementById('snapshot-count-transfer');
const snapshotCountLabelUpload = document.getElementById('snapshot-count-upload');

// E-mail address field
const emailInput = document.getElementById('email-input');

// Push notifications
const notificationCheckbox = document.getElementById('notification-checkbox');
const notificationLabel = document.getElementById('notification-label');

// Max. receiver velocity
const velocityInput = document.getElementById('velocity-input');
const velocityUnitInput = document.getElementById('velocity-unit-input');

// Uplaod nickname
const nicknameInput = document.getElementById('nickname-input');

// Container for the list of locally saved (pending) transfers
const pendingUploadsContainer = document.getElementById('pending-uploads-container');

// Length of one snapshot in bytes
const SNAPSHOT_BUFFER_SIZE = 0x1800; // On device (6 KB)
const SNAPSHOT_SIZE = 6138; // Desired 12 ms snapshot (12 ms * 4.092 MHz / 8 Bit)

// Number of bytes of one external flash page used for meta data
const METADATA_SIZE = 8;

// USB message to request start reading a new snapshot from flash memory
const AM_USB_MSG_TYPE_GET_SNAPSHOT = 0x81; // previously 0x03

// USB message to request a new page of the current snapshot
const AM_USB_MSG_TYPE_GET_SNAPSHOT_PAGE = 0x84; // previously 0x06

/**
 * Load the TileLayer object of a given ID
 * @param {string} id ID of map tile layer used by Leaflet
 * @returns TileLayer object
 */
function getTileLayer(id) {

    // Retrieve specific base map layer from mapbox API.
    return L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
        // The following is necessary for legal reasons.
        attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery &copy <a href="https://www.mapbox.com/">Mapbox</a>',
        // minZoom: 1, // Default 0, change to account for zoomOffset
        // maxZoom: 19, // Default 18
        id: id,
        // tileSize: 512, // Default 256, could be fine-tuned
        // zoomOffset: -1, // Default 0, change to account for different tileSize
        accessToken: mapboxAccessToken
    });

}

/**
 * Create map object and place it in HTML object
 * @param {string} mapID DOM ID which map will be place in
 * @returns Leaflet map object
 */
function createMap(mapID) {

    const mapLayers = {
        Streets: getTileLayer('mapbox/streets-v11'),
        Outdoors: getTileLayer('mapbox/outdoors-v11'),
        Light: getTileLayer('mapbox/light-v10'),
        Dark: getTileLayer('mapbox/dark-v10'),
        Satellite: getTileLayer('mapbox/satellite-v9'),
        'Satellite & Streets': getTileLayer('mapbox/satellite-streets-v11')
    };

    const map = L.map(mapID, {
        layers: [mapLayers['Satellite & Streets']] //,
        // zoomControl: false
    });

    // L.control.zoom({position: 'topright'}).addTo(map);

    L.control.scale({ position: 'bottomleft' }).addTo(map);

    L.control.layers(mapLayers).addTo(map);

    // Default view = Oxford
    map.setView([51.753449349360785, -1.2540079829543849], 11);

    // Add search box
    var searchControl = new L.esri.Controls.Geosearch({ allowMultipleResults: false, position: 'topleft' }).addTo(map);

    // Use best result as start location of track
    searchControl.on('results', function (data) {
        if (data.results.length > 0) {
            updateMap(0, data.results[0].latlng);
        }
    });

    // Assumes your Leaflet map variable is 'map'..
    L.DomUtil.addClass(map._container, 'crosshair-cursor-enabled');

    return map;

}

// Create map objects

const maps = [createMap('start-map')];

// Create canvases which cover maps to allow greying out

const canvases = [document.getElementById('start-map-canvas'), document.getElementById('end-map-canvas')];

/**
 * Given a group of connected radio buttons, get the index of the current selection
 * @param {string} radioName Name assigned to a group of radio buttons
 * @returns Index of the selected radio
 */
function getSelectedRadioValue(radioName) {

    return parseInt(document.querySelector('input[name="' + radioName + '"]:checked').value);

}

/**
 * Verify if position given is a valid set of co-ordnates
 * @param {float} lat Latitude
 * @param {float} lng Longitude
 */
function areValidCoords(lat, lng) {

    return !isNaN(lat) && !isNaN(lng) && lat > -90.0 && lat < 90.0 && lng > -180.0 && lng < 180.0;

}

/**
 * Move the marker on the given map (based on the index)
 * @param {int} index Map index
 * @param {object} latlng JSON object containing co-ordinates
 */
function updateMap(index, latlng) {

    markers[index].setLatLng(latlng);
    markers[index].addTo(maps[index]);

    confidenceCircles[index].setLatLng(latlng);
    confidenceCircles[index].addTo(maps[index]);

    latInputs[index].value = latlng.lat.toFixed(6);
    lngInputs[index].value = latlng.lng.toFixed(6);

    // If a start location was provided, we can allow a data upload

    if (!transferring && isDeviceAvailable() && +snapshotCountSpan.innerHTML > 0) {

        uploadDeviceButton.disabled = false;

    }

    if (fileInput.files.length > 0) {

        uploadSelectedButton.disabled = false;

    }

}

/**
 * Animate flying to a give location
 * @param {integer} index Map index
 * @param {float} lat Latitude
 * @param {float} lng Longitude
 */
function moveMapView(index, lat, lng) {

    maps[index].flyTo([lat, lng], 13);

}

/**
 * Grey out map and block interactions
 * @param {integer} index Map index
 */
function disableMap(index) {

    const map = maps[index];

    canvases[index].style.display = '';

    map._handlers.forEach((handler) => {

        handler.disable();

    });

    latInputs[index].disabled = true;
    lngInputs[index].disabled = true;

}

/**
 * Remove grey overlay and re-enable interactions
 * @param {integer} index Map index
 */
function enableMap(index) {

    const map = maps[index];

    canvases[index].style.display = 'none';

    map._handlers.forEach((handler) => {

        handler.enable();

    });

    latInputs[index].disabled = false;
    lngInputs[index].disabled = false;

}

/**
 * Re-enable UI elements of given side of the UI
 * @param {integer} index UI index
 */
function enableStartEndUI(index) {

    timeInputs[index].disabled = false;
    dateInputs[index].disabled = false;
    timezones[index].style.color = '';

}

/**
 * Disable UI elements of given side of the UI
 * @param {integer} index UI index
 */
function disableStartEndUI(index) {

    timeInputs[index].disabled = true;
    dateInputs[index].disabled = true;
    timezones[index].style.color = 'lightgray';

}

/**
 * React to the map being clicked by updating that map
 * @param {integer} index Map index
 * @param {object} latlng JSON object containing location where the map was clicked
 */
function onMapClick(index, latlng) {

    updateMap(index, latlng);

}

function displayError(errorDescription) {

    console.error(errorDescription);

    errorCard.style.display = '';
    errorText.innerHTML = errorDescription;

    window.scrollTo(0, 0);

}

/**
 * Enable all UI elements
 */
function enableUI() {

    if (!uploading) {

        // Enable maps and time inputs
        enableMap(0);
        enableStartEndUI(0);
        enableStartEndUI(1);

        emailInput.disabled = false;  // TODO
        fileInput.disabled = false;
        nicknameInput.disabled = false;

        if (USE_MAX_VELOCITY) {

            velocityInput.disabled = false;
            velocityUnitInput.disabled = false;

        }

        if (!transferring && fileInput.files.length > 0 && latInputs[0].value !== '' && lngInputs[0].value !== '') {

            // Can only upload if start point is provided

            uploadSelectedButton.disabled = false;

        }

    }

    if (navigator.usb && !transferring) {

        if (isDeviceAvailable()) {

            // Upload or transfer from device buttons disabled
            // if no device is connected
            // or no snapshots on device
            if (+snapshotCountSpan.innerHTML > 0) {

                if (!uploading && latInputs[0].value !== '' && lngInputs[0].value !== '') {
                    // Can only upload if start point is provided

                    uploadDeviceButton.disabled = false;

                }

                transferButton.disabled = false;

            }

        } else {

            // Allow to pair device again
            pairButton.disabled = false;

        }

    }

}

/**
 * Disable all UI elements while transferring data from device.
 */
function disableDeviceUI() {

    // Disable all device-related buttons
    pairButton.disabled = true;
    // changedeviceButton.disabled = true;
    transferButton.disabled = true;
    uploadDeviceButton.disabled = true;

}

/**
 * Disable all UI elements while uploading data to server.
 */
function disableUploadUI() {

    // Disable all upload-related buttons
    uploadSelectedButton.disabled = true;
    uploadDeviceButton.disabled = true;

    // Disable upload-related inputs
    disableMap(0);
    disableStartEndUI(0);
    disableStartEndUI(1);
    emailInput.disabled = true;
    fileInput.disabled = true;
    nicknameInput.disabled = true;

    if (USE_MAX_VELOCITY) {

        velocityInput.disabled = true;
        velocityUnitInput.disabled = true;

    }
}

const updateTimezone = (inputIndex) => {

    if (dateInputs[inputIndex].value !== '') {

        const timeString = (timeInputs[inputIndex].value === '') ? '0:00' : timeInputs[inputIndex].value;
        let dt = new Date(dateInputs[inputIndex].value + ' ' + timeString);
        // Fix WebKit problem (WebKit does not recognise YYYY-MM-DD, but YYYY/MM/DD)
        if (isNaN(dt)) {
            console.log('Problem with input date, trying to fix it...');
            dt = new Date(dateInputs[inputIndex].value.replace(/-/g, '/') + ' ' + timeString);
        }
        timezones[inputIndex].innerHTML = timezoneLabel(dt);

    } else {

        timezones[inputIndex].innerHTML = '';

    }

};

for (let inputIndex = 0; inputIndex < dateInputs.length; ++inputIndex) {

    dateInputs[inputIndex].addEventListener('change', () => updateTimezone(inputIndex));
    timeInputs[inputIndex].addEventListener('change', () => updateTimezone(inputIndex));

}

/**
 * Update device file button and UI to display a spinner and "Uploading" text when snapshots are being uploaded
 * @param {bool} isUploading Is the app currently uploading snapshots
 */
function setDeviceUploading(isUploading) {

    uploadDeviceSpinner.style.display = isUploading ? '' : 'none';

    uploadingDevice = isUploading;
    transferring = transferringDevice || uploadingDevice;
    uploading = uploadingFile || uploadingDevice;

    if (isUploading) {

        disableDeviceUI();

        disableUploadUI();

    } else {

        enableUI();

    }

}
/**
 * Update transfer button and UI to display a spinner and "Transferring" text when snapshots are being transferred
 * @param {bool} isTransferring Is the app currently transferring snapshots
 */
function setTransferring(isTransferring) {

    transferSpinner.style.display = isTransferring ? '' : 'none';

    transferringDevice = isTransferring;
    transferring = transferringDevice || uploadingDevice;

    if (isTransferring) {

        disableDeviceUI();

    } else {

        enableUI();

    }

}

/**
 * Update selected file button and UI to display a spinner and "Uploading" text when snapshots are being uploaded
 * @param {bool} isUploading Is the app currently uploading snapshots
 */
function setSelectedUploading(isUploading) {

    uploadSelectedSpinner.style.display = isUploading ? '' : 'none';

    uploadingFile = isUploading;
    uploading = uploadingFile || uploadingDevice;

    if (isUploading) {

        disableUploadUI();

    } else {

        enableUI();

    }

}

/**
 * Create a JSON object containing all information needed in the reference point table
 * @param {object} latInput UI input for latitude of reference point
 * @param {object} lngInput UI input for longitude of reference point
 * @param {object} dt datetime
 * @returns JSON object containing reference point information
 */
function createReferencePointJSON(latInput, lngInput, dt) {

    return { lat: parseFloat(latInput.value), lng: parseFloat(lngInput.value), datetime: dt };

}

/**
   * Meta data object.
   * @param  {ArrayBuffer}  data Byte array returned from receiver after requesting meta data.
   * @return {Object}       meta Meta data object
   *    @return {Date}      meta.timestamp Timestamp of snapshot
   *    @return {Number}    meta.temperature Temperature measurement in degrees Celsius
   *    @return {Number}    meta.battery Battery voltage measurement in volts
   */
function MetaData(data) {

    // Get timestamp of snapshot
    const seconds = data.getUint8(2) + 256 * (data.getUint8(3) + 256 * (data.getUint8(4) + 256 * data.getUint8(5)));
    const milliseconds = Math.round((data.getUint8(6) + 256 * data.getUint8(7)) / 1024 * 1000);
    this.timestamp = new Date(seconds * 1000 + milliseconds);

    // Convert tenths of degrees Celsius to degrees Celsius
    this.temperature = (data.getUint8(10) + 256 * (data.getUint8(11) + 256 * (data.getUint8(12) + 256 * data.getUint8(13))) - 1024) / 10.0;

    // Convert hundreds of volts to volts
    this.battery = (data.getUint8(14) + 256 * (data.getUint8(15) + 256 * (data.getUint8(16) + 256 * data.getUint8(17)))) / 100.0;

}

/**
 * Convert a snapshot buffer (Uint8Array) to a base64 string.
 * @param {Uint8Array} snapshotBuffer Raw snapshot bytes.
 * @returns {string} Base64-encoded snapshot data.
 */
function snapshotBufferToBase64(snapshotBuffer) {

    let binary = '';

    const chunkSize = 0x8000;

    for (let i = 0; i < snapshotBuffer.length; i += chunkSize) {

        binary += String.fromCharCode.apply(null, snapshotBuffer.subarray(i, i + chunkSize));

    }

    return btoa(binary);

}

/**
 * Build the array of snapshots in the raw upload format from a list of
 * meta data objects and snapshot buffers read from the receiver.
 * @param {Array} metaList Array of MetaData objects.
 * @param {Array} bufferList Array of Uint8Array snapshot buffers.
 * @returns {Array} Snapshots in raw upload format.
 */
function buildRawSnapshots(metaList, bufferList) {

    const snapshots = [];

    for (let i = 0; i < metaList.length; ++i) {

        const meta = metaList[i];

        snapshots.push({
            i: i,
            datetime: meta.timestamp.toISOString(),
            battery: meta.battery,
            hxfoCount: 1,
            lxfoCount: 1,
            temperature: meta.temperature,
            dataBase64: snapshotBufferToBase64(bufferList[i])
        });

    }

    return snapshots;

}

/**
 * React to upload button being clicked by attempting to upload data from connected device
 */
async function onDeviceUploadButtonClick() {

    snapshotCountLabelUpload.innerHTML = '0 snapshots uploaded.';

    if (!isDeviceAvailable()) {

        return;

    }

    const email = emailInput.value; // User e-mail

    const maxVelocity = getMaxVelocity();

    if (isNaN(maxVelocity)) {

        return;

    }

    console.log('Max. velocity: ' + maxVelocity);

    const nickname = nicknameInput.value;

    deviceID = deviceIDSpan.innerHTML;

    setDeviceUploading(true);

    // Messages to communicate to device via USB
    const requestMetaDataMessage = new Uint8Array([AM_USB_MSG_TYPE_GET_SNAPSHOT]);
    const requestSnapshotMessage = new Uint8Array([AM_USB_MSG_TYPE_GET_SNAPSHOT_PAGE]);

    // Keep reading data from device until all snapshots are read
    let keepReading = true;

    let latestDate = null;
    let earliestDate = null;

    // Collect all meta data and snapshot buffers from the receiver.
    // They are compressed and uploaded as ONE object afterwards.
    const metaList = [];
    const bufferList = [];

    while (keepReading) {

        try {

            console.log('Request meta data.');
            // Request to start reading new record from flash memory, start with meta data
            let result = await device.transferOut(0x01, requestMetaDataMessage);

            console.log('Wait for meta data.');
            // Wait until meta data is returned
            result = await device.transferIn(0x01, 128);

            const data = result.data;

            // Check if device has sent data
            // Device uses 2nd byte of transmit buffer as valid flag
            if (data.getUint8(1) !== 0x00) {

                console.log('Extract time stamp.');

                const meta = new MetaData(data);

                console.log(meta);

                if (!latestDate || meta.timestamp > latestDate) {

                    latestDate = meta.timestamp;

                }

                if (!earliestDate || meta.timestamp < earliestDate) {

                    earliestDate = meta.timestamp;

                }

                console.log('Start reading snapshot.');

                console.log('Requesting snapshot');

                // Send message to device to request next piece of snapshot

                let result = await device.transferOut(0x01, requestSnapshotMessage);

                console.log('Waiting for snapshot');
                result = await device.transferIn(0x01, SNAPSHOT_BUFFER_SIZE - METADATA_SIZE);

                // Initialize the snapshot with zeros.
                // If the incoming data is shorter than the desired length,
                // then this applies zero padding.
                const snapshotBuffer = new Uint8Array(SNAPSHOT_SIZE).fill(0);

                // Loop over buffer that has been transmitted via USB
                for (let snapshotBufferIdx = 0;
                    snapshotBufferIdx < SNAPSHOT_BUFFER_SIZE - METADATA_SIZE;
                    ++snapshotBufferIdx) {

                    // Write received byte to buffer
                    snapshotBuffer[snapshotBufferIdx] = result.data.getUint8(snapshotBufferIdx);

                }

                metaList.push(meta);
                bufferList.push(snapshotBuffer);

                snapshotCountLabelUpload.innerHTML = `${metaList.length} snapshots read.`;

            } else {

                // All snapshot data has been read from flash

                keepReading = false;

            }

        } catch (err) {

            // Stop reading if USB communication failed

            console.error(err);

            displayError('We could not read all data from your SnapperGPS receiver. You might want to unplug and reconnect it and try again.');

            setDeviceUploading(false);

            return;

        }

    }

    const snapshots = buildRawSnapshots(metaList, bufferList);

    await finishAndUpload(snapshots, earliestDate, latestDate, setDeviceUploading);

}

/**
 * Finish an upload after all snapshots have been collected (from the
 * receiver, a JSON file, .bin files, or a locally saved transfer):
 * build the form state, run the reserve -> Storage -> Firestore flow, and
 * redirect to the success page (or show a quota/error message).
 * @param {Array} snapshots Snapshots in raw upload format.
 * @param {Date|null} earliestDate Timestamp of the 1st snapshot.
 * @param {Date|null} latestDate Timestamp of the last snapshot.
 * @param {Function} [setUploading] UI helper to re-enable the page.
 * @returns {Promise<void>}
 */
async function finishAndUpload(snapshots, earliestDate, latestDate, setUploading) {

    // Create an array of reference points in this way so it's easy to expand to more than just two later

    const referencePoints = [];

    let dt0;
    let dt1;

    if (timeInputs[0].value === '' || dateInputs[0].value === '') {
        console.log('Use timestamp of first snapshot for start point.');
        dt0 = earliestDate;
    } else {
        dt0 = dateFromInputs(dateInputs[0].value, timeInputs[0].value);
    }
    if (timeInputs[1].value === '' || dateInputs[1].value === '') {
        console.log('Use timestamp of last snapshot for end point.');
        dt1 = latestDate;
    } else {
        dt1 = dateFromInputs(dateInputs[1].value, timeInputs[1].value);
    }
    referencePoints.push(createReferencePointJSON(latInputs[0], lngInputs[0], dt0));
    referencePoints.push(createReferencePointJSON(latInputs[0], lngInputs[0], dt1));

    const maxVelocity = getMaxVelocity();

    const uploadFormState = {
        deviceId: deviceID,
        firmware: (typeof firmwareDescription === 'string' && firmwareDescription !== null) ? firmwareDescription : null,
        firmwareVersion: (Array.isArray(firmwareVersion) && firmwareVersion[0] !== null && firmwareVersion[0] !== undefined)
            ? firmwareVersion.join('.') : null,
        nickname: nicknameInput.value || null,
        email: emailInput.value || null,
        chatId: null,
        pushSubscription: subscriptionJson,
        startDate: dt0 ? dt0.toISOString() : null,
        endDate: dt1 ? dt1.toISOString() : null,
        maxVelocity: isNaN(maxVelocity) ? null : maxVelocity,
        frequencyOffset: null,
        earliestSnapshotTime: earliestDate ? earliestDate.toISOString() : null,
        latestSnapshotTime: latestDate ? latestDate.toISOString() : null
    };

    // Display progress on UI
    snapshotCountLabelUpload.innerHTML = snapshotCountLabelUpload.innerHTML + ' Preparing upload.';

    const uploadProgress = (progress) => {

        if (progress.stage === 'compressing') {

            snapshotCountLabelUpload.innerHTML = 'Compressing data.';

        } else if (progress.stage === 'reserving') {

            snapshotCountLabelUpload.innerHTML = 'Checking free upload quota.';

        } else if (progress.stage === 'uploading') {

            const percent = Math.round(progress.value * 100);
            snapshotCountLabelUpload.innerHTML = `Uploading (${percent}%).`;

        }

    };

    let result;

    try {

        result = await uploadSnapperData(uploadFormState, snapshots, referencePoints, uploadProgress);

    } catch (err) {

        displayError(err.message);

        if (setUploading) {

            setUploading(false);

        }

        return;

    }

    if (!result.accepted) {

        // Quota is full: keep any local pending transfer and show the
        // banner described in the design.
        const nextAvailable = formatNextAvailableAt(result.nextAvailableAt);

        const banner = 'The free SnapperGPS upload quota is currently full. ' +
                       (nextAvailable ? 'Please try again on ' + nextAvailable + '.' : 'Please try again later.');

        displayError(banner);

        if (setUploading) {

            setUploading(false);

        }

        return;

    }

    // Store response in local storage with maximum length 20; newest element always first
    storeUploadID(result.uploadId);

    console.log('Upload success');
    window.location.href = 'success.html?uploadid=' + result.uploadId +
                           '&email=' + encodeURIComponent(emailInput.value) +
                           '&push=' + notificationCheckbox.checked;

}

/**
 * Asynchronously read meta data and snapshot from JSON and collect them.
 * @param {object} snapshot Element of snapshot list.
 * @returns {Promise<Object>} Snapshot in raw upload format.
 */
async function snapshotFromJSON(snapshot) {

    // Get timestamp from JSON
    const dt = new Date(snapshot.timestamp);
    // Get temperature from JSON
    const temperature = snapshot.temperature;
    // Get battery voltage from JSON
    const battery = snapshot.batteryVoltage;
    // Base64 data is passed through unchanged
    const dataBase64 = snapshot.data;

    return {
        i: 0, // index is set later
        datetime: dt.toISOString(),
        battery: battery,
        hxfoCount: 1,
        lxfoCount: 1,
        temperature: temperature,
        dataBase64: dataBase64
    };

}

/**
 * React to upload button being clicked by attempting to upload provided data
 */
async function onSelectedUploadButtonClick() {

    snapshotCountLabelUpload.innerHTML = '0 snapshots uploaded.';

    const email = emailInput.value; // User e-mail

    const maxVelocity = getMaxVelocity();

    if (isNaN(maxVelocity)) {

        return;

    }

    console.log('Max. velocity: ' + maxVelocity);

    const nickname = nicknameInput.value;

    setSelectedUploading(true);

    const selectedFiles = Array.from(fileInput.files);

    // Check for single JSON file
    if (selectedFiles.length === 1 && selectedFiles[0].name.split('.').pop().toUpperCase() === 'JSON') {

        // Read JSON file
        const reader = new FileReader();
        reader.onload = async function (e) {

            const dataObj = JSON.parse(e.target.result);
            // Check for valid JSON structure
            if (!dataObj.hasOwnProperty('deviceID') || !dataObj.hasOwnProperty('snapshots')) {

                console.error('Upload failed');
                errorCard.style.display = '';
                errorText.innerHTML = 'Your JSON file has the wrong format.';
                setSelectedUploading(false);
                window.scrollTo(0, 0);
                return;

            }
            // Get device ID from JSON
            deviceID = dataObj.deviceID;
            firmwareDescription = dataObj.firmwareDescription || null;
            firmwareVersion = (typeof dataObj.firmwareVersion === 'string')
                ? dataObj.firmwareVersion.split('.') : [null, null, null];

            // Get snapshots from JSON
            const rawSnapshots = dataObj.snapshots;
            // Get number of snapshots
            const snapshotCount = rawSnapshots.length;
            // Remember earliest and latest snapshot timestamps
            let earliestDate, latestDate;
            // Collect snapshots in raw upload format
            const snapshots = [];

            for (let i = 0; i < snapshotCount; ++i) {

                // Check for valid JSON structure
                if (!rawSnapshots[i].hasOwnProperty('timestamp') ||
                    !rawSnapshots[i].hasOwnProperty('temperature') ||
                    !rawSnapshots[i].hasOwnProperty('batteryVoltage') ||
                    !rawSnapshots[i].hasOwnProperty('data')) {

                    console.error('Upload failed');
                    errorCard.style.display = '';
                    errorText.innerHTML = 'A snapshot in your JSON file has the wrong format.';
                    setSelectedUploading(false);
                    window.scrollTo(0, 0);
                    return;

                }

                // Get timestamp from JSON
                const dt = new Date(rawSnapshots[i].timestamp);

                if (!(dt instanceof Date) || isNaN(dt)) {

                    console.error('Upload failed');
                    errorCard.style.display = '';
                    errorText.innerHTML = 'A timestamp in your JSON file has the wrong format.';
                    setSelectedUploading(false);
                    window.scrollTo(0, 0);
                    return;

                }

                if (!latestDate || dt > latestDate) {

                    latestDate = dt;

                }
                if (!earliestDate || dt < earliestDate) {

                    earliestDate = dt;

                }

                const snapshot = await snapshotFromJSON(rawSnapshots[i]);
                snapshot.i = i;
                snapshots.push(snapshot);

                snapshotCountLabelUpload.innerHTML = `${i + 1} snapshots read.`;

            }

            await finishAndUpload(snapshots, earliestDate, latestDate, setSelectedUploading);

        };
        reader.readAsText(selectedFiles[0]);
        return;

    }

    // .bin files

    deviceID = 'AAAABBBBCCCCDDDD';

    const snapshotCount = selectedFiles.length;
    let i = 0;

    let latestDate, earliestDate;

    let uploadSuccess = true;

    // Collect snapshots in raw upload format
    const snapshots = [];

    // Using a while loop rather than a for loop so this code can more easily be converted into grabbing an unknown number of snapshots from the device
    while (i < snapshotCount) {

        const file = selectedFiles[i];
        const fileName = file.name;

        try {

            try {

                const year = parseInt(fileName.slice(0, 4));
                const month = parseInt(fileName.slice(4, 6)) - 1;
                const day = parseInt(fileName.slice(6, 8));
                const hours = parseInt(fileName.slice(9, 11));
                const minutes = parseInt(fileName.slice(11, 13));
                const seconds = parseInt(fileName.slice(13, 15));
                const milliseconds = (fileName[13] === '_') ? parseInt(fileName.slice(16, 19)) : 0;

                var dt = new Date(Date.UTC(year, month, day, hours, minutes, seconds, milliseconds));

            } catch {

                throw new Error('The name of at least one of your selected binary snapshot files is invalid. ' +
                                'It must follow the scheme YYYYMMDD_hhmmss.mmm.bin.');

            }

            if (!(dt instanceof Date) || isNaN(dt)) {

                throw new Error('The name of at least one of your selected binary snapshot files is invalid. ' +
                                'It must follow the scheme YYYYMMDD_hhmmss.mmm.bin.');

            }

            if (!latestDate || dt > latestDate) {

                latestDate = dt;

            }

            if (!earliestDate || dt < earliestDate) {

                earliestDate = dt;

            }

            try {

                console.log('Uploading file ' + i);

                const fileBuffer = new Uint8Array(await file.arrayBuffer());

                snapshots.push({
                    i: i,
                    datetime: dt.toISOString(),
                    battery: 1,
                    hxfoCount: 1,
                    lxfoCount: 1,
                    temperature: 1,
                    dataBase64: snapshotBufferToBase64(fileBuffer)
                });

            } catch {

                throw new Error('We could not read at least one of your snapshot files. ' +
                                'Please try again.');

            }

            if (!uploadSuccess) {

                throw new Error('We could not read at least one of your snapshot files. ' +
                                'Please try again.');

            }

        } catch (err) {

            displayError(err.message);

            setSelectedUploading(false);

            return;

        }

        snapshotCountLabelUpload.innerHTML = `${++i} snapshots read.`;

    }

    await finishAndUpload(snapshots, earliestDate, latestDate, setSelectedUploading);

}

async function storeUploadID(response) {

    const maxNumOfUploadIDs = 20;

    const uploadData = JSON.parse(localStorage.getItem('uploadData')) || [];
    uploadData.unshift([response, nicknameInput.value]);
    if (uploadData.length > maxNumOfUploadIDs) {
        uploadData.pop();
    }

    localStorage.setItem('uploadData', JSON.stringify(uploadData));
    
}

/**
 * Prepare a grey overlay canvas used to make it obvious a map is not usable
 * @param {object} canvas Grey overlay canvas
 */
function initialiseCanvas(canvas) {

    const ctx = canvas.getContext('2d');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'lightgray';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

}

/**
 * Prepare map interactions
 * @param {integer} index Map index
 */
function initialiseMapUI(index) {

    // Add listener which adds marker to map

    maps[index].on('click', (event) => {

        onMapClick(index, event.latlng);

    });

    // Add functionality for updating map from textboxes

    latInputs[index].addEventListener('change', () => {

        const inputLat = parseFloat(latInputs[index].value);
        const inputLng = parseFloat(lngInputs[index].value);

        if (areValidCoords(inputLat, inputLng)) {

            updateMap(index, { lat: inputLat, lng: inputLng });
            moveMapView(index, inputLat, inputLng);

        }

    });

    lngInputs[index].addEventListener('change', () => {

        const inputLat = parseFloat(latInputs[index].value);
        const inputLng = parseFloat(lngInputs[index].value);

        if (areValidCoords(inputLat, inputLng)) {

            updateMap(index, { lat: inputLat, lng: inputLng });
            moveMapView(index, inputLat, inputLng);

        }

    });

    // Fill in overlay canvas to allow "greying out"

    initialiseCanvas(canvases[index]);

}

/**
 * Looping function which checks to see if WebUSB device has been connected
 */
function checkForDevice(repeat = true) {

    if (isDeviceAvailable()) {

        if (!transferring) {

            // Only talk to device if it is currently not read out.

            getDeviceInformation();

            // Upload/transfer button disabled if no device present
            if (+snapshotCountSpan.innerHTML > 0) {

                if (!uploading && latInputs[0].value !== '' && lngInputs[0].value !== '') {
                    // Can only upload if start point is provided

                    uploadDeviceButton.disabled = false;

                }

                transferButton.disabled = false;

            }

        }

        pairButton.disabled = true;

    } else {

        resetDeviceInfo();

        if (!transferring) {

            uploadDeviceButton.disabled = true;

            transferButton.disabled = true;

            pairButton.disabled = false;

        }

    }

    if (repeat) {

        setTimeout(checkForDevice, 500);

    }

}

function reportCoordinateError(index) {

    latInputs[index].value = '';
    lngInputs[index].value = '';

    latInputs[index].style.border = '2px solid red';
    lngInputs[index].style.border = '2px solid red';

    setTimeout(() => {

        latInputs[index].style.border = '';
        lngInputs[index].style.border = '';

    }, 6000);

}

function checkInputs() {

    let invalidCoords = false;

    const lat0 = parseFloat(latInputs[0].value);
    const lng0 = parseFloat(lngInputs[0].value);

    if (latInputs[0].value === '' || lngInputs[0].value === '') {

        displayError('Please provide the coordinates of your start locations.');

        latInputs[0].style.border = (latInputs[0].value === '') ? '2px solid red' : '';
        lngInputs[0].style.border = (lngInputs[0].value === '') ? '2px solid red' : '';

        setTimeout(() => {

            latInputs[0].style.border = '';
            lngInputs[0].style.border = '';

        }, 6000);

        return false;

    }

    if (!areValidCoords(lat0, lng0)) {

        invalidCoords = true;

        reportCoordinateError(0);

    }

    if (dateInputs[0] !== '' && dateInputs[1] !== '' && timeInputs[0] !== '' && timeInputs[1] !== '') {

        let startDt = dateFromInputs(dateInputs[0].value, timeInputs[0].value);
        let endDt = dateFromInputs(dateInputs[1].value, timeInputs[1].value);

        if (startDt !== null && endDt !== null && startDt > endDt) {

            displayError('Time/date of start point must come before end point.');

            timeInputs[0].style.border = '2px solid red';
            timeInputs[1].style.border = '2px solid red';
            dateInputs[0].style.border = '2px solid red';
            dateInputs[1].style.border = '2px solid red';

            setTimeout(() => {

                timeInputs[0].style.border = '';
                timeInputs[1].style.border = '';
                dateInputs[0].style.border = '';
                dateInputs[1].style.border = '';

            }, 6000);

            return false;

        }

    }

    if (invalidCoords) {

        displayError('Invalid co-ordinates.');
        return false;

    }

    errorCard.style.display = 'none';

    return true;

}

pairButton.addEventListener('click', () => {

    requestDevice((err) => {

        if (err) {

            displayError(err);

        } else {

            errorCard.style.display = 'none';

        }

    });

});

// Set function which is called when connection to a WebUSB device is lost

setDisconnectFunction(() => {

    resetDeviceInfo();
    uploadDeviceButton.disabled = true;
    transferButton.disabled = true;

});

// Add button click events

uploadSelectedButton.addEventListener('click', () => {

    if (checkInputs()) {

        onSelectedUploadButtonClick();

    } else {

        window.scrollTo(0, 0);

    }

});

uploadDeviceButton.addEventListener('click', () => {

    if (checkInputs()) {

        onDeviceUploadButtonClick();

    } else {

        window.scrollTo(0, 0);

    }

});

transferButton.onclick = async () => {

    snapshotCountLabelTransfer.innerHTML = '0 snapshots transferred.';

    if (!isDeviceAvailable()) {

        return;

    }

    setTransferring(true);

    const data = new Uint8Array([AM_USB_MSG_TYPE_GET_INFO]);

    try {

        // Send request packet and wait for response
        let result = await device.transferOut(0x01, data);
        result = await device.transferIn(0x01, 128);

        // Read device ID
        deviceID = BigInt(0);
        for (let i = 20; i >= 13; --i) { // previously 21..14

            deviceID *= BigInt(256);
            deviceID += BigInt(result.data.getUint8(i));

        }

        // Read firmware
        firmwareDescription = '';
        for (let i = 21; i < 53; ++i) { // previously 22..54

            const char = result.data.getUint8(i);
            if (char > 0) {

                firmwareDescription += String.fromCharCode(char);

            }

        }
        var firmwareVersion = [];
        for (let i = 53; i < 56; ++i) { // previously: -> 54..57

            firmwareVersion.push(result.data.getUint8(i));

        }

    } catch (err) {

        console.error(err);

    }

    // ID to string
    deviceID = deviceID.toString(16).toUpperCase();

    // Crate object that holds data for JSON file
    let jsonData = {
        deviceID: deviceID,
        firmwareDescription: firmwareDescription,
        firmwareVersion: firmwareVersion[0] + '.' + firmwareVersion[1] + '.' + firmwareVersion[2],
        snapshots: []
    };

    if (USE_ZIP) {

        // Create zip file that will be returned
        let zip = new JSZip();
        let filenameArray = [];

    }

    // Messages to communicate to device via USB
    const requestMetaDataMessage = new Uint8Array([AM_USB_MSG_TYPE_GET_SNAPSHOT]);
    const requestSnapshotMessage = new Uint8Array([AM_USB_MSG_TYPE_GET_SNAPSHOT_PAGE]);

    // Arrays for meta data
    let timestampArray = [];
    let temperatureArray = [];
    let batteryArray = [];

    // Count the received snapshots
    let snapshotCount = 0;

    // Keep reading data from device until all snapshots are read
    let keepReading = true;

    while (keepReading) {

        const snapshotBuffer = new Uint8Array(SNAPSHOT_SIZE).fill(0);

        try {

            console.log('Request meta data.');
            // Request to start reading new record from flash memory, start with meta data
            let result = await device.transferOut(0x01, requestMetaDataMessage);

            console.log('Wait for meta data.');
            // Wait until meta data is returned
            result = await device.transferIn(0x01, 128);

            const data = result.data;

            // Check if device has sent data
            // Device uses 2nd byte of transmit buffer as valid flag
            if (data.getUint8(1) !== 0x00) {

                // Get metadata

                console.log('Extract time stamp.');

                const meta = new MetaData(data);

                console.log(meta);

                // Append current meta data to arrays
                timestampArray.push(meta.timestamp);
                temperatureArray.push(meta.temperature);
                batteryArray.push(meta.battery);

                console.log('Start reading snapshot.');

                // Index of next unwritten element in snapshotBuffer

                let snapshotBufferIdx = 0;

                console.log('Requesting snapshot');

                // Send message to device to request next piece of snapshot

                let result = await device.transferOut(0x01, requestSnapshotMessage);

                console.log('Waiting for snapshot');
                result = await device.transferIn(0x01, SNAPSHOT_BUFFER_SIZE - METADATA_SIZE);

                // Loop over buffer that has been transmitted via USB

                while (snapshotBufferIdx < SNAPSHOT_BUFFER_SIZE - METADATA_SIZE) {

                    // Write received byte to buffer and increment counter

                    snapshotBuffer[snapshotBufferIdx] = result.data.getUint8(snapshotBufferIdx);
                    ++snapshotBufferIdx;

                }

                // Construct filename from timestamp
                const dt = meta.timestamp;
                const filename = dt.getUTCFullYear() + ('0' + (dt.getUTCMonth() + 1)).slice(-2) +
                    ('0' + dt.getUTCDate()).slice(-2) + '_' + ('0' + dt.getUTCHours()).slice(-2) +
                    ('0' + dt.getUTCMinutes()).slice(-2) + ('0' + dt.getUTCSeconds()).slice(-2) +
                    '_' + ('00' + dt.getUTCMilliseconds()).slice(-3) +
                    '.bin';

                if (USE_ZIP) {

                    // Add file to zip folder
                    zip.file(filename, snapshotBuffer);

                    // Add filename to meta data
                    filenameArray.push(filename);

                }

                // Append meta data and raw snapshot to data object for JSON file
                jsonData.snapshots.push({
                    timestamp: meta.timestamp.toISOString(),
                    temperature: meta.temperature,
                    batteryVoltage: meta.battery,
                    data: snapshotBufferToBase64(snapshotBuffer)
                });

                snapshotCountLabelTransfer.innerHTML = `${++snapshotCount} snapshots transferred.`;

            } else {

                // All snapshot data has been read from flash

                keepReading = false;

            }

        } catch (err) {

            // Stop reading if USB communication failed

            console.error(err);

            // Stop reading if USB communication failed
            keepReading = false;

            displayError('We could not read all data from your SnapperGPS receiver. You might want to unplug and reconnect it and try again.');

            setTransferring(false);

            return;

        }

    }

    const snapshotCountLabelMemory = snapshotCountLabelTransfer.innerHTML;

    snapshotCountLabelTransfer.innerHTML = snapshotCountLabelMemory + ' Preparing JSON download.';

    // Generate filename from device ID and timestamp of first snapshot
    let timeString = '';
    if (jsonData.snapshots.length > 0) {
        timeString = '_' + jsonData.snapshots[0].timestamp.replaceAll('-', '').replaceAll(':', '').replace('T', '_').replace('.', '_').replace('Z', '');
    }

    // Return JSON file
    const jsonContent = 'data:text/json;charset=utf-8,' +
                        JSON.stringify(jsonData, null, 4);
    createDownloadLink(jsonContent, jsonData.deviceID + timeString + '.json');

    snapshotCountLabelTransfer.innerHTML = snapshotCountLabelMemory;

    // Also store the recording locally (IndexedDB) as a pending upload so
    // it can be uploaded later, even after the browser was closed.

    if (jsonData.snapshots.length > 0) {

        try {

            await savePendingUpload({
                deviceId: jsonData.deviceID,
                firmwareDescription: jsonData.firmwareDescription,
                firmwareVersion: jsonData.firmwareVersion,
                snapshots: jsonData.snapshots
            });

            snapshotCountLabelTransfer.innerHTML = snapshotCountLabelMemory + ' Saved transfer locally.';

            renderPendingUploads();

        } catch (err) {

            console.warn('Could not save transfer locally: ' + err.message);

        }

    }

    if (USE_ZIP) {

        snapshotCountLabelTransfer.innerHTML = snapshotCountLabelMemory + ' Preparing ZIP download.';

        // Turn meta data into .csv file

        const rows = [['filename', 'timestamp', 'temperature', 'battery']];

        function fixPrecision(value, precision) {

            try {

                return value.toFixed(precision);

            } catch {

                return value;

            }

        }

        // Loop over all data and add rows to csv array.
        for (let i = 0; i < snapshotCount; ++i) {

            // UNIX time [s] to UTC.
            const datetime = timestampArray[i].toISOString();

            const temperature = fixPrecision(temperatureArray[i], 1);
            const battery = fixPrecision(batteryArray[i], 2);

            rows.push([filenameArray[i], datetime, temperature, battery]);

        }

        const csvContent = rows.map(e => e.join(',')).join('\n');

        // Add CSV file with meta data to zip folder
        zip.file('metadata.csv', csvContent);

        // Construct zip filename from current time
        const zipName = jsonData.deviceID + timeString + '.zip';

        console.log('Save zip file.');
        // Generate zip file asynchronously
        zip.generateAsync({ type: 'blob' }).then(function (content) {

            // Force down of the zip file
            saveAs(content, zipName);

            snapshotCountLabelTransfer.innerHTML = snapshotCountLabelMemory;

        });

    }

    console.log('Save operation done.');

    setTransferring(false);

}

/**
 * Render the list of locally saved (pending) transfers and wire their
 * Upload/Delete buttons. Pending transfers can be uploaded whenever the
 * device is back online; if the quota is full the record is kept and the
 * user is told when to try again.
 */
async function renderPendingUploads() {

    if (!pendingUploadsContainer) {

        return;

    }

    let records = [];

    try {

        records = await listPendingUploads();

    } catch (err) {

        console.warn('Could not list pending uploads: ' + err.message);
        pendingUploadsContainer.style.display = 'none';

        return;

    }

    pendingUploadsContainer.innerHTML = '';

    if (records.length === 0) {

        pendingUploadsContainer.style.display = 'none';

        return;

    }

    pendingUploadsContainer.style.display = '';

    records.forEach((record) => {

        const row = document.createElement('div');
        row.className = 'row row-ident';

        const col = document.createElement('div');
        col.className = 'col';
        col.style.marginBottom = '10px';

        const info = document.createElement('span');
        info.textContent = `${record.deviceId} (${record.snapshots.length} snapshots, saved ${new Date(record.createdAt).toLocaleString()}). `;

        const uploadButton = document.createElement('button');
        uploadButton.className = 'btn btn-primary btn-sm';
        uploadButton.textContent = 'Upload';
        uploadButton.style.marginLeft = '10px';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'btn btn-primary btn-sm';
        deleteButton.textContent = 'Delete';
        deleteButton.style.marginLeft = '10px';

        uploadButton.addEventListener('click', async () => {

            if (!checkInputs()) {

                window.scrollTo(0, 0);
                return;

            }

            uploadButton.disabled = true;
            deleteButton.disabled = true;

            snapshotCountLabelUpload.innerHTML = '0 snapshots uploaded.';

            setSelectedUploading(true);

            // Reference points are taken from the current form, exactly like
            // for an upload from the receiver.
            let latestDate = null;
            let earliestDate = null;

            for (const snapshot of record.snapshots) {

                const dt = new Date(snapshot.timestamp);

                if (!latestDate || dt > latestDate) {
                    latestDate = dt;
                }
                if (!earliestDate || dt < earliestDate) {
                    earliestDate = dt;
                }

            }

            const maxVelocity = getMaxVelocity();

            if (isNaN(maxVelocity)) {

                setSelectedUploading(false);
                return;

            }

            const referencePoints = [];

            let dt0;
            let dt1;

            if (timeInputs[0].value === '' || dateInputs[0].value === '') {
                dt0 = earliestDate;
            } else {
                dt0 = dateFromInputs(dateInputs[0].value, timeInputs[0].value);
            }
            if (timeInputs[1].value === '' || dateInputs[1].value === '') {
                dt1 = latestDate;
            } else {
                dt1 = dateFromInputs(dateInputs[1].value, timeInputs[1].value);
            }
            referencePoints.push(createReferencePointJSON(latInputs[0], lngInputs[0], dt0));
            referencePoints.push(createReferencePointJSON(latInputs[0], lngInputs[0], dt1));

            const uploadFormState = {
                deviceId: record.deviceId,
                nickname: nicknameInput.value || null,
                email: emailInput.value || null,
                chatId: null,
                pushSubscription: subscriptionJson,
                startDate: dt0 ? dt0.toISOString() : null,
                endDate: dt1 ? dt1.toISOString() : null,
                maxVelocity: isNaN(maxVelocity) ? null : maxVelocity,
                frequencyOffset: null,
                earliestSnapshotTime: earliestDate ? earliestDate.toISOString() : null,
                latestSnapshotTime: latestDate ? latestDate.toISOString() : null
            };

            snapshotCountLabelUpload.innerHTML = 'Preparing upload.';

            const uploadProgress = (progress) => {

                if (progress.stage === 'compressing') {

                    snapshotCountLabelUpload.innerHTML = 'Compressing data.';

                } else if (progress.stage === 'reserving') {

                    snapshotCountLabelUpload.innerHTML = 'Checking free upload quota.';

                } else if (progress.stage === 'uploading') {

                    const percent = Math.round(progress.value * 100);
                    snapshotCountLabelUpload.innerHTML = `Uploading (${percent}%).`;

                }

            };

            let result;

            try {

                result = await uploadPendingRecord(record, uploadFormState, referencePoints, uploadProgress);

            } catch (err) {

                displayError(err.message);

                setSelectedUploading(false);
                renderPendingUploads();

                return;

            }

            if (!result.accepted) {

                // Quota full: KEEP the local record and show "try again on ...".
                const nextAvailable = formatNextAvailableAt(result.nextAvailableAt);

                const banner = 'The free SnapperGPS upload quota is currently full. ' +
                               (nextAvailable ? 'Please try again on ' + nextAvailable + '.' : 'Please try again later.');

                displayError(banner);

                setSelectedUploading(false);
                renderPendingUploads();

                return;

            }

            // Success: remove the local record and redirect.
            await deletePendingUpload(record.id);

            storeUploadID(result.uploadId);

            console.log('Upload success');
            window.location.href = 'success.html?uploadid=' + result.uploadId +
                                   '&email=' + encodeURIComponent(emailInput.value) +
                                   '&push=' + notificationCheckbox.checked;

        });

        deleteButton.addEventListener('click', async () => {

            await deletePendingUpload(record.id);
            renderPendingUploads();

        });

        col.appendChild(info);
        col.appendChild(uploadButton);
        col.appendChild(deleteButton);
        row.appendChild(col);
        pendingUploadsContainer.appendChild(row);

    });

}

/**
 * Create an encoded URI to download positions data
 * @param {string} content Text content to be downloaded
 */
function createDownloadLink(content, fileName) {

    const encodedUri = encodeURI(content);

    // Create hidden <a> tag to apply download to

    const link = document.createElement('a');

    link.setAttribute('href', encodedUri);
    link.setAttribute('download', fileName);
    document.body.appendChild(link);

    // Click link

    link.click();

}

fileInput.addEventListener('change', function () {

    if (fileInput.files.length > 0 && latInputs[0].value !== '' && lngInputs[0].value !== '') {
        // Can only upload if start point is provided

        uploadSelectedButton.disabled = false;

    } else {

        uploadSelectedButton.disabled = true;

    }

});

// Push notification handling (see notifications.js)

notificationCheckbox.onchange = async () => {

    try {

        subscriptionJson = await getPushSubscriptionJson(notificationCheckbox.checked);

        if (notificationCheckbox.checked) {

            console.log('We will send a push notfication with the link when processing is complete.');

        }

    } catch (err) {

        console.log(err);
        console.log('Since you did not allow push messages, you will not be notified in the web app when processing is complete.');
        displayError('We could not enable push notifications for you. ' +
                     'Please enter an email address or use our Telegram bot ' +
                     'if you want to receive updates about the processing progress.');
        notificationCheckbox.checked = false;
        subscriptionJson = '{}';

    }

};

function getMaxVelocity() {

    if (velocityInput.value === '') {

        return null;

    } else {

        let maxVelocity = parseFloat(velocityInput.value);

        if (maxVelocity <= 0) {

            displayError('Please enter a maximum velocity that is greater than zero or leave the field blank.');

            velocityInput.style.border = '2px solid red';

            setTimeout(() => {

                velocityInput.style.border = '';

            }, 6000);

            return NaN;

        }

        if (velocityUnitInput.value === 'km/h') {

            maxVelocity /= 3.6;

        } else if (velocityUnitInput.value === 'mph') {

            maxVelocity /= 2.2369362920544;

        }

        return maxVelocity;

    }

}

if (!USE_MAX_VELOCITY) {

    velocityInput.disabled = true;
    velocityUnitInput.disabled = true;

}

window.addEventListener("pageshow", () => {
    console.log('Page show event detected.');

    // Check if coordinates are already given,
    // e.g., after navigating backwards/forwards in the browser
    const inputLat = parseFloat(latInputs[0].value);
    const inputLng = parseFloat(lngInputs[0].value);
    
    if (areValidCoords(inputLat, inputLng)) {

        // Draw uncertainty circle etc
        updateMap(0, { lat: inputLat, lng: inputLng });
    
        // Set map view to given start location
        // moveMapView(0, inputLat, inputLng);
        maps[0].setView([inputLat, inputLng], 11);
    
    }

});

if (!navigator.usb) {

    pairButton.disabled = true;
    transferButton.disabled = true;
    uploadDeviceButton.disabled = true;

} else {

    // Check to see if a device is already connected

    checkForDevice(true);

    connectToDevice(true);

}

// Check if service worker exists, which is required for push notifications.
if ('serviceWorker' in navigator) {

    // Wait until service worker is ready.
    navigator.serviceWorker.ready.then(async function (registration) {

        // Check if browser supports push notifications.
        if (registration.pushManager) {

            // Allow user to subscribe to push notifications by checking checkbox.
            notificationCheckbox.disabled = false;
            notificationLabel.style.color = '';

            // If a subscription already exists, check the checkbox and reuse it.
            try {

                const existing = await getCurrentPushSubscriptionJson();

                if (existing !== '{}') {

                    notificationCheckbox.checked = true;
                    subscriptionJson = existing;
                    console.log('We will send a push notfication with the link when processing is complete.');

                }

            } catch (err) {

                console.log(err);

            }

        }

    });

}

// Prepare the start/end location maps
initialiseMapUI(0);

// Show locally saved transfers that can be uploaded later.
renderPendingUploads();
