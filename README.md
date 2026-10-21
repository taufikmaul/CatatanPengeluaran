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
scripts/                 # Utilitas CLI
├── import_common.py     # Parser & penulis DB bersama (dipakai kedua importer)
├── import_from_csv.py   # Impor riwayat dari file CSV
├── import_from_sheets.py # Impor riwayat langsung dari Google Sheets
└── push-branch.sh       # Terapkan commit ke mesin lokal lalu push (lihat bagian Skrip Transfer)
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

## 🔐 Setup SSH ke VPS

Server produksi menyimpan `.env` (token bot, password, kredensial AI) sehingga
aksesnya **hanya lewat kunci SSH** — autentikasi password dimatikan.

### Konfigurasi yang berlaku di server

| Parameter | Nilai |
|---|---|
| Port | `22` |
| `PubkeyAuthentication` | `yes` |
| `PasswordAuthentication` | `no` |
| `KbdInteractiveAuthentication` | `no` |
| `PermitRootLogin` | `yes` |
| User aplikasi | `ubuntu` (punya `sudo`) |

### 1. Buat kunci di mesin lokal

```bash
# Ed25519 cukup, lebih pendek dan modern daripada RSA
ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)" -f ~/.ssh/catpen_vps

# Kunci privat tidak boleh dibaca user lain
chmod 600 ~/.ssh/catpen_vps
chmod 644 ~/.ssh/catpen_vps.pub
```

Jangan memakai `-N ""` (passphrase kosong) untuk kunci yang dipakai di banyak
mesin. Biarkan `ssh-keygen` meminta passphrase, lalu daftarkan ke `ssh-agent`:

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/catpen_vps
```

### 2. Pasang public key ke server

```bash
ssh-copy-id -i ~/.ssh/catpen_vps.pub ubuntu@43.156.36.246
```

`ssh-copy-id` memerlukan satu kali login password. Kalau password sudah
dimatikan, gunakan cara ini dari mesin yang masih punya sesi aktif:

```bash
cat ~/.ssh/catpen_vps.pub | ssh ubuntu@43.156.36.246 \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Direktori `~/.ssh` wajib `700` dan `authorized_keys` wajib `600`; bila
permission-nya lebih longgar, sshd akan menolak key tersebut dengan pesan yang
tidak jelas (`Permission denied (publickey)`).

### 3. Buat `~/.ssh/config` di mesin lokal

```sshconfig
Host catpen
    HostName 43.156.36.246
    User ubuntu
    IdentityFile ~/.ssh/catpen_vps
    IdentitiesOnly yes
    ServerAliveInterval 60
```

Dengan ini semua perintah cukup memakai `catpen` alih-alih IP dan path kunci.
Opsi `IdentitiesOnly yes` penting bila Anda punya banyak key: tanpa itu ssh
mengirim semua identitas yang dimuat agent, dan server bisa menolak setelah
percobaan yang terlalu banyak.

### 4. Verifikasi

```bash
# -o BatchMode=yes mematikan prompt supaya gagal cepat, bukan menggantung
ssh -o BatchMode=yes catpen 'whoami && hostname'
```

### 5. Kunci akses password (lakukan setelah langkah 4 berhasil)

```bash
# Di server
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sshd -t && sudo systemctl reload ssh
```

> **Kesalahan klasik:** mematikan password sebelum kunci terbukti bekerja akan
> mengunci Anda keluar. Selalu uji dengan `ssh -o BatchMode=yes` **dan** biarkan
> satu sesi SSH lama tetap terbuka sampai key-login terbukti berhasil.
>
> `PermitRootLogin yes` di server ini **tidak disarankan**. Set ke `no`
> (atau `prohibit-password`) setelah Anda yakin `ubuntu` + `sudo` cukup untuk
> semua pekerjaan.

### 6. Hal yang kerap jadi jebakan

- **Group docker pada sesi non-interaktif.** User `ubuntu` ada di grup `docker`,
  tetapi layanan sesi (mis. gateway SSH yang jalan sebagai service) tidak selalu
  mewarisi grup tersebut. Bila `docker compose` gagal dengan
  *permission denied while trying to connect to the Docker daemon socket*,
  jalankan perintahnya lewat `sg docker -c "..."` atau login ulang.
- **`sudo` di server ini tidak meminta password** (`NOPASSWD`). Artinya sesi SSH
  yang bocor sama dengan akses root. Jaga kunci privat, dan jangan menaruhnya di
  mesin bersama.
- **Gunakan `-T` saat `docker compose run`** dari skrip atau `scp` alur non-TTY,
  agar Docker tidak mencoba mengalokasikan TTY.

---

## 🔁 Alur Kerja: Lokal → GitHub → Prod

Aturan yang dipakai: **semua penulisan kode terjadi di mesin lokal**, VPS hanya
menjalankan `git pull`. Ini menjaga repo di server selalu identik dengan remote
sehingga tidak ada perubahan yang hanya hidup di satu tempat.

```
mesin lokal          GitHub              VPS (prod)
git commit/push  →   origin  →   git pull + docker compose up -d --build
```

### Jangan edit langsung di VPS

Mengedit di VPS lalu lupa push membuat repo server menyimpang dari `origin`, dan
`git pull` berikutnya akan konflik atau — lebih buruk — menimpa kerja yang belum
disimpan. Bila sudah terjadi, simpan dulu pekerjaannya sebagai ref supaya tidak
hilang, lalu kembalikan `main` ke posisi remote:

```bash
# Di VPS: amankan pekerjaan yang belum di-push
git tag backup/vps-work-$(date +%F) HEAD

# Kembalikan main ke kondisi origin tanpa menghapus tag backup di atas
git checkout main
git reset --hard origin/main

# Sisa file untracked (mis. __pycache__) tidak tersentuh reset, hapus manual bila perlu
git status --short --untracked-files=all
```

Selama tag `backup/...` masih ada, commit tersebut tetap bisa diambil kembali:
`git checkout backup/vps-work-2026-10-21`. Hapus tag setelah yakin tidak
dibutuhkan lagi.

### Deploy perubahan di prod

```bash
ssh catpen
cd ~/apps/catatan-pengeluaran
git checkout main
git pull
sg docker -c "docker compose up -d --build"    # --build wajib bila Dockerfile/requirements berubah
sg docker -c "docker compose ps"
curl -s http://127.0.0.1:8000/health
```

Bila perubahan menyentuh `docker-compose.yml` (mis. lokasi mount `secrets/` atau
jumlah worker), **restart saja tidak cukup** — container harus dibuat ulang,
sehingga `up -d --build` yang dipakai, bukan `restart`.

### Kalau VPS tidak punya kredensial Git

VPS yang hanya melakukan `pull` sebenarnya tidak perlu kredensial tulis. Namun
bila suatu saat Anda harus mendorong pekerjaan **dari** VPS dan di sana tidak ada
kredensial (tidak ada `credential.helper`, `~/.git-credentials`, token, maupun
kunci privat SSH), `git push` akan berhenti menunggu username. Jangan menempelkan
token ke URL remote atau ke riwayat shell — pakai skrip transfer di bawah.

---

## 📦 Skrip Transfer (`push-branch.sh`)

Dipakai ketika pekerjaan dibuat di satu mesin (mis. VPS) tetapi harus di-push
dari mesin lain yang punya akses GitHub.

Paket transfer terdiri dari:

| Berkas | Isi |
|---|---|
| `feat-impor-historis.bundle` | Git bundle berisi commit, hash asli dipertahankan |
| `patches/*.patch` | Alternatif: patch untuk `git am` |
| `manifest.env` | Nilai harapan: basis commit, jumlah commit, tree hash |
| `push-branch.sh` | Penerap + verifikasi + push |
| `SHA256SUMS` | Checksum seluruh berkas paket |

Skripnya juga tersedia di repo ini sebagai `scripts/push-branch.sh`, jadi tidak
perlu menyalinnya dari paket transfer.

Buat paket di mesin sumber:

```bash
mkdir -p /tmp/catpen-transfer
cd /path/ke/repo
OUT=/tmp/catpen-transfer

# Bundle + patch + manifest dibuat dari satu titik acuan, supaya angkanya konsisten
BASE=$(git rev-parse origin/main)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Sebutkan NAMA ref, bukan "HEAD". Bundle dari range tanpa nama ref tidak
# merekam ref apa pun, sehingga `git fetch <bundle> <branch>` gagal dengan
# "couldn't find remote ref".
git bundle create "$OUT/feat-impor-historis.bundle" "$BASE..refs/heads/$BRANCH"
git format-patch "$BASE..refs/heads/$BRANCH" -o "$OUT/patches" --quiet
cat > "$OUT/manifest.env" <<EOF
EXPECTED_BASE=$BASE
EXPECTED_TREE=$(git rev-parse HEAD^{tree})
EXPECTED_COMMITS=$(git rev-list --count "$BASE..HEAD")
EOF
```

Nilai verifikasi sengaja disimpan di `manifest.env`, **bukan ditulis di dalam
skrip**. Angka yang di-hardcode akan menjadi basi begitu pekerjaan bertambah,
dan skrip akan menolak push yang sebenarnya benar. Bila `manifest.env` tidak
ada, skrip tetap berjalan tetapi memberi peringatan bahwa keutuhan isi tidak
bisa dibuktikan.

### Pemakaian

```bash
# 1. Unduh paket ke mesin lokal
scp -r catpen:/tmp/catpen-transfer ~/Downloads/

# 2. Pastikan paket utuh
cd ~/Downloads/catpen-transfer && sha256sum -c SHA256SUMS

# 3. Terapkan TANPA push, untuk diperiksa dulu
bash push-branch.sh ~/path/ke/CatatanPengeluaran --dry-run

# 4. Terapkan lalu push (meminta konfirmasi sebelum push)
bash push-branch.sh ~/path/ke/CatatanPengeluaran
```

Argumen kedua opsional bila `push-branch.sh` dipanggil dari dalam folder paket.
Jalankan `bash push-branch.sh --help` untuk ringkasan.

### Apa yang diperiksa skrip

1. Repo tujuan valid dan **working tree bersih** (berhenti bila ada perubahan
   belum di-commit, supaya kerja Anda tidak tercampur).
2. `git fetch origin` lalu bandingkan `origin/main` dengan commit basis bundle.
   Bila `main` sudah bergerak, skrip memberi peringatan dan meminta konfirmasi.
3. Membuat branch baru dari `origin/main` (bukan dari `main` lokal yang mungkin
   tertinggal), sehingga yang di-push benar-benar bersih.
4. Menerapkan commit: bundle bila ada (hash asli dipertahankan), atau `git am`
   bila hanya tersedia patch. Kegagalan `git am` di-`abort`, tidak meninggalkan
   repo setengah jadi.
5. **Memverifikasi jumlah commit dan tree hash.** Tree hash dihitung dari isi
   berkas, bukan metadata, jadi nilainya sama persis baik lewat bundle maupun
   patch. Bila tree hash tidak cocok, skrip **menolak push**.
6. Menampilkan log commit dan remote tujuan, lalu meminta konfirmasi eksplisit.
7. `git push -u origin <branch>`, kemudian mencetak URL pembuatan Pull Request.

`--dry-run` mengerjakan langkah 1–6 tanpa langkah 7, sehingga aman dipakai untuk
memeriksa hasil sebelum menyentuh remote.

Skrip ini tidak memodifikasi working tree: semua langkah berjalan di branch baru,
dan bila dijalankan ulang ia me-reset branch tersebut ke `origin/main` terlebih
dahulu (idempoten).

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
