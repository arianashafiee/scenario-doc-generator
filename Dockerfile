FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code + the corporate template used for styling.
COPY docgen ./docgen
COPY assets ./assets

EXPOSE 8080

# Cloud Run sets $PORT; gunicorn binds to it. Long timeout covers large exports.
CMD exec gunicorn --bind ":$PORT" --workers 2 --threads 4 --timeout 120 docgen.app:app
