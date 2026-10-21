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
DATABASE_URL=postgresql+asyncpg://catpen:catpen_secret@db:5432/catatan_pengeluaran
```

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

Setelah HTTPS aktif:
```bash
curl -X POST https://domain-anda.com/setup-webhook
```

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
| 🔄 Sheets Sync | Sync otomatis ke Google Sheets setiap 5 menit |
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
```

---

## 🔄 Google Sheets Sync

Data tersimpan di **PostgreSQL** (primary), lalu otomatis di-sync ke Google Sheets setiap 5 menit.

Untuk aktifkan:
1. Buat Google Service Account
2. Download `credentials.json`
3. Share Spreadsheet ke email service account
4. Set `SPREADSHEET_ID` dan `GOOGLE_CREDENTIALS_JSON` di `.env`

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
| `/setup-webhook` | POST | Set ulang webhook |
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

> Catatan: gunakan Python 3.12. `asyncpg==0.29.0` belum bisa dikompilasi di
> Python 3.13+.
