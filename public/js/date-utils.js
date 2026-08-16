/****************************************************************************
 * date-utils.js
 *
 * Date helpers shared by the upload and view pages. The existing UI enters
 * local dates/times and the app converts them to ISO 8601 UTC strings that
 * are stored in the Firestore upload document.
 *
 * Author: Jonas Beuchert
 *****************************************************************************/

/**
 * Build a Date from the local date/time inputs of the upload form.
 * Fixes the WebKit problem that YYYY-MM-DD is not recognised by
 * new Date('YYYY-MM-DD hh:mm') and retries with YYYY/MM/DD.
 * @param {string} dateString Value of a date input (YYYY-MM-DD) or ''.
 * @param {string} timeString Value of a time input (hh:mm) or ''.
 * @returns {Date|null} Local Date, or null if the inputs are empty/invalid.
 */
function dateFromInputs(dateString, timeString) {

    if (dateString === '' || dateString === undefined || dateString === null) {

        return null;

    }

    const time = (timeString === '' || timeString === undefined) ? '0:00' : timeString;
    let dt = new Date(dateString + ' ' + time);

    // Fix WebKit problem (WebKit does not recognise YYYY-MM-DD, but YYYY/MM/DD)
    if (isNaN(dt)) {

        console.log('Problem with input date, trying to fix it...');
        dt = new Date(dateString.replace(/-/g, '/') + ' ' + time);

    }

    if (isNaN(dt)) {

        return null;

    }

    return dt;

}

/**
 * Format a Date as a local timezone label, e.g. "UTC+01:00", as used next
 * to the start/end time inputs on the upload page.
 * @param {Date} dt Reference date.
 * @returns {string} Timezone label.
 */
function timezoneLabel(dt) {

    let mins = dt.getTimezoneOffset();
    const sign = mins <= 0 ? '+' : '-';
    mins = Math.abs(mins);
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    h = h < 10 ? '0' + h : h;
    m = m < 10 ? '0' + m : m;

    return `UTC${sign}${h}:${m}`;

}

/**
 * Format a quota "next available" timestamp for the quota-full banner,
 * e.g. "2026-08-19T00:00:00+01:00" -> "19 August 2026".
 * @param {string|null} isoString ISO 8601 timestamp or null.
 * @returns {string|null} Human-readable date, or null if unknown.
 */
function formatNextAvailableAt(isoString) {

    if (!isoString) {

        return null;

    }

    const dt = new Date(isoString);

    if (isNaN(dt)) {

        return isoString;

    }

    return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

}
