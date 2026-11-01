# CatatanPengeluaran — AI Harness & Operational Rules

Dokumen ini adalah **single source of truth** bagi setiap AI agent yang bekerja pada codebase `CatatanPengeluaran`.
Tujuan utama dokumen ini adalah **menghilangkan delusi AI**, menjamin determinisme arsitektur, dan mematuhi workflow operasional yang ketat.

---

## 1. Prinsip Utama Anti-Delusi (Ground Truth Protocol)

1. **No Hallucination / No Guessing (Fakta Di Atas Asumsi)**:
   - Dilarang mengarang fungsi, skema database, environment variables, endpoint, atau parameter yang tidak ada di codebase.
   - Sebelum memodifikasi atau menggunakan modul, **wajib baca file asli** (`app/agent/hermes.py`, `app/models/*`, `app/services/*`, dsb.).
2. **Deterministic Contract**:
   - Setiap tool dan fungsi harus memiliki type hints eksplisit, validasi input (Pydantic / schemas), dan output yang terdefinisi.
3. **No File/CSS Patching via Scripts (R-33)**:
   - Dilarang membuat script Python/Bash temporer yang melakukan `str.replace` atau patching file. Edit langsung file source secara terstruktur.
4. **Verified Execution (R-35)**:
   - Sebelum menyatakan pekerjaan selesai, jalankan linter atau test suite terkait (`pytest`, verifikasi import, atau syntax check).

---

## 2. Arsitektur AI Agent (Hermes Orchestrator)

Project ini memiliki built-in bot/agent bernama **Hermes**:
- **Entry Point & Router**: [`app/agent/hermes.py`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/app/agent/hermes.py)
- **Intent Classifier**: [`app/agent/intent.py`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/app/agent/intent.py)
- **Session Memory (Postgres)**: [`app/agent/memory.py`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/app/agent/memory.py) (`ConversationSession`)
- **Tools Execution Layer**: [`app/agent/tools.py`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/app/agent/tools.py)

### Aturan Siklus Hidup Hermes Agent:
1. **Receive**: Terima pesan (Text, Photo/Struk, Audio/Voice).
2. **Intent Classification**: Klasifikasi melalui regex command terlebih dahulu, lalu AI classification jika natural language.
3. **Context Retrieval**: Ambil conversation context dari tabel `sessions` melalui `get_user_context`.
4. **Tool Execution**:
   - Selalu lewat tahap sanitasi: `audit_calculations()` dan `validate_non_zero_expenses()`.
   - Simpan audit trail dengan `actor="user"` atau `actor="system"`.
5. **Context Update**: Update turn & pending state melalui `update_user_context()`.
6. **Dispatch Response**: Format output menggunakan formatter lokal di [`app/utils/formatters.py`](file:///Users/taufik/Documents/Historycake/HCTeams/CatatanPengeluaran/app/utils/formatters.py).

---

## 3. Agent Harness Standards (`/agent-harness-construction`)

Sesuai spesifikasi harness AI engineering:

### A. Action Space Design
- Tool name harus stabil, eksplisit, dan berorientasi aksi (e.g., `tool_extract_text`, `tool_save_expenses`, `tool_audit_calculations`).
- Skema input terstruktur, sempit, dan terisolasi. Hindari catch-all parameter.
- Tool berisiko tinggi (hapus database, migrasi schema, bulk overwrite) wajib melalui konfirmasi state (`pending_action`).

### B. Observation Contract
Setiap respon tools internal harus menghasilkan observation shape yang deterministik:
- `status`: `success` | `warning` | `error`
- `summary`: ringkasan aksi satu baris
- `data` / `artifacts`: data hasil pemrosesan atau file/ID terkait
- `next_actions`: rekomendasi atau langkah selanjutnya untuk user

### C. Error Recovery & Boundary
- Tangani error secara eksplisit tanpa crash senyap (silent fail).
- Tampilkan root cause hint yang jelas dan instruksi koreksi yang aman kepada pengguna.
- Batasi conversation turn (maksimal 5 history turn di context) untuk mencegah context bloat dan memory drift.

---

## 4. Standar Database & Migrasi

1. Database engine: **PostgreSQL** (Async via SQLAlchemy + Asyncpg) & SQLite untuk local scratch/test.
2. Setiap perubahan skema model pada `app/models/`:
   - Wajib dibuatkan migrasi Alembic: `alembic revision --autogenerate -m "pesan"`
   - Dilarang mengeksekusi raw DDL di runtime service tanpa melalui Alembic migration.
3. Selalu periksa relasi foreign key dan enum constraint sebelum melakukan commit.

---

## 5. Standar Frontend & UI (Anti-Slop Integration)

Untuk pekerjaan frontend (di direktori `frontend/`):
- Patuhi aturan Anti-Slop (Mode: `during`).
- Tidak menggunakan mockup generic atau komponen tanpa fungsi (R-26).
- Sediakan state lengkap: Loading, Error, Empty State (R-27).
- Kontras warna wajib memenuhi standar WCAG AA (R-25).
- Aksesibilitas keyboard dan mobile responsiveness (R-03, R-32).

---

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read `antislop.md` (core) and then the skill for the task:
- UI / visual: `skills/antislop-ui/SKILL.md`
- Copy & text: `skills/antislop-copywriting/SKILL.md`
- People: `skills/antislop-human/SKILL.md`
- Mobile / responsive: `skills/antislop-layoutmobile/SKILL.md`
- Code comments: `skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: download `antislop.md` again, or run `npx antislop-ai --update` if it was installed as skill folders.
<!-- antislop:end -->
