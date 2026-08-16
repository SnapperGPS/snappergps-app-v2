# snappergps-app

This repository contains the front end of [the SnapperGPS web application](https://github.com/SnapperGPS/snappergps-app-v2).

It is the companion app for your SnapperGPS receiver.
Use it to configure your SnapperGPS receiver for your next deployment
and to process the collected data after a completed deployment.

Find the remainder of the back end in [the *snappergps-backend* repository](https://github.com/SnapperGPS/snappergps-backend/).

### Table of contents

  * [Technologies](#technologies)
  * [Repository structure](#repository-structure)
  * [Setting up the GitHub Pages site](#setting-up-the-github-pages-site)
  * [Running the app locally](#running-the-app-locally)
  * [Cloud setup (Firebase / Google Cloud)](#cloud-setup-firebase--google-cloud)
  * [Files](#files)
  * [WebUSB messages](#webusb-messages)
  * [Offline mode](#offline-mode)
  * [Further notes](#further-notes)
  * [Acknowledgement](#acknowledgement)

## Technologies

The front end is designed as [a Progressive Web App](https://web.dev/progressive-web-apps/)
and hence aims to combine the advantages of a web app and a native app.

The app is a **static site hosted on GitHub Pages** — there is no Node.js
server, no NPM, and no build step. The browser talks to Firebase/Google Cloud
as the data plane:

* **Firebase anonymous auth** for silent per-browser sessions (no account,
  no password, no upload code),
* **Firestore** for upload metadata, queue status, and quota counters,
* **Cloud Storage** for the raw compressed uploads and the processed result
  files (one gzip object per upload),
* a tiny **quota gate** (Cloud Run, Python) that is the only component which
  may create upload documents and reserve quota,
* an external **Python processor** that polls Firestore, downloads the raw
  uploads, processes them, and uploads the results.

See [docs/firebase-data-model.md](docs/firebase-data-model.md) for the full
data model, the status state machine, the quota limits, and the retention
policy.

The front end communicates with your SnapperGPS receiver via [the WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/USB).
This allows for secure communication without the need to install a driver.
However, it requires a web browser and an operating system that support the WebUSB API.
Examples of browsers that currently support the WebUSB API are Microsoft Edge and Google Chrome.
Mozilla Firefox and Safari currently do not support the WebUSB API.
Examples of operating systems that currently support the WebUSB API are macOS, Microsoft Windows, and Linux operating systems like Android, Ubuntu, and Chrome OS.
iOS and iPadOS currently do not support the WebUSB API.

[A service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) is present to enable the app to run offline and to serve push notifications.

## Repository structure

All user-facing resources live in [`public`](public):

* The static pages `index.html`, `configure.html`, `upload.html`,
  `search.html`, `view.html`, `success.html`, `privacy.html`, `offline.html`,
  `flash.html`, `accelerometer.html`, and `animate.html`,
* Cascading style sheets in [`public/css`](public/css),
* Icons and photos in [`public/images`](public/images),
* JavaScript for the individual views in [`public/js`](public/js),
* The Firebase client modules in [`public/js`](public/js)
  (`config.js`, `firebase-init.js`, `quota.js`, `encoding.js`,
  `upload-google.js`, `download-google.js`, `offline.js`, ...),
* Important functions that keep the app automatically up-to-date, enable it
  to run offline, and to make push notifications work in
  [`public/service-worker.js`](public/service-worker.js), and
* The web app manifest [`public/manifest.json`](public/manifest.json) that
  comprises all definitions to turn the SnapperGPS website into a PWA.

The Firebase security rules and indexes are at the repository root:
[`firestore.rules`](firestore.rules), [`storage.rules`](storage.rules),
[`firestore.indexes.json`](firestore.indexes.json), and
[`firebase.json`](firebase.json).

[`docs/firebase-data-model.md`](docs/firebase-data-model.md) documents the
Firebase data model. [`docs/snappergps_db_schema.sql`](docs/snappergps_db_schema.sql)
is kept as historical documentation of the old PostgreSQL schema
(`uploads`, `snapshots`, `reference_points`, `positions`) that this Firebase
data plane replaces.

## Setting up the GitHub Pages site

1. Push this repository to GitHub.
2. Open *Settings → Pages*.
3. Under *Build and deployment*, select *Deploy from a branch* and choose the
   branch `main` with folder `/public`.
4. The site is then available at
   `https://<user>.github.io/<repository>/`.

No GitHub Actions workflow is required because there is no build step: the
`public/` directory is already the complete static site.

## Running the app locally

Serve the static files from the `public/` directory, e.g.:

```shell
cd public
python3 -m http.server 8080
```

Then open http://localhost:8080/. WebUSB works on localhost; on other hosts
the app requires HTTPS (the pages redirect to HTTPS automatically).

## Cloud setup (Firebase / Google Cloud)

The production configuration lives in [`public/js/config.js`](public/js/config.js):

* `FIREBASE_CONFIG` — the Firebase web app configuration,
* `RESERVE_UPLOAD_SLOT_URL` — the HTTPS endpoint of the quota gate,
* `RECAPTCHA_ENTERPRISE_SITE_KEY` — set it once App Check should be enabled,
* the hard quota limits (mirrors of the server-side limits).

To change the Firebase project or the quota gate endpoint, edit
`public/js/config.js` — no other file needs to change.

The full Google Cloud setup (Firebase project, Firestore, Cloud Storage,
anonymous auth, App Check, the quota gate, security rules, and the service
account for the Python processor) is described in
[docs/firebase-data-model.md](docs/firebase-data-model.md) and in the
design document that led to this migration.

## Files

Instead of uploading data directly to the server, the users can choose to
transfer the data from their SnapperGPS receiver to their host computer and
store it in a local file (or keep it as a pending upload in the browser's
IndexedDB). This is done via the *Upload* view, too. Two file formats are
available. The legacy file format consisting of a CSV file with meta data
and an individual binary file for each snapshot in a ZIP-compressed
directory is described in [*snapshot-gnss-data*](https://github.com/JonasBchrt/snapshot-gnss-data).
The alternative is a single (mostly) human-readable JSON file for a whole
recording that contains a little bit of meta data (`deviceID`,
`firmwareDescription`, `firmwareVersion`) and an array of individual GNSS
signal `snapshots`. Each snapshot is defined by a measurement `timestamp` in
UTC, a `temperature` measurement in degrees Celsius, a `batteryVoltage`
measurement in volts, and the actual `data`. The latter are the raw signal
amplitudes with one bit per value. The values are stored as byte stream
where the bit order is little and which is encoded using
[Base64](https://developer.mozilla.org/en-US/docs/Glossary/Base64).

## WebUSB messages

The SnapperGPS web app uses the WebUSB API to securely communicate with a
SnapperGPS receiver.
The custom USB messages are defined in the readme of
[*snappergps-firmware*](https://github.com/SnapperGPS/snappergps-firmware).

## Offline mode

Several views of the web app run offline: *Home*, *Configure*, *Upload*
(data transfer), and *Flash*. This is made possible by a service worker,
which is defined in `public/service-worker.js` and registered by
`public/js/pwa.js`. When a page loads, `pwa.js` precaches all files that are
listed in its `CACHE_RESOURCES` array (keep the list in
`public/service-worker.js` in sync). If a user visits a page again offline,
the service worker intercepts any fetch request and provides the data from
the cache. Uploading to the cloud and viewing/downloading processed tracks
require an internet connection. Local transfers (see *Files* above) are
stored in IndexedDB and can be uploaded later when the connection is back.

## Further notes

* The Python back end is not part of this repository. To process snapshots
  that you have uploaded to Firebase/Google, you need to run the script
  `process_queue.py` from the
  [snappergps-backend](https://github.com/SnapperGPS/snappergps-backend)
  repository against the Firestore/Cloud Storage data plane described in
  [docs/firebase-data-model.md](docs/firebase-data-model.md).
* If you add new resources (files) that shall be part of the offline version
  of the app, then make sure that the service worker caches them (see above).
* If you want to release the app in an app store such as Google Play or the
  Microsoft Store, then you can use the
  [PWA builder](https://www.pwabuilder.com/) to package it. Afterwards,
  follow [these instructions](https://github.com/pwa-builder/CloudAPK/blob/master/Next-steps.md)
  to publish it on Google Play or
  [these instructions](https://github.com/pwa-builder/pwabuilder-windows-chromium-docs/blob/master/next-steps.md)
  for the Microsoft Store.

## Acknowledgements

[Jonas Beuchert](https://users.ox.ac.uk/~kell5462/) and
[Alex Rogers](https://www.cs.ox.ac.uk/people/alex.rogers/)
are based
in the Department of Computer Science
of the University of Oxford.

Jonas Beuchert is
funded by the EPSRC Centre for Doctoral Training in
Autonomous Intelligent Machines and Systems
(University of Oxford Project Code: DFT00350-DF03.01, UKRI/EPSRC Grant Reference: EP/S024050/1)
and works on
SnapperGPS as part of his doctoral studies.
The implementation of SnapperGPS
was co-funded by an EPSRC IAA Technology Fund
(D4D00010-BL14).

Parts of the SnapperGPS web app are based on work by [Peter Prince](https://github.com/pcprince).

##

This documentation is licensed under a
[Creative Commons Attribution 4.0 International License][cc-by].

[![CC BY 4.0][cc-by-image]][cc-by]

[cc-by]: http://creativecommons.org/licenses/by/4.0/
[cc-by-image]: https://i.creativecommons.org/l/by/4.0/88x31.png
