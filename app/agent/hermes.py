"""
app/agent/hermes.py — Hermes Agent Orchestrator
Otak utama: menerima context, memilih tools, menjalankan chain, dan membalas
"""
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.agent.intent import Intent, classify_intent
from app.agent.memory import get_user_context, update_user_context, add_conversation_turn
from app.agent import tools
from app.bot import telegram_client as tg
from app.utils.formatters import fmt_rupiah, fmt_date_id, build_items_summary, build_progress_text
from app.config import settings


class HermesAgent:
    """
    Hermes: Full Agentic Orchestrator untuk CatatanPengeluaran.
    
    Cara kerja:
    1. Terima pesan dari user
    2. Classify intent
    3. Ambil user memory/context
    4. Pilih & jalankan tool chain
    5. Enrich response dengan insight dari context
    6. Update memory
    7. Kirim balasan ke Telegram
    """

    def __init__(self, db: AsyncSession, user_id: int, chat_id: int, thread_id: int | None):
        self.db = db
        self.user_id = user_id
        self.chat_id = chat_id
        self.thread_id = thread_id

    # ──────────────────────────────────────────────
    # Entry point utama
    # ──────────────────────────────────────────────

    async def process(
        self,
        text: str = "",
        has_photo: bool = False,
        has_voice: bool = False,
        photo_base64: str | None = None,
        voice_base64: str | None = None,
        caption: str = "",
        msg_link: str = "Private Chat",
        sender_name: str = "",
    ) -> None:
        """Proses pesan dari user dan kirim balasan ke Telegram."""

        intent, param = classify_intent(text, has_photo, has_voice)
        ctx = await get_user_context(self.db, self.user_id)

        # Simpan turn user ke memory
        await add_conversation_turn(self.db, self.user_id, "user", text or "[media]")

        # Route ke handler yang sesuai
        if intent == Intent.SCAN_RECEIPT:
            await self._handle_receipt(photo_base64, caption, msg_link, sender_name)

        elif intent == Intent.VOICE_INPUT:
            await self._handle_voice(voice_base64, msg_link)

        elif intent in (Intent.CMD_CATAT, Intent.TEXT_INPUT):
            await self._handle_text_input(param or text, msg_link)

        elif intent == Intent.CMD_REKAP or intent == Intent.QUERY_REPORT:
            await self._handle_report()

        elif intent == Intent.CMD_HARGA or intent == Intent.QUERY_PRICE:
            keyword = param.strip() if param else text
            await self._handle_price_search(keyword)

        elif intent == Intent.CMD_AUDIT_HITUNG:
            await self._handle_audit_hitung()

        elif intent == Intent.CMD_AUDIT:
            await self._handle_audit_kategori()

        elif intent == Intent.CMD_MENU:
            await self._handle_menu()

        elif intent == Intent.CMD_CONFIG:
            await self._handle_config()

        else:
            # Tidak dikenali → tunjukkan menu
            await self._handle_menu()

        # Update last intent di memory
        await update_user_context(self.db, self.user_id, {
            "last_intent": intent,
            "last_action_at": datetime.utcnow().isoformat(),
        })

    # ──────────────────────────────────────────────
    # Handlers
    # ──────────────────────────────────────────────

    async def _handle_receipt(
        self, base64_img: str | None, caption: str, msg_link: str, sender_name: str
    ) -> None:
        """Handle foto struk — extract → audit → check duplicate → save → insight."""
        if not base64_img:
            await tg.send_message(self.chat_id, "❌ Gagal mengunduh gambar.", self.thread_id)
            return

        # Kirim pesan progress awal
        sent = await tg.send_message(
            self.chat_id,
            build_progress_text(0, "Memulai..."),
            self.thread_id,
        )
        msg_id = sent["result"]["message_id"] if sent else None

        if "/tukercash" in caption.lower():
            caption += f" (Input oleh: {sender_name})"

        await tg.update_progress(self.chat_id, msg_id, 1, "Mengunduh gambar...")
        await tg.update_progress(self.chat_id, msg_id, 2, "Menganalisis struk via AI...")
        extracted = await tools.tool_extract_image(base64_img, caption)

        if extracted.get("error") or not extracted.get("items"):
            keyboard = {"inline_keyboard": [[{"text": "🔄 Coba Lagi", "callback_data": "retry_scan"}]]}
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, "❌ Gagal membaca struk. Coba foto lebih jelas.", keyboard)
            return

        await tg.update_progress(self.chat_id, msg_id, 3, "Mengecek duplikasi data...")
        if await tools.tool_check_duplicate(self.db, extracted["items"]):
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, "⚠️ *Double Input Terdeteksi!*\nTransaksi ini sudah pernah tercatat.")
            return

        await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
        await tools.tool_save_expenses(self.db, extracted["items"], msg_link, self.user_id)

        # Buat balasan dengan insight
        await self._send_save_success(msg_id, extracted["items"], extracted.get("items", []))

        # Update memory dengan items yang baru disimpan
        item_names = [i.get("barang", "") for i in extracted["items"]]
        await update_user_context(self.db, self.user_id, {
            "last_items": item_names,
            "last_supplier": extracted["items"][0].get("toko_supplier") if extracted["items"] else None,
        })

    async def _handle_voice(self, base64_audio: str | None, msg_link: str) -> None:
        """Handle voice note — transcribe → extract → save."""
        if not base64_audio:
            await tg.send_message(self.chat_id, "❌ Gagal mengunduh audio.", self.thread_id)
            return

        sent = await tg.send_message(
            self.chat_id, build_progress_text(0, "Memulai..."), self.thread_id
        )
        msg_id = sent["result"]["message_id"] if sent else None

        await tg.update_progress(self.chat_id, msg_id, 1, "Mengunduh audio...")
        await tg.update_progress(self.chat_id, msg_id, 2, "Transkripsi via AI...")
        extracted = await tools.tool_extract_voice(base64_audio)

        if extracted.get("error") or not extracted.get("items"):
            keyboard = {"inline_keyboard": [[{"text": "🔄 Coba Lagi", "callback_data": "retry_scan"}]]}
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, "❌ Gagal memproses suara.", keyboard)
            return

        await tg.update_progress(self.chat_id, msg_id, 3, "Mengecek duplikasi...")
        if await tools.tool_check_duplicate(self.db, extracted["items"]):
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, "⚠️ *Double Input Terdeteksi!*")
            return

        await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
        await tools.tool_save_expenses(self.db, extracted["items"], msg_link, self.user_id)
        await self._send_save_success(msg_id, extracted["items"])

    async def _handle_text_input(self, text: str, msg_link: str) -> None:
        """Handle input teks biasa atau /catat."""
        if not text:
            await tg.send_message(
                self.chat_id,
                "⚠️ *Format Salah!*\nGunakan: `/catat [detail belanja]`",
                self.thread_id,
            )
            return

        sent = await tg.send_message(
            self.chat_id, build_progress_text(0, "Memulai..."), self.thread_id
        )
        msg_id = sent["result"]["message_id"] if sent else None

        await tg.update_progress(self.chat_id, msg_id, 2, "Menganalisis teks via AI...")
        extracted = await tools.tool_extract_text(text)

        if extracted.get("error") or not extracted.get("items"):
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, "❌ Gagal memproses teks. Coba format ulang.")
            return

        await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
        await tools.tool_save_expenses(self.db, extracted["items"], msg_link, self.user_id)
        await self._send_save_success(msg_id, extracted["items"])

    async def _handle_report(self) -> None:
        """Generate dan kirim laporan bulanan."""
        now = datetime.now()
        report = await tools.tool_get_report(self.db, now.year, now.month)

        # Format nama bulan
        MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
                  "Juli","Agustus","September","Oktober","November","Desember"]
        bulan = MONTHS[report["month"] - 1]

        msg = f"📊 *REKAP {bulan.upper()} {report['year']}*\n\n"
        msg += f"💰 *Lunas: {fmt_rupiah(report['total_lunas'])}*\n\n"
        msg += "📂 *Breakdown Kategori:*\n"

        for kat, total in sorted(report["per_kategori"].items(), key=lambda x: -x[1]):
            msg += f"▪️ {kat}: {fmt_rupiah(total)}\n"

        if report["list_hutang"]:
            msg += "\n⚠️ *Tagihan Belum Lunas:*\n"
            for h in report["list_hutang"]:
                msg += f"• *{h['barang']}* — {fmt_rupiah(h['nominal'])} (Tempo: {h['tempo']})\n"

        keyboard = {
            "inline_keyboard": [[
                {"text": "📊 Buka Dashboard", "url": "http://localhost:8000/dashboard"}
            ]]
        }
        await tg.send_message(self.chat_id, msg, self.thread_id, keyboard)

    async def _handle_price_search(self, keyword: str) -> None:
        """Cari harga terakhir suatu barang."""
        if not keyword:
            await tg.send_message(self.chat_id, "⚠️ Masukkan nama bahan.\nContoh: `/harga tepung`", self.thread_id)
            return

        found = await tools.tool_search_price(self.db, keyword)
        if found:
            tgl = fmt_date_id(found.expense_date)
            msg = (
                f"✅ *Ditemukan!*\n"
                f"📦 {found.item_name}\n"
                f"💰 Satuan: {fmt_rupiah(float(found.unit_price))}\n"
                f"🏢 Toko: {found.supplier}\n"
                f"📅 Tanggal: {tgl}"
            )
        else:
            msg = f"❌ Barang *\"{keyword}\"* belum pernah tercatat."

        await tg.send_message(self.chat_id, msg, self.thread_id)

    async def _handle_audit_hitung(self) -> None:
        """Audit dan auto-fix perhitungan matematika di DB."""
        sent = await tg.send_message(
            self.chat_id,
            "⏳ *Memulai Audit & Auto-Fix...*\n_Mengecek dan memperbaiki rumus (Qty × Harga)..._",
            self.thread_id,
        )
        msg_id = sent["result"]["message_id"] if sent else None

        result = await tools.tool_audit_calculations(self.db)

        if result["fixed_count"] == 0:
            text = "✅ *Audit Selesai!*\nDatabase aman. Tidak ada perhitungan yang salah."
        else:
            lines = "\n".join(
                f"- Baris {f['id']}: {f['barang']} ({fmt_rupiah(f['lama'])} ➡️ {fmt_rupiah(f['baru'])})"
                for f in result["fixed_items"][:15]
            )
            text = f"✅ *Auto-Fix Selesai!*\nBerhasil mengoreksi *{result['fixed_count']} baris*:\n\n{lines}"

        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, text)

    async def _handle_audit_kategori(self) -> None:
        """Audit kategori tidak valid di DB."""
        sent = await tg.send_message(
            self.chat_id,
            "⏳ Memeriksa konsistensi kategori...",
            self.thread_id,
        )
        msg_id = sent["result"]["message_id"] if sent else None

        result = await tools.tool_audit_categories(self.db)

        if result["invalid_count"] == 0:
            text = "✅ *Audit Selesai!*\nSemua data menggunakan kategori baku."
        else:
            lines = "\n".join(
                f"- ID {i['id']}: {i['barang']} ({i['kategori']})"
                for i in result["invalid_items"][:15]
            )
            extra = f"\n\n_...dan {result['invalid_count'] - 15} lainnya._" if result["invalid_count"] > 15 else ""
            text = f"⚠️ *Ditemukan {result['invalid_count']} Kategori Tidak Baku:*\n\n{lines}{extra}"
            keyboard = {
                "inline_keyboard": [
                    [{"text": "🛠️ Auto-Fix dengan AI", "callback_data": "action_autofix"}],
                ]
            }
            if msg_id:
                await tg.edit_message(self.chat_id, msg_id, text, keyboard)
                return

        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, text)

    async def _handle_menu(self) -> None:
        """Tampilkan menu utama."""
        menu_text = (
            "📋 *MENU UTAMA*\n\n"
            "📊 /rekap — Laporan bulan ini\n"
            "🔍 /harga [nama] — Cari harga terakhir\n"
            "✏️ /catat [detail] — Catat belanja teks\n"
            "🔎 /audit — Cek kategori data\n"
            "🔢 /audit hitung — Fix perhitungan\n\n"
            "💡 Atau langsung kirim *foto struk* / *voice note*!"
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "📊 Rekap", "callback_data": "menu_rekap"},
                    {"text": "🔎 Audit", "callback_data": "menu_audit"},
                ],
                [
                    {"text": "💡 Bantuan", "callback_data": "menu_bantuan"},
                    {"text": "🌐 Dashboard", "url": "http://localhost:8000/dashboard"},
                ],
            ]
        }
        await tg.send_message(self.chat_id, menu_text, self.thread_id, keyboard)

    async def _handle_config(self) -> None:
        """Tampilkan konfigurasi aktif."""
        msg = (
            f"⚙️ *Konfigurasi Aktif:*\n"
            f"- Provider AI: *Sumopod AI*\n"
            f"- Model: `{settings.sumopod_model}`\n"
            f"- Database: *PostgreSQL*\n"
            f"- Sheets Sync: *{'Aktif' if settings.spreadsheet_id else 'Nonaktif'}*"
        )
        await tg.send_message(self.chat_id, msg, self.thread_id)

    # ──────────────────────────────────────────────
    # Helper: Build success message dengan Hermes insight
    # ──────────────────────────────────────────────

    async def _send_save_success(
        self,
        msg_id: int | None,
        items: list[dict],
        original_items: list[dict] | None = None,
    ) -> None:
        """
        Kirim/edit pesan sukses + tambah insight dari Hermes
        (cek harga historis, komentar kontekstual, dll).
        """
        item_list_str, total = build_items_summary(items)

        # Cari insight harga untuk item pertama (jika ada)
        insight = ""
        if items:
            first = items[0]
            keyword = first.get("barang", "")
            current_price = float(first.get("harga_satuan") or 0)
            if keyword and current_price > 0:
                insight_text = await tools.tool_get_price_insight(self.db, keyword, current_price)
                if insight_text:
                    insight = f"\n\n{insight_text}"

        success_msg = (
            f"✅ *Berhasil Disimpan! ({len(items)} Item)*\n\n"
            f"📝 *Rincian:*\n{item_list_str}\n\n"
            f"💰 *Total: {fmt_rupiah(total)}*\n\n"
            f"_Data telah masuk ke database._"
            f"{insight}"
        )

        keyboard = {
            "inline_keyboard": [[
                {"text": "🌐 Lihat Dashboard", "url": "http://localhost:8000/dashboard"}
            ]]
        }

        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, success_msg, keyboard)
        else:
            await tg.send_message(self.chat_id, success_msg, self.thread_id, keyboard)

        # Simpan ke memory
        await add_conversation_turn(self.db, self.user_id, "assistant", success_msg[:300])
