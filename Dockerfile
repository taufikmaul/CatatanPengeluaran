# syntax=docker/dockerfile:1
# Multi-stage build: frontend dibuild di sini, jadi VPS tidak perlu
# npm / node_modules / source frontend lagi. VPS hanya pull image jadi.
#
# Stage 1: build frontend (Vite + TypeScript)
FROM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: runtime backend (FastAPI + frontend dist hasil stage 1)
FROM python:3.12-slim
WORKDIR /app

# System deps untuk asyncpg dan pillow
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./
# dist dari stage frontend, bukan dist stale dari host. FastAPI
# menyajikannya di /app (lihat app/main.py: frontend/dist).
COPY --from=frontend /src/dist ./frontend/dist

# Create logs dir
RUN mkdir -p /app/logs && chmod +x /app/docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
