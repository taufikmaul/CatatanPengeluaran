#!/bin/sh
# Entrypoint container CatatanPengeluaran.
#
# Menjalankan migrasi Alembic sebelum aplikasi start. Aman dijalankan
# berulang (idempotent): `alembic upgrade head` tidak melakukan apa pun bila
# skema sudah versi terbaru.
#
# Set SKIP_MIGRATIONS=true untuk melewati langkah ini (misal saat migrasi
# dijalankan sebagai job terpisah di pipeline deploy).
set -eu

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  echo "🔄 Menjalankan migrasi database..."
  alembic upgrade head
  echo "✅ Migrasi selesai."
fi

echo "🚀 Menjalankan aplikasi..."
exec "$@"
