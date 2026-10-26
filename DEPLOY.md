# Deploy catatan-pengeluaran (image-based, tanpa clone + build di VPS)

Ritual lama (sudah tidak dipakai untuk production):
`git pull` -> `npm run build` di host -> `docker compose up -d --build app`.
Itu membuat VPS jadi build machine dan tidak punya rollback yang bersih.

Ritual baru:

1. Push ke `main` seperti biasa. GitHub Actions otomatis build Docker
   image (frontend ikut dibuild di dalam image, multi-stage Dockerfile)
   dan push ke `ghcr.io/taufikmaul/catatanpengeluaran` dengan tag
   `sha-<commit>` dan `latest`.
2. Di VPS, dari direktori deploy yang berisi `docker-compose.prod.yml`,
   `.env`, dan `secrets/` (tidak perlu source code / repo git):
   ```
   docker compose -p catatan-pengeluaran -f docker-compose.prod.yml pull app
   docker compose -p catatan-pengeluaran -f docker-compose.prod.yml up -d
   ```
   `pull_policy: always` memastikan container baru selalu pakai image
   yang baru di-pull. `-p catatan-pengeluaran` menjaga nama volume
   (`catatan-pengeluaran_postgres_data`, `catatan-pengeluaran_app_logs`)
   dan nama container (`catpen_app`, `catpen_db`) tetap sama.
3. Verifikasi: `https://yuk-damel.web.id/app` 200, container `catpen_app`
   up, dan migrasi Alembic jalan di entrypoint (lihat log bila perlu).

Rollback: deploy ulang dengan tag image commit sebelumnya, tanpa build:
```
CATPEN_IMAGE_TAG=sha-<commit-lama> docker compose -p catatan-pengeluaran -f docker-compose.prod.yml up -d app
```

Catatan:
- `.env` dan `secrets/` tetap hanya di VPS, tidak pernah masuk image
  (lihat `.dockerignore`). Jangan commit file-file itu.
- `docker-compose.yml` (dengan `build: .`) dipertahankan untuk
  pengembangan lokal. Production selalu pakai `docker-compose.prod.yml`.
- Tag `latest` hanya dibuat dari `main`. Push ke branch
  `feat/image-deploy` hanya membuat tag `sha-<commit>` untuk uji coba.
