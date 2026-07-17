"""Upload generated documents to GCS and return a time-limited signed URL.

Configuration is read from the environment:

- ``GCS_BUCKET``                 (required) target bucket name
- ``GCS_PREFIX``                 (optional) object name prefix, e.g. ``scenarios/``
- ``SIGNED_URL_EXPIRY_SECONDS``  (optional) link lifetime, default 7 days (V4 max)
- ``GOOGLE_APPLICATION_CREDENTIALS`` (optional) path to a service-account key;
  when absent, Application Default Credentials are used and V4 URLs are signed
  through the IAM ``signBlob`` API (works on Cloud Run without a key file, as
  long as the runtime service account has ``roles/iam.serviceAccountTokenCreator``).
"""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_V4_EXPIRY_SECONDS = 7 * 24 * 60 * 60  # V4 signed URLs cannot outlive 7 days.


class StorageConfigError(RuntimeError):
    """Raised when required storage configuration is missing."""


def get_bucket_name() -> str:
    bucket = os.environ.get("GCS_BUCKET", "").strip()
    if not bucket:
        raise StorageConfigError("GCS_BUCKET environment variable is not set.")
    return bucket


def _expiry_seconds() -> int:
    raw = os.environ.get("SIGNED_URL_EXPIRY_SECONDS", "").strip()
    if not raw:
        return MAX_V4_EXPIRY_SECONDS
    try:
        seconds = int(raw)
    except ValueError as exc:
        raise StorageConfigError(
            f"SIGNED_URL_EXPIRY_SECONDS must be an integer, got {raw!r}."
        ) from exc
    return max(1, min(seconds, MAX_V4_EXPIRY_SECONDS))


def _object_name(filename: str) -> str:
    prefix = os.environ.get("GCS_PREFIX", "").strip().strip("/")
    return f"{prefix}/{filename}" if prefix else filename


def _key_credentials():
    """Service-account credentials with a private key, if one is configured.

    Enables fully offline V4 signing when a key file is provided.
    """
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if not path or not Path(path).exists():
        return None
    try:
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_file(path)
    except Exception:
        return None


def _signing_kwargs(client):
    """Return kwargs so V4 signing works in every deployment shape.

    1. A service-account key file -> sign offline with it.
    2. The client already has a signer (e.g. Cloud Run default SA via IAM) -> default.
    3. Otherwise -> IAM ``signBlob`` using the SA email + a fresh access token.
    """
    signer = _key_credentials()
    if signer is not None:
        return {"credentials": signer}

    creds = getattr(client, "_credentials", None)
    if creds is not None and getattr(creds, "signer_email", None):
        return {}

    try:
        import google.auth
        from google.auth.transport.requests import Request

        credentials, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        credentials.refresh(Request())
        email = getattr(credentials, "service_account_email", None)
        token = getattr(credentials, "token", None)
        if email and email != "default" and token:
            return {"service_account_email": email, "access_token": token}
    except Exception:
        pass
    return {}


def upload_and_sign(local_path: str | Path, filename: str | None = None) -> dict:
    """Upload ``local_path`` to the configured bucket and return link metadata.

    Returns a dict: ``{"url", "gcsUri", "objectName", "bucket", "expiresInSeconds"}``.
    """
    local_path = Path(local_path)
    bucket_name = get_bucket_name()
    object_name = _object_name(filename or local_path.name)
    expiry = _expiry_seconds()

    from google.cloud import storage

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    blob.upload_from_filename(str(local_path), content_type=DOCX_CONTENT_TYPE)

    url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(seconds=expiry),
        method="GET",
        response_type=DOCX_CONTENT_TYPE,
        **_signing_kwargs(client),
    )

    return {
        "url": url,
        "gcsUri": f"gs://{bucket_name}/{object_name}",
        "objectName": object_name,
        "bucket": bucket_name,
        "expiresInSeconds": expiry,
    }
