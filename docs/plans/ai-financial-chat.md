# Rencana Implementasi: AI Financial Chat (Historycake)

Dokumen rencana implementasi fitur AI Financial Chat untuk Owner (`admin`) pada aplikasi `CatatanPengeluaran`, menggunakan komponen berbasis adaptasi `blocks-so/ai-05` (kombinasi popup chat + mode layar penuh `/ai-chat`), streaming SSE, persistensi percakapan di PostgreSQL via Alembic, Read-Only Tool Calling ke service keuangan existing, serta pemilihan provider & model AI (ClassAI dan Sumopod) yang dapat diatur di Pengaturan dan diganti langsung saat chat.

---

## Step 1: Skema database dan migrasi Alembic untuk sesi dan pesan AI Chat

Tambahkan model SQLAlchemy `AiChatSession` dan `AiChatMessage` di `app/models/ai_chat.py`, daftarkan di `app/models/__init__.py`, dan buat migrasi Alembic untuk membuat tabel `ai_chat_sessions` (`id`, `title`, `provider`, `model_id`, `created_at`, `updated_at`) dan `ai_chat_messages` (`id`, `session_id` FK cascade, `role`, `content`, `provider`, `model_used`, `tool_calls_json`, `created_at`) lengkap dengan indeks `(session_id, created_at)`.

- Acceptance: Migrasi `alembic upgrade head` dan `alembic downgrade -1` berjalan bersih pada database kosong; unit test CRUD dasar `AiChatSession` dan cascade delete `AiChatMessage` lulus.
- Out of scope: Endpoint API dan service pemanggilan LLM.

## Step 2: Konfigurasi multi-provider AI Chat (ClassAI & Sumopod) di backend dan Settings API

Tambahkan pengaturan khusus AI Chat di `app/config.py`, `app/services/system_setting_service.py`, `app/api/config.py`, `app/api/schemas.py`, dan `.env.example` meliputi `ai_chat_default_provider` (`classai` atau `sumopod`), `ai_chat_default_model`, `ai_chat_classai_models`, `ai_chat_sumopod_models`, serta ekspos pengaturan ClassAI (`ai_analysis_api_key` write-only masked, `ai_analysis_url`, `ai_analysis_model`) pada endpoint admin `/api/v1/config` dengan proteksi `require_admin_role` dan masking secret.

- Acceptance: `GET /api/v1/config` tidak pernah mengembalikan plaintext API key; `PUT /api/v1/config` menyimpan konfigurasi provider ClassAI, Sumopod, dan daftar model AI Chat ke `system_settings` serta menerapkan ke runtime; role non-admin mendapat HTTP 403.
- Out of scope: UI tab konfigurasi di frontend dan runtime streaming chat.

## Step 3: Deterministic Read-Only Financial Tools untuk AI Chat

Buat modul `app/services/ai_chat_tools.py` berisi 9 read-only tool wrapper terstruktur beserta skema OpenAI function calling yang memanggil service existing (`get_monthly_report`, `get_monthly_leaderboards`, `get_all_expenses_paginated`, `get_daily_cashflow`, `list_bank_accounts`, `get_accounting_report`, `get_effective_budget`, `get_unpaid_summary`, `get_reimbursement_summary`, `get_price_inflation_summary`, `get_item_price_history`, `get_suppliers`, `load_all_menus_graph`, `asset_service`, dan `purchase_request_service`) dengan output Observation Contract (`status`, `summary`, `data`, `period`).

- Acceptance: Semua 9 tool memiliki validasi parameter eksplisit, bersifat read-only tanpa mutasi DB, mengembalikan bentuk observation deterministik, dan lulus unit test di `tests/test_ai_chat_tools.py`.
- Out of scope: HTTP SSE streaming dan penyimpanan sesi percakapan.

## Step 4: Engine AI Chat, orkestrasi tool calling, streaming SSE, dan CRUD API (Owner-only)

Buat `app/services/ai_chat_service.py` dan router `app/api/ai_chat.py` (didaftarkan di `app/api/router.py`) dengan prefix `/api/v1/ai-chat` dan proteksi `Depends(require_admin_role)`: `GET /models`, CRUD `/sessions`, dan `POST /sessions/{id}/messages/stream` (`text/event-stream` dengan event `tool_start`, `tool_end`, `delta`, `done`, `error`). Selesaikan pemilihan provider (`classai` atau `sumopod`) dan model per request, batasi konteks ke 8 pesan terakhir, batasi loop tool calling maksimal 5 iterasi, dan sediakan fallback aman jika model tidak mendukung native tool calling.

- Acceptance: Endpoint `/api/v1/ai-chat/*` menolak role non-admin dengan HTTP 403; pengujian SSE memverifikasi urutan event `tool_start`, `tool_end`, `delta`, `done` dan persistensi pesan + `tool_calls_json` ke DB; kegagalan upstream mengembalikan event `error` terkendali tanpa crash.
- Out of scope: Komponen UI frontend dan tampilan popup chat.

## Step 5: UI konfigurasi provider ClassAI, Sumopod, dan daftar model chatbot di Pengaturan

Perbarui `frontend/src/types/index.ts` dan `frontend/src/components/config/ConfigTab.tsx` pada bagian pengaturan AI agar Owner dapat mengelola API key (write-only), URL endpoint, model default untuk ClassAI dan Sumopod, pilihan default provider/model AI Chat, serta daftar model yang tersedia di dropdown chat.

- Acceptance: Form pengaturan AI menampilkan status konfigurasi ClassAI dan Sumopod tanpa membocorkan secret, menyimpan perubahan ke `PUT /api/v1/config` dengan umpan balik toast, dan `npm run build` di `frontend/` lulus tanpa error TypeScript.
- Out of scope: Komponen popup chat `blocks-so/ai-05` dan halaman `/ai-chat`.

## Step 6: Primitives `ai-elements` (adaptasi `blocks-so/ai-05` React 18 + Tailwind v3) dan SSE client

Tambahkan `react-markdown` dan `remark-gfm` di `frontend/package.json`, buat client `frontend/src/lib/aiChatApi.ts` (REST + `fetch` SSE dengan `credentials: "include"`, header `X-CSRF-Token` dari cookie `catpen_csrf`, dan `AbortController`), serta bangun primitives `frontend/src/components/ai-elements/conversation.tsx`, `message.tsx`, dan `prompt-input.tsx` yang mengadaptasi struktur `blocks-so/ai-05` agar native untuk React 18, Tailwind v3, dark mode, dan tabel Markdown keuangan.

- Acceptance: `Conversation`, `Message`, `MessageResponse` (GFM table + numeric alignment), dan `PromptInput` (textarea, footer tools, submit/stop state) terkompilasi bersih di TypeScript/Vite; SSE parser menangani chunk parsial, `tool_start`/`tool_end`/`delta`/`done`/`error`, dan pembatalan via `AbortController`.
- Out of scope: Integrasi routing `/ai-chat` dan navigasi sidebar.

## Step 7: Popup Chat (`blocks-so/ai-05`) dan halaman layar penuh `/ai-chat` (Owner-only)

Implementasikan `frontend/src/components/ai-chat/AiChatPanel.tsx`, `AiChatWidget.tsx` (floating popup pojok kanan bawah), dan `AiChatFullPage.tsx` (layout 2 kolom riwayat sesi + canvas chat), lalu integrasikan ke `frontend/src/App.tsx` dan `frontend/src/components/dashboard-01/dashboard-sidebar.tsx` khusus `userRole === "admin"`. Sertakan sinkronisasi sesi aktif antara popup dan `/ai-chat`, dropdown pemilih provider/model (`ClassAI` / `Sumopod`) di `PromptInputFooter`, 4 quick prompt chips, indikator tool call, tombol Stop, aksesibilitas keyboard (`Escape`, `Enter`/`Shift+Enter`, focus ring), serta empty/loading/error state, dark mode, dan responsif mobile.

- Acceptance: Widget popup dan menu `/ai-chat` hanya tampil untuk role `admin`; transisi popup ke `/ai-chat` mempertahankan sesi aktif; pergantian model di footer terkirim ke request stream berikutnya; layout responsif di mobile/desktop dan dark/light mode tanpa overflow horizontal.
- Out of scope: Chart visualisasi interaktif di dalam bubble chat dan akses role non-owner.

## Step 8: Verifikasi end-to-end, uji RBAC, build check, dan validasi regresi

Jalankan seluruh test suite backend (`pytest`), verifikasi migrasi Alembic, jalankan build frontend (`npm run build`), dan lakukan uji alur end-to-end mencakup login Owner vs non-Owner (RBAC 403), pemilihan provider ClassAI vs Sumopod, streaming SSE dengan tool calling, riwayat sesi persisten lintas refresh, serta pengecekan console error dan responsivitas.

- Acceptance: Seluruh `pytest` backend lulus tanpa regresi; `cd frontend && npm run build` lulus dengan 0 error; verifikasi RBAC, SSE streaming, dark/light mode, dan mobile viewport terdokumentasi bebas error console.
- Out of scope: Penambahan fitur baru di luar cakupan AI Chat fase 1.
