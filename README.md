# 🎂 CatatanPengeluaran v2.0

Bot Telegram pencatatan pengeluaran untuk **Historycake** — ditenagai **Hermes Agent** (AI Orchestrator) + FastAPI + PostgreSQL.

Migrasi dari Google Apps Script ke VPS dengan fitur lebih powerful.

---

## 🚀 Quick Start di VPS

### 1. Clone & Setup

```bash
git clone <repo-url> catatan-pengeluaran
cd catatan-pengeluaran

# Copy dan isi .env
cp .env.example .env
nano .env
```

### 2. Isi `.env` (wajib):

```env
TELEGRAM_TOKEN=token_bot_dari_botfather
BOT_PASSWORD=password_rahasia_anda
SUMOPOD_API_KEY=sk-your-sumopod-key-here
WEBHOOK_URL=https://domain-anda.com/webhook
DASHBOARD_URL=https://domain-anda.com
SECRET_KEY=string_acak_panjang_anda
DATABASE_URL=postgresql+asyncpg://catpen:catpen_secret@db:5432/catatan_pengeluaran
```

`SECRET_KEY` bukan sekadar formalitas: nilainya dipakai sebagai token admin untuk
endpoint `/setup-webhook` (lihat langkah 5). `DASHBOARD_URL` boleh dikosongkan —
sistem akan menurunkannya dari `WEBHOOK_URL` dengan membuang akhiran `/webhook`.

### 3. Jalankan dengan Docker

```bash
docker compose up -d
```

Cek status:
```bash
docker compose logs -f app
```

### 4. Setup HTTPS (wajib untuk Telegram webhook)

Gunakan Nginx + Certbot:

```bash
# Install nginx & certbot
apt install nginx certbot python3-certbot-nginx -y

# Buat config nginx
cat > /etc/nginx/sites-available/catpen << 'EOF'
server {
    server_name domain-anda.com;
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/catpen /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# SSL
certbot --nginx -d domain-anda.com
```

### 5. Set Webhook

Setelah HTTPS aktif, set webhook. Endpoint ini memicu panggilan ke Telegram API
sehingga dilindungi `SECRET_KEY`: kirim lewat header `X-Admin-Token`, atau lewat
query `?token=`. Tanpa token yang benar hasilnya `403 Forbidden`.

```bash
curl -X POST -H "X-Admin-Token: $SECRET_KEY" https://domain-anda.com/setup-webhook
```

Catatan: app juga memasang webhook otomatis saat startup bila `WEBHOOK_URL` terisi,
jadi langkah ini hanya untuk memaksa pemasangan ulang.

---

## 📋 Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 📷 Scan Struk | Foto struk → AI ekstrak otomatis |
| 🎤 Voice Note | Rekam suara → AI transkripsi & ekstrak |
| ✏️ `/catat` | Input teks → AI parse |
| 📊 `/rekap` | Laporan bulan ini per kategori |
| 🔍 `/harga` | Cari harga terakhir suatu bahan |
| 🛠️ `/audit` | Audit & auto-fix kategori |
| 🔢 `/audit hitung` | Fix perhitungan matematika |
| 🧠 Hermes Memory | Bot ingat konteks + insight harga |
| 📅 Auto-Report | Laporan otomatis Senin pagi |
| 🔄 Sheets Sync | Sync otomatis ke Google Sheets setiap 5 menit (opsional) |
| 📥 Impor Riwayat | Impor data lama dari CSV atau Google Sheets |
| 🌐 Dashboard | Web dashboard dengan chart |

---

## 🗂️ Struktur Project

```
app/
├── main.py              # Entry point FastAPI
├── config.py            # Settings dari .env
├── agent/               # 🧠 Hermes Agent
│   ├── hermes.py        # Orchestrator utama
│   ├── tools.py         # Tool definitions
│   ├── memory.py        # Conversation memory per user
│   └── intent.py        # Intent classifier
├── bot/                 # Telegram layer
│   ├── webhook.py       # POST /webhook
│   ├── callbacks.py     # Inline keyboard handlers
│   └── telegram_client.py
├── services/            # Business logic
│   ├── ai_service.py    # Sumopod API
│   ├── expense_service.py
│   └── sheets_service.py
├── models/              # SQLAlchemy models
├── scheduler/           # Cron jobs
├── dashboard/           # Web dashboard
└── utils/               # Helpers

alembic/                 # Migrasi database (skema dikelola Alembic)
tests/                   # Test suite (pytest + SQLite in-memory)
scripts/                 # Utilitas CLI (impor data historis)
├── import_common.py     # Parser & penulis DB bersama (dipakai kedua importer)
├── import_from_csv.py   # Impor riwayat dari file CSV
└── import_from_sheets.py # Impor riwayat langsung dari Google Sheets
secrets/                 # Credential service account (git-ignored, bukan file repo)
```

---

## 🔄 Google Sheets Sync (opsional)

Data tersimpan di **PostgreSQL** (primary). Google Sheets adalah **salinan
sekunder** yang sifatnya opsional: bot, `/rekap`, dan dashboard tetap berjalan
normal tanpa Sheets sama sekali.

Untuk mengaktifkan sync 5 menit:

1. Buat Google Service Account di GCP.
2. Aktifkan **Google Sheets API** dan **Google Drive API**.
3. Download key JSON, simpan sebagai `secrets/credentials.json`.
4. Share spreadsheet ke email service account tersebut (akses Editor).
5. Set `SPREADSHEET_ID` di `.env`. Path credential dibaca dari
   `GOOGLE_CREDENTIALS_JSON` (default `secrets/credentials.json`).

```bash
mkdir -p secrets && chmod 700 secrets
# salin key JSON ke secrets/credentials.json
chmod 600 secrets/credentials.json
docker compose up -d
```

Bila credential belum ada, sync **ditunda tanpa merusak apa pun**: job hanya
mencatat satu baris peringatan (bukan berulang setiap 5 menit), dan baris baru
tetap tersimpan dengan `sheets_synced = false` sehingga otomatis ikut terkirim
begitu credential dipasang.

> Direktori `secrets/` di-mount **sebagai direktori**, bukan file tunggal.
> Bind-mount file yang belum ada membuat Docker otomatis membuat *direktori*
> kosong bernama sama, dan `gspread` gagal tanpa pesan yang jelas. `secrets/`
> juga sudah masuk `.gitignore` — jangan pernah commit credential.

---

## 📥 Impor Data Historis

Sync aplikasi bersifat **satu arah** (Postgres → Sheets). Data lama yang sudah
ada di spreadsheet tidak otomatis masuk Postgres, jadi dashboard dan `/rekap`
akan terlihat kosong. Dua script di `scripts/` mengisi kekosongan itu.

### Jalur CSV (disarankan, tanpa setup GCP)

1. Buka spreadsheet → **File → Download → Comma Separated Values (.csv)**.
2. Upload ke server, lalu cek dulu tanpa menulis:

```bash
# dari host: kirim file ke container lewat volume
scp pengeluaran.csv ubuntu@server:~/pengeluaran.csv

docker compose run --rm --no-deps \
  -v ~/pengeluaran.csv:/tmp/data.csv:ro -T app \
  python scripts/import_from_csv.py /tmp/data.csv --dry-run

# hapus --dry-run bila hasil parsing sudah benar
```

### Jalur Google Sheets (butuh service account)

```bash
docker compose run --rm --no-deps -T app \
  python scripts/import_from_sheets.py --dry-run
```

Opsi yang tersedia di kedua importer: `--dry-run`, `--limit N`, dan
`--date-format "%d/%m/%Y"` untuk tanggal ambigu. Importer CSV menambahkan
`--no-header` dan `--delimiter` bila deteksi otomatis meleset.

Yang ditangani importer CSV secara otomatis: delimiter koma maupun titik-koma
(Excel locale Indonesia), encoding UTF-8/BOM/CP1252/Latin-1, angka Rupiah
(`Rp 15.000`, `1.500.000`, `15.000,50`), baris kosong, dan baris header.

Dua jaminan keamanan yang sama berlaku untuk kedua jalur:

- **Tidak menulis balik ke Sheet.** Semua baris historis ditandai
  `sheets_synced = true`, jadi job sync tidak akan menggandakannya di spreadsheet.
- **Idempoten.** Kunci (tanggal, supplier, barang, total) dibandingkan dengan isi
  database, sehingga impor boleh diulang kapan saja — baris yang sudah ada akan
  dilewati (`duplikat dilewati`), bukan diduplikasi. Nilai uang dinormalisasi ke
  2 desimal sebelum dibandingkan, karena `Decimal("30000")` dan
  `Decimal("30000.00")` — bentuk yang dikembalikan Postgres — bukan string yang sama.

---

## 🌐 Dashboard

Buka browser: `https://domain-anda.com/dashboard`

Fitur dashboard:
- Filter per bulan, tahun, kategori
- Donut chart breakdown per kategori
- Tabel data dengan pagination
- Highlight tagihan belum lunas

---

## 📡 API Endpoints

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/` | GET | Status app |
| `/health` | GET | Health check |
| `/webhook` | POST | Telegram webhook |
| `/dashboard` | GET | Dashboard web |
| `/setup-webhook` | POST | Set ulang webhook (butuh `X-Admin-Token`) |
| `/docs` | GET | Swagger API docs |

---

## 🗄️ Migrasi Database (Alembic)

Skema database **dikelola Alembic**. `create_all` sudah tidak dipakai di
produksi; container menjalankan `alembic upgrade head` otomatis lewat
`docker-entrypoint.sh` sebelum uvicorn start.

```bash
# Terapkan semua migrasi
alembic upgrade head

# Lihat versi aktif
alembic current

# Cek apakah model berubah tapi belum ada migrasi
alembic check

# Buat migrasi baru setelah mengubah model
alembic revision --autogenerate -m "tambah kolom x"

# Rollback satu langkah
alembic downgrade -1
```

URL database dibaca dari `DATABASE_URL` (bukan dari `alembic.ini`). Untuk
menjalankan migrasi di database lain tanpa mengubah `.env`:

```bash
alembic -x db_url="postgresql+asyncpg://user:pass@host:5432/db" upgrade head
```

Set `SKIP_MIGRATIONS=true` bila migrasi dijalankan sebagai job terpisah di
pipeline deploy.

---

## ⚙️ Catatan Operasional

### Jalankan tepat satu worker

Container sengaja memakai `--workers 1`. Uvicorn dengan beberapa worker
menjalankan `lifespan` di **setiap** proses, sehingga:

- APScheduler terpasang lebih dari sekali → laporan mingguan dan sync Sheets
  bisa terkirim ganda;
- `setWebhook` dipanggil berkali-kali saat startup → Telegram membalas
  `429 Too Many Requests`.

Untuk menambah kapasitas, jalankan beberapa **container** di belakang load
balancer hanya jika scheduler dipisah ke proses sendiri.

### Perilaku autentikasi di private chat

User yang belum terdaftar hanya bisa mengirim password. Setelah password benar,
user langsung dicatat di tabel `users` **dan** pesan tersebut diteruskan ke
pipeline normal, sehingga menu utama tampil di balasan yang sama — bukan pesan
"akses diterima" yang menggantung tanpa tindak lanjut.

### Exception tidak lagi ditelan

Handler `/webhook` selalu membalas `200 OK` (Telegram akan mengulang kiriman bila
menerima non-2xx), tetapi traceback-nya kini dicatat ke log container. Kalau bot
terlihat diam, periksa `docker compose logs app` — jangan berasumsi pesan tidak
sampai.

---

## 🧪 Testing

Test suite memakai **SQLite in-memory**, jadi tidak butuh PostgreSQL dan tidak
memanggil jaringan (Telegram & AI selalu di-mock).

```bash
# Sekali setup
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt

# Jalankan test
.venv/bin/python -m pytest

# Dengan coverage
.venv/bin/python -m pytest --cov=app --cov-report=term-missing
```

Cakupan test saat ini:

| File | Fokus |
|---|---|
| `tests/test_formatters.py` | Format Rupiah, tanggal, progress bar |
| `tests/test_validators.py` | Rekalkulasi total, validasi kategori |
| `tests/test_intent.py` | Klasifikasi command, media, natural language |
| `tests/test_expense_service.py` | Simpan, dedupe, rekap bulanan, pagination |
| `tests/test_agent_tools.py` | Audit kategori/perhitungan, price insight |
| `tests/test_memory_and_auth.py` | Autentikasi user, conversation memory |
| `tests/test_webhook.py` | Auth flow, routing media/teks, dedup callback |
| `tests/test_app.py` | Endpoint utilitas, dashboard, konsistensi skema |
| `tests/test_migrations.py` | Alembic upgrade/downgrade & anti-drift |
| `tests/test_import_from_csv.py` | Deteksi delimiter/encoding, tanggal ambigu, angka Rupiah, kunci dedupe |
| `tests/test_import_from_sheets.py` | Parsing baris sheet & konversi tipe |

> Catatan: gunakan Python 3.12. `asyncpg==0.29.0` belum bisa dikompilasi di
> Python 3.13+.
