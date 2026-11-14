# Tripzy Intelligence engine (FastAPI). Deploy as its own service and point the
# platform's TRIPZY_ENGINE_URL at it; both services share TRIPZY_ENGINE_KEY.
FROM python:3.12-slim

# Tesseract: free, local OCR for photos of tickets
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY data_store/osrm_matrix_cache.json ./data_store/osrm_matrix_cache.json
RUN useradd --create-home tripzy && chown -R tripzy /app
USER tripzy

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
# Reachable from outside, so the shared key is mandatory: refuse to start without it.
CMD ["sh", "-c", "[ -n \"$TRIPZY_ENGINE_KEY\" ] || { echo 'TRIPZY_ENGINE_KEY must be set'; exit 1; }; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
