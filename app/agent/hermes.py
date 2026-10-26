"""
app/agent/hermes.py — Hermes Agent Orchestrator
Otak utama: menerima context, memilih tools, menjalankan chain, dan membalas
"""
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.agent.intent import Intent, classify_intent
from app.agent.memory import get_user_context, update_user_context, add_conversation_turn
from app.agent import tools
from app.bot import telegram_client as tg
from app.utils.formatters import (
    fmt_rupiah,
    fmt_date_id,
    fmt_datetime_id,
    fmt_qty,
    escape_markdown,
    build_items_summary,
    build_progress_text,
    build_expense_action_keyboard,
)
from app.config import settings

logger = logging.getLogger(__name__)


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

        elif intent == Intent.CMD_HUTANG:
            await self._handle_hutang()

        elif intent == Intent.CMD_REIMBURSE:
            await self._handle_reimburse()

        elif intent == Intent.QUERY_TREND:
            await self._handle_trend()

        elif intent == Intent.CMD_HARGA or intent == Intent.QUERY_PRICE:
            keyword = param.strip() if param else text
            await self._handle_price_search(keyword)

        elif intent == Intent.CMD_AUDIT_HITUNG:
            await self._handle_audit_hitung()

        elif intent == Intent.CMD_AUDIT:
            await self._handle_audit_kategori()

        elif intent == Intent.CMD_ANALISIS:
            await self._handle_ai_analysis()

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

        try:
            if "/tukercash" in caption.lower():
                caption += f" (Input oleh: {sender_name})"

            await tg.update_progress(self.chat_id, msg_id, 1, "Mengunduh gambar...")
            await tg.update_progress(self.chat_id, msg_id, 2, "Menganalisis struk via AI...")
            extracted = await tools.tool_extract_image(base64_img, caption)

            if extracted.get("error") or not extracted.get("items"):
                err_msg = extracted.get("message") or "❌ Gagal membaca struk. Coba foto lebih jelas."
                if not err_msg.startswith("❌"):
                    err_msg = f"❌ {err_msg}"
                keyboard = {"inline_keyboard": [[{"text": "🔄 Coba Lagi", "callback_data": "retry_scan"}]]}
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, err_msg, keyboard)
                return

            await tg.update_progress(self.chat_id, msg_id, 3, "Mengecek duplikasi data...")
            duplicate_matches = await tools.tool_find_duplicates(self.db, extracted["items"])
            if duplicate_matches:
                await self._send_duplicate_warning(msg_id, extracted["items"], msg_link, duplicate_matches=duplicate_matches)
                return

            await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
            saved = await tools.tool_save_expenses(
                self.db, extracted["items"], msg_link, self.user_id, actor=f"telegram:{self.user_id}"
            )
            if not saved:
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, "❌ Tidak ada pengeluaran valid untuk disimpan (nominal tidak boleh Rp 0 atau minus).")
                return

            # Buat balasan dengan insight
            await self._send_save_success(msg_id, extracted["items"], extracted.get("items", []), saved_expenses=saved)

            # Update memory dengan items yang baru disimpan
            item_names = [i.get("barang", "") for i in extracted["items"]]
            await update_user_context(self.db, self.user_id, {
                "last_items": item_names,
                "last_supplier": extracted["items"][0].get("toko_supplier") if extracted["items"] else None,
            })
        except Exception as e:
            logger.exception("Error in _handle_receipt: %s", e)
            if msg_id:
                await tg.edit_message(
                    self.chat_id,
                    msg_id,
                    "❌ *Terjadi kendala saat memproses struk.*\nSilakan coba lagi beberapa saat lagi.",
                )
            raise

    async def _handle_voice(self, base64_audio: str | None, msg_link: str) -> None:
        """Handle voice note — transcribe → extract → save."""
        if not base64_audio:
            await tg.send_message(self.chat_id, "❌ Gagal mengunduh audio.", self.thread_id)
            return

        sent = await tg.send_message(
            self.chat_id, build_progress_text(0, "Memulai..."), self.thread_id
        )
        msg_id = sent["result"]["message_id"] if sent else None

        try:
            await tg.update_progress(self.chat_id, msg_id, 1, "Mengunduh audio...")
            await tg.update_progress(self.chat_id, msg_id, 2, "Transkripsi via AI...")
            extracted = await tools.tool_extract_voice(base64_audio)

            if extracted.get("error") or not extracted.get("items"):
                err_msg = extracted.get("message") or "❌ Gagal memproses suara."
                if not err_msg.startswith("❌"):
                    err_msg = f"❌ {err_msg}"
                keyboard = {"inline_keyboard": [[{"text": "🔄 Coba Lagi", "callback_data": "retry_scan"}]]}
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, err_msg, keyboard)
                return

            await tg.update_progress(self.chat_id, msg_id, 3, "Mengecek duplikasi...")
            duplicate_matches = await tools.tool_find_duplicates(self.db, extracted["items"])
            if duplicate_matches:
                await self._send_duplicate_warning(msg_id, extracted["items"], msg_link, duplicate_matches=duplicate_matches)
                return

            await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
            saved = await tools.tool_save_expenses(
                self.db, extracted["items"], msg_link, self.user_id, actor=f"telegram:{self.user_id}"
            )
            if not saved:
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, "❌ Tidak ada pengeluaran valid untuk disimpan (nominal tidak boleh Rp 0 atau minus).")
                return
            await self._send_save_success(msg_id, extracted["items"], saved_expenses=saved)
        except Exception as e:
            logger.exception("Error in _handle_voice: %s", e)
            if msg_id:
                await tg.edit_message(
                    self.chat_id,
                    msg_id,
                    "❌ *Terjadi kendala saat memproses rekaman suara.*\nSilakan coba lagi beberapa saat lagi.",
                )
            raise

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

        try:
            await tg.update_progress(self.chat_id, msg_id, 2, "Menganalisis teks via AI...")
            extracted = await tools.tool_extract_text(text)

            if extracted.get("error") or not extracted.get("items"):
                err_msg = extracted.get("message") or "❌ Gagal memproses teks. Coba format ulang."
                if not err_msg.startswith("❌"):
                    err_msg = f"❌ {err_msg}"
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, err_msg)
                return

            await tg.update_progress(self.chat_id, msg_id, 3, "Mengecek duplikasi...")
            duplicate_matches = await tools.tool_find_duplicates(self.db, extracted["items"])
            if duplicate_matches:
                await self._send_duplicate_warning(msg_id, extracted["items"], msg_link, duplicate_matches=duplicate_matches)
                return

            await tg.update_progress(self.chat_id, msg_id, 4, "Menyimpan ke database...")
            saved = await tools.tool_save_expenses(
                self.db, extracted["items"], msg_link, self.user_id, actor=f"telegram:{self.user_id}"
            )
            if not saved:
                if msg_id:
                    await tg.edit_message(self.chat_id, msg_id, "❌ Tidak ada pengeluaran valid untuk disimpan (nominal tidak boleh Rp 0 atau minus).")
                return
            await self._send_save_success(msg_id, extracted["items"], saved_expenses=saved)
        except Exception as e:
            logger.exception("Error in _handle_text_input: %s", e)
            if msg_id:
                await tg.edit_message(
                    self.chat_id,
                    msg_id,
                    "❌ *Terjadi kendala saat memproses teks belanja.*",
                )
            raise

    async def _handle_report(self) -> None:
        """Generate dan kirim laporan bulanan."""
        now = datetime.now()
        report = await tools.tool_get_report(self.db, now.year, now.month)

        # Format nama bulan
        MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
                  "Juli","Agustus","September","Oktober","November","Desember"]
        bulan = MONTHS[report["month"] - 1]

        msg = f"📊 *REKAP {bulan.upper()} {report['year']}*\n\n"
        msg += f"💰 *Lunas: {fmt_rupiah(report['total_lunas'])}*\n"

        from app.services.budget_service import get_effective_budget
        eff_budget_data = await get_effective_budget(self.db, report["year"], report["month"])
        cat_budgets = eff_budget_data.get("category_amounts", {})
        eff_budget = float(eff_budget_data.get("total_budget", 0))

        if eff_budget > 0:
            total_all = float(report["total_lunas"]) + sum(
                h.get("nominal", 0) for h in report.get("list_hutang", [])
            )
            pct = round((total_all / eff_budget) * 100.0, 1)
            icon_b = "🔴" if pct >= 95 else ("🟡" if pct >= 75 else "🟢")
            msg += (
                f"🎯 *Anggaran Total: {icon_b} {pct}%* "
                f"({fmt_rupiah(total_all)} / {fmt_rupiah(eff_budget)})\n"
            )

        msg += "\n📂 *Breakdown Kategori:*\n"

        for kat, total in sorted(report["per_kategori"].items(), key=lambda x: -x[1]):
            cat_limit = cat_budgets.get(kat, 0)
            if cat_limit > 0:
                cpct = round((total / cat_limit) * 100.0, 1)
                cicon = "🔴" if cpct >= 95 else ("🟡" if cpct >= 75 else "🟢")
                msg += f"▪️ {kat}: {fmt_rupiah(total)} / {fmt_rupiah(cat_limit)} ({cicon} {cpct}%)\n"
            else:
                msg += f"▪️ {kat}: {fmt_rupiah(total)}\n"

        if report["list_hutang"]:
            msg += "\n⚠️ *Tagihan Belum Lunas:*\n"
            for h in report["list_hutang"]:
                msg += f"• *{h['barang']}* — {fmt_rupiah(h['nominal'])} (Tempo: {h['tempo']})\n"

        keyboard = {
            "inline_keyboard": [[
                {"text": "📊 Buka Dashboard", "url": settings.public_dashboard_url}
            ]]
        }
        await tg.send_message(self.chat_id, msg, self.thread_id, keyboard)

    async def _handle_hutang(self) -> None:
        """Tampilkan semua tagihan Belum Lunas beserta tombol inline pelunasan cepat."""
        from sqlalchemy import select, or_
        from app.models.expense import Expense

        result = await self.db.execute(
            select(Expense)
            .where(
                or_(
                    Expense.pay_status.ilike("%belum%"),
                    Expense.pay_status.ilike("%hutang%"),
                    Expense.pay_status.ilike("%tempo%"),
                )
            )
            .order_by(Expense.expense_date.asc(), Expense.id.asc())
        )
        unpaid_list = list(result.scalars().all())
        if not unpaid_list:
            await tg.send_message(
                self.chat_id,
                "✅ *Semua Tagihan Lunas!*\nTidak ada catatan hutang/tempo yang tertunda saat ini.",
                self.thread_id,
            )
            return

        total_hutang = sum(float(e.total_price or 0) for e in unpaid_list)
        today_str = datetime.now().date().isoformat()
        msg = (
            f"💳 *DAFTAR TAGIHAN BELUM LUNAS*\n"
            f"Total: *{len(unpaid_list)} tagihan ({fmt_rupiah(total_hutang)})*\n\n"
        )

        inline_rows = []
        for idx, e in enumerate(unpaid_list[:8], start=1):
            nominal = fmt_rupiah(float(e.total_price or 0))
            sup = f" ({escape_markdown(e.supplier)})" if e.supplier and e.supplier != "-" else ""
            tempo = ""
            if "cod" in (e.pay_method or "").lower() or "cod" in (e.notes or "").lower():
                tempo = " 📦 _(COD Kasir)_"
            elif e.due_date and e.due_date != "-":
                tempo = f" 🚨 *Tempo: {e.due_date}*" if e.due_date <= today_str else f" _(Tempo: {e.due_date})_"
            msg += f"{idx}. *#{e.id} {escape_markdown(e.item_name)}*{sup} — {nominal}{tempo}\n"
            inline_rows.append([
                {
                    "text": f"✅ Tandai Lunas #{e.id} ({e.item_name[:18]})",
                    "callback_data": f"mark_paid:{e.id}",
                }
            ])

        if len(unpaid_list) > 8:
            msg += f"\n_...dan {len(unpaid_list) - 8} tagihan lainnya di Dashboard._\n"

        inline_rows.append([
            {"text": "🌐 Buka Dashboard", "url": settings.public_dashboard_url}
        ])
        await tg.send_message(
            self.chat_id,
            msg,
            self.thread_id,
            {"inline_keyboard": inline_rows},
        )

    async def _handle_reimburse(self) -> None:
        """Review talangan: admin melihat semua user (dengan tombol ganti), user biasa hanya miliknya."""
        from app.models.user import User
        from app.services.expense_service import (
            get_outstanding_reimbursements,
            group_reimbursements_by_user,
        )
        from app.bot.reimburse import build_admin_review, build_user_review

        user = await self.db.get(User, self.user_id) if self.user_id else None
        is_admin = bool(user and settings.is_admin_telegram(user.telegram_id))

        if is_admin:
            items = await get_outstanding_reimbursements(self.db)
            groups = await group_reimbursements_by_user(self.db, items)
            text, keyboard = build_admin_review(groups)
        else:
            items = await get_outstanding_reimbursements(self.db, user_id=self.user_id)
            groups = await group_reimbursements_by_user(self.db, items)
            text, keyboard = build_user_review(groups[0] if groups else None)

        await tg.send_message(self.chat_id, text, self.thread_id, keyboard)

    async def _handle_trend(self) -> None:
        """Bandingkan tren pengeluaran bulan ini vs bulan lalu."""
        now = datetime.now()
        cur_report = await tools.tool_get_report(self.db, now.year, now.month)
        if now.month == 1:
            prev_m, prev_y = 12, now.year - 1
        else:
            prev_m, prev_y = now.month - 1, now.year
        prev_report = await tools.tool_get_report(self.db, prev_y, prev_m)

        MONTHS = ["Januari","Februari","Maret","April","Mei","Juni",
                  "Juli","Agustus","September","Oktober","November","Desember"]
        cur_name = MONTHS[now.month - 1]
        prev_name = MONTHS[prev_m - 1]

        cur_total = float(cur_report["total_lunas"])
        prev_total = float(prev_report["total_lunas"])

        msg = f"📈 *TREN PENGELUARAN ({cur_name.upper()} vs {prev_name.upper()})*\n\n"
        msg += f"• *{cur_name} {now.year}:* {fmt_rupiah(cur_total)}\n"
        msg += f"• *{prev_name} {prev_y}:* {fmt_rupiah(prev_total)}\n\n"

        if prev_total > 0:
            diff = cur_total - prev_total
            pct = round((diff / prev_total) * 100.0, 1)
            arah = f"🔴 Naik +{pct}%" if diff > 0 else f"🟢 Turun {pct}%"
            msg += f"📊 *Perubahan MoM:* {arah} ({fmt_rupiah(abs(diff))})\n"
        else:
            msg += "_Belum ada data pembanding di bulan sebelumnya._\n"

        await tg.send_message(self.chat_id, msg, self.thread_id)

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

    async def _handle_ai_analysis(self, force_refresh: bool = False) -> None:
        """Evaluasi keuangan mendalam menggunakan AI Financial Analysis."""
        from app.services.ai_analysis_service import generate_ai_analysis

        sent = await tg.send_message(
            self.chat_id,
            "🤖 *Menganalisis Keuangan via AI...*\n_Menghitung serapan anggaran, tren pengeluaran, dan anomali harga..._",
            self.thread_id,
        )
        msg_id = sent["result"]["message_id"] if sent else None

        now = datetime.now()
        analysis = await generate_ai_analysis(self.db, now.year, now.month, force_refresh=force_refresh)

        status_icon = "🟢" if analysis["health_status"] == "SEHAT" else ("🟡" if analysis["health_status"] == "PERLU_PERHATIAN" else "🔴")
        status_label = analysis["health_status"].replace("_", " ")

        msg = (
            f"🤖 *ANALISIS KEUANGAN AI HISTORYCAKE*\n"
            f"📅 Periode: *{analysis['month_name']} {analysis['year']}*\n"
            f"Status: {status_icon} *{status_label}* (Skor: {analysis['health_score']}/100)\n\n"
            f"📌 *Ringkasan Eksekutif:*\n{analysis['summary']}\n\n"
        )

        if analysis.get("key_insights"):
            msg += "💡 *Insight Kunci:*\n"
            for item in analysis["key_insights"][:3]:
                msg += f"• {item}\n"
            msg += "\n"

        if analysis.get("price_alerts"):
            msg += "⚠️ *Dinamika & Lonjakan Harga:*\n"
            for alert in analysis["price_alerts"][:2]:
                msg += f"• {alert}\n"
            msg += "\n"

        if analysis.get("actionable_recommendations"):
            msg += "🎯 *Rekomendasi Aksi:*\n"
            for idx, rec in enumerate(analysis["actionable_recommendations"][:3], 1):
                msg += f"{idx}. {rec}\n"

        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "🔄 Refresh Analisis", "callback_data": "refresh_ai_analysis"},
                    {"text": "📊 Rekap Angka", "callback_data": "menu_rekap"},
                ],
                [
                    {"text": "🌐 Buka Dashboard Lengkap", "url": settings.public_dashboard_url},
                ],
            ]
        }

        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, msg, keyboard)
        else:
            await tg.send_message(self.chat_id, msg, self.thread_id, keyboard)

    async def _handle_menu(self) -> None:
        """Tampilkan menu utama."""
        menu_text = (
            "📋 *MENU UTAMA*\n\n"
            "🤖 /analisis - Analisis keuangan pintar AI\n"
            "📊 /rekap - Laporan bulan ini\n"
            "💳 /hutang - Cek & lunasi tagihan\n"
            "💼 /reimburse - Review talangan (reimburse)\n"
            "🔍 /harga [nama] - Cari harga terakhir\n"
            "✏️ /catat [detail] - Catat belanja teks\n"
            "🔎 /audit - Cek kategori data\n"
            "🔢 /audit hitung - Fix perhitungan\n\n"
            "💡 Atau langsung kirim *foto struk* / *voice note*!"
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "🤖 Analisis AI", "callback_data": "menu_analisis"},
                    {"text": "📊 Rekap", "callback_data": "menu_rekap"},
                    {"text": "💳 Tagihan", "callback_data": "menu_hutang"},
                ],
                [
                    {"text": "🔎 Audit", "callback_data": "menu_audit"},
                    {"text": "💡 Bantuan", "callback_data": "menu_bantuan"},
                    {"text": "🌐 Dashboard", "url": settings.public_dashboard_url},
                ],
            ]
        }
        await tg.send_message(self.chat_id, menu_text, self.thread_id, keyboard)

    async def _handle_config(self) -> None:
        """Tampilkan konfigurasi aktif."""
        msg = (
            f"⚙️ *Konfigurasi Aktif:*\n"
            f"- AI Ekstraksi Struk: *Sumopod AI* (`{settings.sumopod_model}`)\n"
            f"- AI Analisis Keuangan: *ClassAI / DeepSeek* (`{settings.ai_analysis_model}`)\n"
            f"- Database: *PostgreSQL / SQLite*\n"
            f"- Sheets Sync: *{'Aktif' if settings.spreadsheet_id else 'Nonaktif'}*"
        )
        await tg.send_message(self.chat_id, msg, self.thread_id)

    # ──────────────────────────────────────────────
    # Helper: Build duplicate warning & save success message
    # ──────────────────────────────────────────────

    async def _send_duplicate_warning(
        self,
        msg_id: int | None,
        items: list[dict],
        msg_link: str,
        duplicate_matches: list[dict] | None = None,
    ) -> None:
        """Kirim peringatan duplikat dengan penjelasan lengkap data pembanding di database dan waktu pencatatannya."""
        await update_user_context(self.db, self.user_id, {
            "pending_duplicate": {
                "items": items,
                "msg_link": msg_link,
            }
        })

        total_new = sum(
            float(itm.get("total_harga") if itm.get("total_harga") is not None else (itm.get("total_price") or 0))
            for itm in items
        )

        match_lines = []
        if duplicate_matches:
            for i, m in enumerate(duplicate_matches[:5], 1):
                new_itm = m.get("new_item", {})
                existing = m.get("existing_expense")
                new_nm = escape_markdown(new_itm.get("barang") or new_itm.get("item_name") or "Item")
                new_qty = fmt_qty(new_itm.get("qty") or new_itm.get("jumlah") or 1)
                new_sat = escape_markdown((new_itm.get("satuan") or new_itm.get("unit") or "Pcs").strip())
                new_tot = float(new_itm.get("total_harga") if new_itm.get("total_harga") is not None else (new_itm.get("total_price") or 0))

                # Ambil info user penginput lama jika ada
                creator = "Web / Sistem"
                try:
                    if existing and getattr(existing, "user", None) and existing.user and existing.user.name:
                        creator = existing.user.name
                    elif existing and getattr(existing, "user_id", None):
                        creator = f"User #{existing.user_id}"
                except Exception:
                    if existing and getattr(existing, "user_id", None):
                        creator = f"User #{existing.user_id}"
                creator = escape_markdown(creator)

                exist_nm = escape_markdown(getattr(existing, "item_name", "-") if existing else "-")
                exist_sup = escape_markdown(getattr(existing, "supplier", "-") if existing else "-")
                exist_id = getattr(existing, "id", "-") if existing else "-"
                exist_date = fmt_date_id(getattr(existing, "expense_date", None)) if existing else "-"
                exist_created = fmt_datetime_id(getattr(existing, "created_at", None)) if existing else "-"
                exist_tot = fmt_rupiah(float(getattr(existing, "total_price", 0) or 0)) if existing else "-"

                match_lines.append(
                    f"*{i}. Data Baru: {new_nm}* ({new_qty} {new_sat} — {fmt_rupiah(new_tot)})\n"
                    f"   ↳ ⚠️ *Sama dengan Data:* ID `#{exist_id}` • *{exist_nm}* ({exist_sup})\n"
                    f"   ↳ 💰 *Nominal Lama:* {exist_tot}\n"
                    f"   ↳ 📅 *Tanggal Transaksi:* {exist_date}\n"
                    f"   ↳ 🕒 *Waktu Dicatat:* {exist_created} (oleh {creator})"
                )

            if len(duplicate_matches) > 5:
                match_lines.append(f"_...dan {len(duplicate_matches) - 5} item duplikat lainnya_")

        detail_match_str = "\n\n".join(match_lines) if match_lines else ""

        if not detail_match_str:
            item_lines = []
            for i, itm in enumerate(items[:5], 1):
                nm = escape_markdown(itm.get("barang") or "Item")
                qty = fmt_qty(itm.get("qty") or itm.get("jumlah") or 1)
                sat = escape_markdown(itm.get("satuan") or "")
                tot = float(itm.get("total_harga") or 0)
                item_lines.append(f"{i}. {nm} ({qty} {sat}) — {fmt_rupiah(tot)}")
            detail_match_str = "\n".join(item_lines)

        warn_msg = (
            "⚠️ *Double Input Terdeteksi!*\n\n"
            "Transaksi yang kamu kirim terdeteksi sudah pernah dicatat di database:\n\n"
            f"{detail_match_str}\n\n"
            f"💰 *Total Belanja Baru: {fmt_rupiah(total_new)}*\n\n"
            "_Jika transaksi ini memang pembelian baru yang terpisah, klik_ *Tetap Simpan* _di bawah._"
        )
        keyboard = {
            "inline_keyboard": [
                [
                    {"text": "✅ Tetap Simpan", "callback_data": "force_save_duplicate"},
                    {"text": "❌ Batalkan", "callback_data": "cancel_duplicate"},
                ]
            ]
        }
        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, warn_msg, keyboard)
        else:
            await tg.send_message(self.chat_id, warn_msg, self.thread_id, keyboard)

    async def _send_save_success(
        self,
        msg_id: int | None,
        items: list[dict],
        original_items: list[dict] | None = None,
        saved_expenses: list | None = None,
    ) -> None:
        """
        Kirim/edit pesan sukses + tambah insight dari Hermes
        (cek harga historis, komentar kontekstual, dll) + tombol aksi cepat.
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

        # Status reimbursement & pembayaran
        is_reimb = any(getattr(e, "is_reimbursement", False) for e in (saved_expenses or []))
        is_paid = not any(
            str(getattr(e, "pay_status", "Lunas") or "Lunas").lower() in ("belum lunas", "hutang", "tempo")
            for e in (saved_expenses or [])
        )
        is_cod = any(
            "cod" in str(getattr(e, "pay_method", "") or "").lower()
            or "cod" in str(getattr(e, "notes", "") or "").lower()
            for e in (saved_expenses or [])
        )
        if is_paid:
            pay_label = "✅ Lunas"
        elif is_cod:
            pay_label = "⏳ Belum Lunas (COD - Bayar di Kasir)"
        else:
            pay_label = "⏳ Belum Lunas (Hutang)"
        reimb_label = "💼 Ya (Ditalangi)" if is_reimb else "🏷️ Tidak (Reguler)"

        success_msg = (
            f"✅ *Berhasil Disimpan! ({len(items)} Item)*\n\n"
            f"📝 *Rincian:*\n{item_list_str}\n\n"
            f"💰 *Total: {fmt_rupiah(total)}*\n"
            f"💳 *Status Bayar:* {pay_label}\n"
            f"💼 *Status Reimburse:* {reimb_label}\n\n"
            f"_Data telah masuk ke database._"
            f"{insight}"
        )

        # Susun tombol aksi cepat (Undo, Set Belum Lunas, Reimbursement) jika ID tersedia
        saved_ids = [
            str(e.id) for e in (saved_expenses or [])[:10] if getattr(e, "id", None) is not None
        ]
        ids_str = ",".join(saved_ids)
        keyboard = build_expense_action_keyboard(
            ids_str,
            is_paid=is_paid,
            is_reimb=is_reimb,
            dashboard_url=settings.public_dashboard_url,
        )

        if msg_id:
            await tg.edit_message(self.chat_id, msg_id, success_msg, keyboard)
        else:
            await tg.send_message(self.chat_id, success_msg, self.thread_id, keyboard)

        # Simpan ke memory
        await add_conversation_turn(self.db, self.user_id, "assistant", success_msg[:300])
