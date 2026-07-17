# Scenario Doc Generator

Generate a branded Word document from a scenario actions JSON export, styled with the
Clear Sky corporate template.

## Output layout

The document is generated **from** the corporate template
(`assets/clear-sky-template.docx`) so its named styles, theme colors, and fonts are used
directly.

- **Cover page** (the template's branded cover), filled from the scenario:
  - Title, subtitle (description), and tags
  - `AUTHOR` (Clear Sky Solutions) and `DATE`
  - `FEATURE` and `TEST SUITE` — only added when present in the JSON
- **Header/footer** start on the page after the cover (page 2 onward): the header shows
  the document title; the footer shows the confidentiality label, page number, and URL.
- **Steps** (`Steps` heading, `Heading 1`):
  - One combined scenario, each step on its own line (`Body Text`, 14pt)
  - Gherkin keywords are uppercase and teal: `GIVEN`, `WHEN`, `THEN`, `AND`, `BUT`
  - `GIVEN`/`WHEN`/`THEN` sit flush left; `AND`/`BUT` are indented
  - A data table when input values are present — the header is the input's **variable
    name** (derived from the step selector when the JSON doesn't provide one)
  - Embedded screenshots beneath the step (multiple per step supported)
  - One blank line between steps

Data tables follow the style guide: Midnight Navy (`#061A2E`) header with white text,
alternating White / Mist (`#F3F6F8`) rows, and System Teal (`#00758F`) rules.

## HTTP service (Cloud Run)

The service accepts a scenario JSON, generates the document, uploads it to a GCS bucket,
and returns a **time-limited signed URL**. It can be deployed either as a **Cloud Run
service** (Flask `app` in `docgen/app.py`) or a **Cloud Run function** (`generate` in
`main.py`) — both share the same handler.

| Method & path | Purpose |
| --- | --- |
| `POST /` | Body is the scenario-actions JSON. Returns `201` with `{ url, gcsUri, objectName, filename, expiresInSeconds }`. |
| `GET /healthz` | Liveness probe. |

### Configuration (environment variables)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `GCS_BUCKET` | yes | — | Target bucket name. |
| `GCS_PREFIX` | no | `""` | Object name prefix, e.g. `scenarios/`. |
| `SIGNED_URL_EXPIRY_SECONDS` | no | `604800` (7d, the V4 max) | Signed-URL lifetime. |
| `GOOGLE_APPLICATION_CREDENTIALS` | local: **yes** / Cloud Run: no | ADC | Path to a service-account key. Required locally (its private key signs the URL). On Cloud Run it can be omitted — the built-in service account signs via the IAM `signBlob` API. |
| `PORT` | no | `8080` | Port the server binds to (Cloud Run sets this). |

> **Signing note:** on Cloud Run the runtime service account has no local private
> key, so signing goes through the IAM credentials API. Grant that service account
> `roles/iam.serviceAccountTokenCreator` (on itself) and
> `roles/storage.objectAdmin` on the bucket, and enable `iamcredentials.googleapis.com`.

### Run locally

Locally you need a **service-account key file** — `GOOGLE_APPLICATION_CREDENTIALS` is
required here (not optional as on Cloud Run), because signing the download URL needs the
account's private key. The key's service account must have `roles/storage.objectAdmin` on
the bucket.

```bash
# one-time: create an isolated environment and install deps
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt

# configure — copy the example and fill in your values
cp .env.example .env
# then edit .env: set GCS_BUCKET and GOOGLE_APPLICATION_CREDENTIALS

# dev server (http://localhost:8080) — .env is loaded automatically
./.venv/bin/python -m docgen.app
# or the production server that Cloud Run uses:
# ./.venv/bin/gunicorn -b :8080 docgen.app:app
```

Prefer explicit exports instead of a `.env` file? That works too:

```bash
export GCS_BUCKET=my-bucket
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
./.venv/bin/python -m docgen.app
```

Call it from another shell — the `url` field in the response is your signed download link:

```bash
curl -sS -X POST http://localhost:8080/ \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/scenario-actions-1784040232462.json | python3 -m json.tool
```

### Deploy to Cloud Run

```bash
PROJECT=my-project
REGION=us-central1
BUCKET=my-scenario-docs

# Build & push the image, then deploy.
gcloud run deploy scenario-doc-generator \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "GCS_BUCKET=$BUCKET,GCS_PREFIX=scenarios/"
```

Ensure the Cloud Run service account can write to the bucket and sign URLs:

```bash
SA=$(gcloud run services describe scenario-doc-generator \
  --region "$REGION" --format 'value(spec.template.spec.serviceAccountName)')

gsutil iam ch "serviceAccount:$SA:roles/storage.objectAdmin" "gs://$BUCKET"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member "serviceAccount:$SA" --role roles/iam.serviceAccountTokenCreator
```

### Deploy as a Cloud Run function

The same code also deploys as a **Cloud Run function** (2nd-gen Cloud Function). The
entry point is `generate` in `main.py` (functions-framework); no Dockerfile is used —
Google buildpacks read `requirements.txt` and `main.py`.

The quickest path is the bundled script, which enables the required APIs, grants the
runtime service account its roles, and deploys — run it from an authenticated `gcloud`
session with deploy rights:

```bash
./deploy.sh
```

Or run the deploy manually:

```bash
gcloud functions deploy scenario-doc-generator \
  --gen2 --runtime python312 --region "$REGION" \
  --source . --entry-point generate --trigger-http --allow-unauthenticated \
  --service-account YOUR_RUNTIME_SA \
  --set-env-vars "GCS_BUCKET=$BUCKET,GCS_PREFIX=scenarios/"
```

Grant the function's runtime service account the same two roles shown above
(`storage.objectAdmin` on the bucket + `iam.serviceAccountTokenCreator` on itself), and
enable `iamcredentials.googleapis.com`. Do **not** set `GOOGLE_APPLICATION_CREDENTIALS`
in the cloud — the runtime service account signs via IAM.

Run the function locally exactly as the cloud runs it:

```bash
./.venv/bin/functions-framework --target generate --source main.py --port 8080
```

## CLI usage

```bash
npm install
python3 -m pip install -r requirements.txt

# Generate from the bundled sample JSON
npm run generate:sample
```

Each run writes a uniquely named, timestamped file to `output/`, e.g.
`output/scenario-20260716-124341-970.docx`. **You do not need to specify an output
file** — a new name is created every time.

Run against another export:

```bash
# Auto-named output
npm start -- /path/to/scenario-actions.json

# Or set an explicit output path
npm start -- /path/to/scenario-actions.json --out output/scenario.docx
```

## How it works

The generation logic lives in the importable `docgen` package:

- `docgen/manifest.py` — turns a raw scenario export into a manifest (steps, variable-name
  tables, decoded screenshots).
- `docgen/docx_builder.py` — opens the template, keeps the cover, fills its placeholders,
  places the scenario content in the following section, and applies the Clear Sky styling.
- `docgen/storage.py` — uploads to GCS and returns a signed URL.
- `docgen/app.py` — the shared `handle_request()` plus a Flask `app`.

Entry points that share this package:

- **Cloud Run service / local server** — the Flask `app` in `docgen/app.py`
  (`python -m docgen.app` or `gunicorn docgen.app:app`).
- **Cloud Run function** — `generate` in `main.py` (functions-framework), which just
  calls `handle_request()`.
- **CLI** (`src/index.ts` → `src/generateScenarioDoc.ts`) builds the manifest in
  TypeScript and invokes `scripts/build_docx.py`, a thin wrapper around
  `docgen.docx_builder.build_doc`.

## Screenshot retrieval

Screenshots are read from each step's `screenShots` entries as
`data:image/...;base64,...` values when embedded in the JSON. Service-account fetch can be
added later if screenshots arrive as remote references.
