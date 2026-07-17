"""Cloud Run function entry point (functions-framework).

Deploy with, e.g.:

    gcloud functions deploy scenario-doc-generator \
      --gen2 --runtime python312 --region us-central1 \
      --source . --entry-point generate --trigger-http \
      --set-env-vars GCS_BUCKET=YOUR_BUCKET,GCS_PREFIX=scenarios/

The function reuses the shared handler in docgen/app.py, so its behavior is
identical to the standalone Flask service.
"""

from __future__ import annotations

import functions_framework
from flask import jsonify

from docgen.app import handle_request


@functions_framework.http
def generate(request):
    payload, status = handle_request(request)
    return jsonify(payload), status
