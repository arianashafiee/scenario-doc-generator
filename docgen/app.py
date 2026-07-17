"""HTTP handling: accept a scenario JSON, generate a Word doc, store it in GCS.

The core lives in :func:`handle_request`, which takes a Flask/Werkzeug request and
returns ``(payload_dict, status_code)``. It is shared by:

- the Flask ``app`` here (standalone Cloud Run *service* / local dev), and
- the ``functions-framework`` entry point in ``main.py`` (Cloud Run *function*).

Behavior:
  GET  -> ``{"status": "ok"}`` liveness probe.
  POST -> body is the scenario-actions JSON; responds with
          ``{ filename, url, gcsUri, objectName, bucket, expiresInSeconds }``.

Run locally:  python -m docgen.app          (Flask dev server)
Run in prod:  gunicorn -b :$PORT docgen.app:app
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Tuple

# Load a local .env file for development if python-dotenv is installed.
# On Cloud Run the environment variables are provided directly, so this is a no-op.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from flask import Flask, jsonify, request

from docgen.docx_builder import DEFAULT_TEMPLATE, build_doc
from docgen.manifest import ManifestError, build_manifest
from docgen.storage import StorageConfigError, upload_and_sign

logger = logging.getLogger(__name__)

app = Flask(__name__)

_SLUG_RE = re.compile(r"[^a-z0-9]+")

JsonResponse = Tuple[dict, int]


def _slug(value: str, fallback: str = "scenario") -> str:
    slug = _SLUG_RE.sub("-", (value or "").lower()).strip("-")
    return slug[:60] or fallback


def _output_filename(title: str) -> str:
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%d-%H%M%S-") + f"{now.microsecond // 1000:03d}"
    return f"scenario-{_slug(title)}-{stamp}.docx"


def handle_request(req) -> JsonResponse:
    """Framework-agnostic handler. Returns ``(payload, status_code)``.

    Works with both a Flask route and a functions-framework HTTP function, since
    both pass a Werkzeug/Flask ``request``-like object.
    """
    if req.method == "GET":
        return {"status": "ok"}, 200
    if req.method != "POST":
        return {"error": "Method not allowed; use POST."}, 405

    scenario = req.get_json(silent=True)
    if scenario is None:
        return {"error": "Request body must be valid JSON."}, 400
    if not isinstance(scenario, dict):
        return {"error": "Request body must be a JSON object."}, 400

    source_label = str(scenario.get("sourceLabel") or "scenario-actions.json")

    with tempfile.TemporaryDirectory(prefix="scenario-doc-") as tmp:
        tmp_dir = Path(tmp)
        try:
            manifest = build_manifest(scenario, source_label, tmp_dir)
        except ManifestError as exc:
            return {"error": str(exc)}, 400

        filename = _output_filename(manifest.get("title", "scenario"))
        output_path = tmp_dir / filename

        template = DEFAULT_TEMPLATE if DEFAULT_TEMPLATE.exists() else None
        try:
            build_doc(manifest, output_path, template)
        except Exception as exc:  # noqa: BLE001 - surface builder failures to the caller
            logger.exception("Document generation failed")
            return {"error": f"Document generation failed: {exc}"}, 500

        try:
            result = upload_and_sign(output_path, filename)
        except StorageConfigError as exc:
            return {"error": str(exc)}, 500
        except Exception as exc:  # noqa: BLE001 - surface upload failures to the caller
            logger.exception("Upload failed")
            return {"error": f"Upload failed: {exc}"}, 502

    return {"filename": filename, **result}, 201


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})


@app.post("/")
def generate():
    payload, status = handle_request(request)
    return jsonify(payload), status


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
