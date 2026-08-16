# Firebase data model

This document describes the data plane of the SnapperGPS web app after the
migration from a Node.js/Express/PostgreSQL backend to Firebase/Google Cloud.

The app is a static site hosted on GitHub Pages. The browser talks to
Firebase (anonymous auth, App Check, Firestore metadata, Cloud Storage
objects) and to one tiny server-side quota gate ("reserve upload slot") that
runs as a Cloud Run service. An external Python processor polls Firestore,
downloads the raw uploads, processes them, uploads the result objects, and
updates the upload metadata.

The most important design rule: **there are no per-snapshot database rows or
documents**. Every upload becomes exactly one compressed Cloud Storage object
plus a small Firestore metadata document. A 50k-snapshot upload must not
create 50k writes/rows.

---

## 1. Firestore collections

### `uploads/{uploadId}`

One document per upload, created by the quota gate. Example:

```json
{
  "uploadId": "u_20260816_9f6c0c6b",
  "uid": "firebaseAnonymousUid",
  "status": "created",

  "deviceId": "0123456789abcdef",
  "nickname": "tag 17",

  "snapshotCount": 43821,
  "maxSnapshots": 50000,

  "rawObject": "uploads/u_20260816_9f6c0c6b/raw.snapper.json.gz",
  "rawGzipBytes": null,
  "rawSha256": null,

  "positionsCsvObject": null,
  "positionsGeojsonObject": null,
  "previewGeojsonObject": null,

  "createdAt": "serverTimestamp",
  "uploadedAt": null,
  "processingStartedAt": null,
  "processingCompletedAt": null,

  "earliestSnapshotTime": "2026-08-16T08:00:00Z",
  "latestSnapshotTime": "2026-08-16T11:00:00Z",

  "startDate": null,
  "endDate": null,
  "maxVelocity": 20.0,
  "frequencyOffset": null,

  "email": null,
  "chatId": null,
  "pushSubscription": null,

  "positionCount": 0,
  "bounds": null,
  "errorMessage": null,

  "readSecret": "long-random-secret",
  "quotaPeriodDay": "2026-08-16",
  "quotaPeriodMonth": "2026-08"
}
```

### `uploads/{uploadId}/referencePoints/{referencePointId}`

User-provided start/end points, written by the browser after the quota gate
accepted the upload:

```json
{
  "lat": 51.123456,
  "lng": -1.234567,
  "datetime": "2026-08-16T08:00:00Z"
}
```

### `quotaDaily/{YYYY-MM-DD}` and `quotaMonthly/{YYYY-MM}`

Quota counters. Only the quota gate may read/write them; security rules deny
them to browsers entirely.

---

## 2. Cloud Storage object layout

```
uploads/{uploadId}/raw.snapper.json.gz   one gzip JSON file per upload
results/{uploadId}/positions.csv.gz
results/{uploadId}/positions.geojson.gz
results/{uploadId}/preview.geojson
results/{uploadId}/summary.json
tmp/{uploadId}/...
```

The one-object-per-upload design is essential for staying inside the Cloud
Storage free tier (5,000 Class A operations/month): 50 chunks per upload
would consume 15,000 Class A operations/month.

The raw object is a gzip JSON file with format `snappergps.raw-upload.v1`
(see `public/js/upload-google.js`), containing the snapshots, the reference
points, and the processing options.

**Map display uses all positions.** The download page renders every position
on the map (with the old filtering: confidence-based plausibility and the
selected date range), exactly like the old app. It loads
`results/{uploadId}/positions.geojson.gz` and only falls back to
`preview.geojson` if the full object is unavailable. `preview.geojson` is
therefore not required to be a subsample; the migration script writes the
full positions into it as well.

---

## 3. Status state machine

Used consistently in the front end (public/js/firestore-model.js) and in the
Python processor:

| status       | meaning                                                              |
|--------------|----------------------------------------------------------------------|
| `created`    | the quota gate created the upload document                           |
| `uploading`  | optional; the browser has started the Cloud Storage upload           |
| `waiting`    | raw object uploaded, ready for the processor                         |
| `processing` | the Python worker has claimed the upload                             |
| `complete`   | result objects uploaded and metadata updated                         |
| `failed`     | the processor failed, `errorMessage` is set                          |
| `expired`    | optional; result files deleted                                       |

Browser transitions (enforced by `firestore.rules`):
`created -> uploading -> waiting`. The browser may only set the fields
`status`, `uploadedAt`, `rawGzipBytes`, and `rawSha256` after creation.

---

## 4. Quota limits

Hard limits enforced by the quota gate (server-side; also mirrored in
`public/js/config.js` for a first client-side check):

```
MAX_SNAPSHOTS_PER_UPLOAD          = 50000
MAX_GZIP_BYTES_PER_UPLOAD         = 150 MB
MAX_UPLOADS_PER_DAY               = 10
MAX_RESERVED_GZIP_BYTES_PER_DAY   = 600 MB
MAX_UPLOADS_PER_MONTH             = 250
MAX_RESERVED_GZIP_BYTES_PER_MONTH = 18 GB
MAX_CLASS_A_ESTIMATE_PER_MONTH    = 4000
MAX_CLASS_B_ESTIMATE_PER_MONTH    = 40000
```

If a quota is exhausted, the gate rejects the reservation
(`{accepted: false, reason, nextAvailableAt}`) and the upload page shows:
"The free SnapperGPS upload quota is currently full. Please try again on
19 August." Locally saved (pending) transfers are kept and can be retried
later.

---

## 5. Retention windows

Cloud Storage lifecycle rules are the fallback deletion mechanism (do not
rely on Firestore TTL — Firestore TTL deletes are not free):

```
tmp/      delete after 1 day
uploads/  delete after 2 days
results/  delete after 3 days
```

The Python worker additionally deletes the raw object after successful
processing (`DELETE_RAW_AFTER_SUCCESS=true`), so the raw object usually never
reaches the lifecycle deadline.

---

## 6. Python worker contract

The external Python processor (snappergps-backend):

1. polls `uploads` where `status == "waiting"` (transactional claim,
   `status -> "processing"`, `processingStartedAt`, `processorId`,
   `leaseExpiresAt`),
2. downloads `uploads/{uploadId}/raw.snapper.json.gz`,
3. reads `uploads/{uploadId}/referencePoints`,
4. validates the raw payload (format, snapshot count, device ID, SHA-256),
5. runs the existing SnapperGPS processing,
6. uploads the four result objects to `results/{uploadId}/...`,
7. sets `status = "complete"` with result metadata, and
8. optionally deletes the raw object.

Stale leases (`status == "processing"` with expired `leaseExpiresAt`) are
reset to `waiting` (bounded retries, then `failed`).

**Stale reservations:** if a browser crashes between the quota-gate
acceptance and the final `waiting` update, the upload document stays in
`created`/`uploading` with the quota still reserved (security rules forbid
browser-side deletes). The processor ignores such documents (it only picks
up `waiting`), the storage lifecycle rules delete stray raw objects, and it
is up to the server side to expire stale reservations (e.g., the quota gate
or the processor resetting `created`/`uploading` documents older than a
lease window back into the quota counters).

---

## 7. Deviations from the original design document (and why)

- **Firebase Web SDK compat build (v12.0.0) from `www.gstatic.com` is loaded
  via plain `<script>` tags** instead of the modular SDK via npm/bundler.
  The app must run on GitHub Pages without any build step or NPM usage, and
  the compat SDK is the documented no-bundler path. Pages never bundle;
  every script is a static file.
- **The quota gate is called with `fetch()`** (see `public/js/quota.js`)
  because the deployed gate is a Cloud Run Python function
  (`https://reserve-upload-slot-862041235274.us-central1.run.app`) rather
  than a Firebase Callable Function. The request/response contract is
  otherwise identical to the design document. The browser sends the Firebase
  ID token as `Authorization: Bearer <token>` and the App Check token as
  `X-Firebase-AppCheck` (when App Check is enabled).
- **App Check is only initialised when a reCAPTCHA Enterprise site key is
  configured** (`RECAPTCHA_ENTERPRISE_SITE_KEY` in `public/js/config.js`).
  While App Check is in monitor mode, the app runs without it.
- **No GitHub Actions workflow**: there is no build step. GitHub Pages is
  configured with *Deploy from a branch* → folder `/public`. If a workflow
  is ever wanted, `npm ci && npm run build` does not apply here (no NPM).
- **Viewing uploads is public**, like the old view-by-upload-ID behaviour:
  `firestore.rules` / `storage.rules` allow anyone to read upload metadata
  and reference points, and to download the processed result objects once
  `status == "complete"`. The raw upload object (`uploads/{uploadId}/raw.snapper.json.gz`)
  and the raw checksum remain readable only by the upload owner (anonymous
  uid); the `tmp/` prefix and the quota documents stay fully denied.
  Consequence: the upload document also contains the notification fields
  (`email`, `chatId`, `pushSubscription`) and `readSecret`, which are
  readable by anyone with the upload ID. If those must stay private, move
  them into a separate private subcollection (e.g.
  `uploads/{uploadId}/private`) and have the processor read them from
  there; the front end and the quota gate would need a matching change.

---

## 8. Local development

Serve the static site from the `public/` directory, e.g.:

```shell
cd public
python3 -m http.server 8080
```

Open http://localhost:8080/. WebUSB requires HTTPS except for localhost.
Firebase anonymous auth, Firestore, and Storage work from localhost with the
configured project.
