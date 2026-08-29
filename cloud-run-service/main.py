import json
import secrets
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import functions_framework
import firebase_admin
from firebase_admin import auth, firestore
from google.cloud.firestore_v1 import Increment
from flask import Response


firebase_admin.initialize_app()
db = firestore.client()

ALLOWED_ORIGINS = {
    "https://snappergps.github.io/",
    "https://snappergps.info"
}

MAX_SNAPSHOTS_PER_UPLOAD = 50000
MAX_GZIP_BYTES_PER_UPLOAD = 150 * 1024 * 1024

MAX_UPLOADS_PER_DAY = 25
MAX_RESERVED_GZIP_BYTES_PER_DAY = 600 * 1024 * 1024
MAX_RESERVED_SNAPSHOTS_PER_DAY = 300000

MAX_UPLOADS_PER_MONTH = 250
MAX_RESERVED_GZIP_BYTES_PER_MONTH = 18 * 1024 * 1024 * 1024
MAX_CLASS_A_ESTIMATE_PER_MONTH = 4000
MAX_CLASS_B_ESTIMATE_PER_MONTH = 40000


def make_response(request, body, status=200):
    origin = request.headers.get("Origin", "")
    response = Response(
        json.dumps(body),
        status=status,
        mimetype="application/json"
    )

    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin

    response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Max-Age"] = "3600"
    return response


def reject(reason, next_available_at=None):
    return {
        "accepted": False,
        "reason": reason,
        "nextAvailableAt": next_available_at
    }


def london_periods():
    now = datetime.now(ZoneInfo("Europe/London"))

    day_key = now.strftime("%Y-%m-%d")
    month_key = now.strftime("%Y-%m")

    next_midnight = (now + timedelta(days=1)).replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0
    )

    if now.month == 12:
        next_month = now.replace(
            year=now.year + 1,
            month=1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )
    else:
        next_month = now.replace(
            month=now.month + 1,
            day=1,
            hour=0,
            minute=0,
            second=0,
            microsecond=0
        )

    return day_key, month_key, next_midnight.isoformat(), next_month.isoformat()


def clean_string(value, max_len):
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    return value.strip()[:max_len]


def clean_number(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    return None


@functions_framework.http
def reserve_upload_slot(request):
    if request.method == "OPTIONS":
        return make_response(request, {}, 204)

    if request.method != "POST":
        return make_response(request, {"error": "Method not allowed"}, 405)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return make_response(request, {"error": "Missing Firebase ID token"}, 401)

    id_token = auth_header.removeprefix("Bearer ").strip()

    try:
        decoded_token = auth.verify_id_token(id_token)
    except Exception:
        return make_response(request, {"error": "Invalid Firebase ID token"}, 401)

    uid = decoded_token["uid"]

    try:
        data = request.get_json(force=True) or {}
    except Exception:
        return make_response(request, {"error": "Invalid JSON"}, 400)

    snapshot_count = data.get("snapshotCount")
    estimated_raw_gzip_bytes = data.get("estimatedRawGzipBytes")

    if not isinstance(snapshot_count, int) or snapshot_count < 1:
        return make_response(
            request,
            {"error": "snapshotCount must be a positive integer"},
            400
        )

    if snapshot_count > MAX_SNAPSHOTS_PER_UPLOAD:
        return make_response(request, reject("snapshot_limit_exceeded"))

    if (
        not isinstance(estimated_raw_gzip_bytes, int)
        or estimated_raw_gzip_bytes < 1
    ):
        return make_response(
            request,
            {"error": "estimatedRawGzipBytes must be a positive integer"},
            400
        )

    if estimated_raw_gzip_bytes > MAX_GZIP_BYTES_PER_UPLOAD:
        return make_response(request, reject("upload_too_large"))

    day_key, month_key, next_day, next_month = london_periods()

    upload_id = "u_" + datetime.utcnow().strftime("%Y%m%d") + "_" + secrets.token_hex(8)
    raw_object = f"uploads/{upload_id}/raw.snapper.json.gz"

    daily_ref = db.collection("quotaDaily").document(day_key)
    monthly_ref = db.collection("quotaMonthly").document(month_key)
    upload_ref = db.collection("uploads").document(upload_id)

    reserved_class_a = 6
    reserved_class_b = 4

    @firestore.transactional
    def reserve(transaction):
        daily_snapshot = daily_ref.get(transaction=transaction)
        monthly_snapshot = monthly_ref.get(transaction=transaction)

        daily = daily_snapshot.to_dict() if daily_snapshot.exists else {}
        monthly = monthly_snapshot.to_dict() if monthly_snapshot.exists else {}

        if daily.get("usedUploads", 0) + 1 > MAX_UPLOADS_PER_DAY:
            return reject("daily_upload_quota_exceeded", next_day)

        if daily.get("reservedRawGzipBytes", 0) + estimated_raw_gzip_bytes > MAX_RESERVED_GZIP_BYTES_PER_DAY:
            return reject("daily_storage_quota_exceeded", next_day)

        if daily.get("reservedSnapshots", 0) + snapshot_count > MAX_RESERVED_SNAPSHOTS_PER_DAY:
            return reject("daily_snapshot_quota_exceeded", next_day)

        if monthly.get("usedUploads", 0) + 1 > MAX_UPLOADS_PER_MONTH:
            return reject("monthly_upload_quota_exceeded", next_month)

        if monthly.get("reservedRawGzipBytes", 0) + estimated_raw_gzip_bytes > MAX_RESERVED_GZIP_BYTES_PER_MONTH:
            return reject("monthly_storage_quota_exceeded", next_month)

        if monthly.get("classAEstimate", 0) + reserved_class_a > MAX_CLASS_A_ESTIMATE_PER_MONTH:
            return reject("monthly_operation_quota_exceeded", next_month)

        if monthly.get("classBEstimate", 0) + reserved_class_b > MAX_CLASS_B_ESTIMATE_PER_MONTH:
            return reject("monthly_download_quota_exceeded", next_month)

        transaction.set(daily_ref, {
            "period": day_key,
            "maxUploads": MAX_UPLOADS_PER_DAY,
            "usedUploads": Increment(1),
            "maxReservedRawGzipBytes": MAX_RESERVED_GZIP_BYTES_PER_DAY,
            "reservedRawGzipBytes": Increment(estimated_raw_gzip_bytes),
            "maxSnapshots": MAX_RESERVED_SNAPSHOTS_PER_DAY,
            "reservedSnapshots": Increment(snapshot_count),
            "nextAvailableAt": next_day,
            "updatedAt": firestore.SERVER_TIMESTAMP
        }, merge=True)

        transaction.set(monthly_ref, {
            "period": month_key,
            "maxUploads": MAX_UPLOADS_PER_MONTH,
            "usedUploads": Increment(1),
            "maxReservedRawGzipBytes": MAX_RESERVED_GZIP_BYTES_PER_MONTH,
            "reservedRawGzipBytes": Increment(estimated_raw_gzip_bytes),
            "maxClassAEstimate": MAX_CLASS_A_ESTIMATE_PER_MONTH,
            "classAEstimate": Increment(reserved_class_a),
            "maxClassBEstimate": MAX_CLASS_B_ESTIMATE_PER_MONTH,
            "classBEstimate": Increment(reserved_class_b),
            "nextAvailableAt": next_month,
            "updatedAt": firestore.SERVER_TIMESTAMP
        }, merge=True)

        transaction.create(upload_ref, {
            "uploadId": upload_id,
            "uid": uid,
            "status": "created",

            "deviceId": clean_string(data.get("deviceId"), 64),
            "nickname": clean_string(data.get("nickname"), 200),

            "snapshotCount": snapshot_count,
            "maxSnapshots": MAX_SNAPSHOTS_PER_UPLOAD,

            "estimatedRawGzipBytes": estimated_raw_gzip_bytes,
            "rawObject": raw_object,
            "rawGzipBytes": None,
            "rawSha256": None,

            "positionsCsvObject": None,
            "positionsGeojsonObject": None,
            "previewGeojsonObject": None,
            "summaryObject": None,

            "createdAt": firestore.SERVER_TIMESTAMP,
            "uploadedAt": None,
            "processingStartedAt": None,
            "processingCompletedAt": None,

            "earliestSnapshotTime": clean_string(data.get("earliestSnapshotTime"), 64),
            "latestSnapshotTime": clean_string(data.get("latestSnapshotTime"), 64),

            "startDate": clean_string(data.get("startDate"), 64),
            "endDate": clean_string(data.get("endDate"), 64),
            "maxVelocity": clean_number(data.get("maxVelocity")),
            "frequencyOffset": clean_number(data.get("frequencyOffset")),

            "email": clean_string(data.get("email"), 320),
            "chatId": clean_string(data.get("chatId"), 200),
            "pushSubscription": data.get("pushSubscription"),

            "positionCount": 0,
            "bounds": None,
            "errorMessage": None,

            "readSecret": secrets.token_urlsafe(24),
            "quotaPeriodDay": day_key,
            "quotaPeriodMonth": month_key
        })

        return {
            "accepted": True,
            "uploadId": upload_id,
            "rawObject": raw_object,
            "maxSnapshots": MAX_SNAPSHOTS_PER_UPLOAD,
            "maxRawGzipBytes": MAX_GZIP_BYTES_PER_UPLOAD
        }

    transaction = db.transaction()
    result = reserve(transaction)

    return make_response(request, result)