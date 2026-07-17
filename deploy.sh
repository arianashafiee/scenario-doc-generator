#!/usr/bin/env bash
# Deploy the scenario doc generator as a Cloud Run function (2nd gen).
#
# Prerequisite: an authenticated gcloud session with deploy permission on the
# project (`gcloud auth login` + access to gcp-learning-257814). No key file is
# used in the cloud — the function runs as the runtime service account below and
# signs URLs via IAM.
set -euo pipefail

PROJECT=gcp-learning-257814
REGION=${REGION:-us-central1}
BUCKET=exported-documents
SA=exporter-sa@gcp-learning-257814.iam.gserviceaccount.com
NAME=scenario-doc-generator

gcloud config set project "$PROJECT"

echo "== enabling required APIs =="
gcloud services enable \
  run.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com storage.googleapis.com iamcredentials.googleapis.com

echo "== granting runtime service account roles =="
# Write objects to the bucket.
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
# Sign download URLs via IAM (SA signs as itself).
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountTokenCreator

echo "== deploying Cloud Run function =="
gcloud functions deploy "$NAME" \
  --gen2 --runtime python312 --region "$REGION" \
  --source . --entry-point generate --trigger-http --allow-unauthenticated \
  --service-account "$SA" \
  --set-env-vars "GCS_BUCKET=$BUCKET,GCS_PREFIX=scenarios/"

echo "== done =="
gcloud functions describe "$NAME" --gen2 --region "$REGION" \
  --format='value(serviceConfig.uri)'
