"""
app/services/ai_service.py — Sumopod AI service
Port dari callSumopodText/Image/Voice di GAS, sekarang async + proper error handling
"""
import json
import re
import httpx
from datetime import date
from app.config import settings


# ──────────────────────────────────────────────
# System Prompt (identik dengan GAS + enhanced)
# ──────────────────────────────────────────────

def get_system_prompt(extra: str = "", pay_methods: list[str] | None = None) -> str:
    today = date.today().isoformat()
    categories = "\n".join(f"- {c}" for c in settings.valid_categories)
    valid_pms = pay_methods or getattr(
        settings, "valid_payment_methods", ["Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"]
    )
    pms_str = "\n".join(f"- {pm}" for pm in valid_pms)
    return f"""Anda asisten keuangan pintar untuk toko kue Historycake. Ekstrak data belanja/mutasi/invoice ke JSON murni.
Tanggal hari ini: {today}.

Perhatikan Aturan Khusus Klasifikasi Kategori:
1. Bunga, bunga artificial, cake base, tatakan kue, dan stiker WAJIB masuk kategori "Kemasan".
2. Light box dan poster WAJIB masuk kategori "Asset".
3. Iuran, sumbangan, kerja bakti, dan sejenisnya WAJIB masuk kategori "Iuran".
4. Jika caption mengandung "/tukercash" atau teks/gambar bukti transfer tukar tunai, WAJIB masukkan kategori "Tukar Cash".
5. Jika caption mengandung "/ongkir" atau teks/gambar pengiriman kue/kurir, WAJIB masukkan kategori "Ongkir".
6. KATEGORI WAJIB DIPILIH DARI SALAH SATU DAFTAR BERIKUT (Harus sama persis):
{categories}

Aturan Khusus Metode Pembayaran & Status (PENTING):
1. METODE PEMBAYARAN WAJIB DIPILIH DARI SALAH SATU DAFTAR MASTER BERIKUT (Harus sama persis):
{pms_str}
- JANGAN mengarang metode pembayaran di luar daftar master di atas.
- Jika ada rincian bank (BCA, Mandiri, BRI, BNI), e-wallet (GoPay, OVO, ShopeePay, DANA), atau kartu, catat nama/rincian tersebut di kolom "keterangan". Kolom "metode_bayar" tetap WAJIB memilih salah satu opsi master di atas (misal: "Transfer" untuk bank/e-wallet transfer, "QRIS" untuk scan QRIS, "Tunai" untuk cash kasir, "COD" untuk bayar di tempat).
- Jika pada struk, nota, invoice, atau screenshot pesanan tertera metode pembayaran COD / Cash on Delivery / Bayar di Tempat, WAJIB pilih "COD".

2. Aturan Status Pembayaran:
- SELAIN PEMBAYARAN COD, MAKA STATUS PEMBAYARAN NYA WAJIB "Lunas" (misal Tunai, Transfer, QRIS, Debit, Kredit semuanya berstatus "Lunas").
- Khusus pembayaran COD:
  * Set "metode_bayar": "COD"
  * KECUALI jika ada keterangan/caption eksplisit bahwa pesanan sudah dibayar/lunas kasir (misal: "sudah dibayar", "lunas", "sudah lunas"), WAJIB set "status_pembayaran": "Belum Lunas".
  * Jika kolom "keterangan" kosong atau "-", isi dengan "COD - Bayar di Kasir".
  * Alasan: Uang kas fisik kasir baru akan dibayarkan saat kurir tiba mengantar barang di toko, sehingga saat baru di-checkout/dipesan harus berstatus "Belum Lunas".

Aturan Prioritas Tanggal Pemesanan (PENTING untuk mencegah false double input):
- Pada struk, nota, invoice, atau screenshot marketplace (Shopee, Tokopedia, TikTok Shop, Grab, Gojek, dll), WAJIB LIHAT DAN UTAMAKAN "TANGGAL PEMESANAN" / "WAKTU PESANAN" / "TANGGAL TRANSAKSI" / "TANGGAL NOTA" terlebih dahulu sebagai nilai "tanggal" (format YYYY-MM-DD).
- Konversikan waktu/tanggal pesanan tersebut (misal: "24-10-2026 15:30" atau "24 Okt 2026") menjadi "YYYY-MM-DD" (contoh: "2026-10-24").
- JANGAN langsung menetapkan tanggal hari ini ({today}) jika pada dokumen/gambar/teks terdapat tanggal pemesanan atau tanggal transaksi. Hal ini SANGAT PENTING agar pembelian barang yang sama di tanggal berbeda tidak keliru terdeteksi sebagai double input.
- HANYA gunakan tanggal hari ini ({today}) sebagai fallback bila tanggal pemesanan/transaksi sama sekali tidak tertera.

Aturan Nilai Pengeluaran (TIDAK BOLEH 0 ATAU MINUS):
- Nominal pengeluaran TIDAK BOLEH bernilai 0 apalagi minus/negatif.
- Pastikan total_harga > 0 dan harga_satuan > 0.
- Jika ada diskon besar atau voucher, total_harga tidak boleh menjadi 0 atau negatif.
- Baris promo gratis, voucher belanja, atau cashback bernilai 0 atau minus JANGAN dimasukkan sebagai baris pengeluaran.

Aturan Khusus Bukti Transfer Bank / E-Wallet (Tukar Cash / Tarik Tunai Karyawan):
- Jika gambar adalah bukti transfer bank (m-BCA, Livin Mandiri, BRImo, BNI, Permata, DANA, GoPay Transfer, OVO, QRIS Transfer, dll) atau terdapat mutasi kirim uang/transfer dari karyawan ke rekening toko/owner:
  * "kategori": WAJIB "Tukar Cash"
  * "barang": "Tukar Cash - [Nama Pengirim/Karyawan]" (contoh: "Tukar Cash - Budi", jika nama pengirim tidak tertera, isi "Tukar Cash - Karyawan")
  * "qty": 1
  * "satuan": "Trans"
  * "harga_satuan": nominal transfer yang tertera
  * "total_harga": nominal transfer yang tertera
  * "toko_supplier": WAJIB "-" (TIDAK ADA SUPPLIER)
  * "metode_bayar": WAJIB "Tunai" (karena kas fisik toko keluar dari laci kasir)
  * "status_pembayaran": "Lunas"
  * "no_invoice": nomor referensi / no. transaksi transfer jika ada, jika tidak isi "-"
  * "keterangan": WAJIB cantumkan nama bank & pengirim transfer (contoh: "Transfer BCA dari Budi (Ref: 123456)")
  * "is_reimbursement": false

Aturan Khusus Bukti Ongkir & Kurir Pengiriman Kue (GoSend Car, GoSend Bike, GrabExpress, Lalamove, Maxim, J&T, SiCepat):
- Jika gambar adalah bukti pemesanan pengiriman/kurir atau struk ekspedisi delivery cake:
  * "kategori": WAJIB "Ongkir"
  * "barang": "ongkir delivery cake" atau "Ongkir [Layanan] - [Penerima/Tujuan/Kue]" (contoh: "ongkir delivery cake", "Ongkir GoSend - Bolu Ibu Maya")
  * "qty": 1
  * "satuan": "Trip"
  * "harga_satuan": total biaya ongkir bersih yang dibayar
  * "total_harga": total biaya ongkir bersih yang dibayar
  * "toko_supplier": nama kurir / armada (contoh: "GoSend Car", "GoSend Bike", "GrabExpress", "Lalamove", "Maxim", "J&T", "SiCepat", atau nama kurir khusus)
  * "metode_bayar": metode bayar beserta akun jika ada (contoh: "GoPay", "OVO", "Transfer", "Tunai", "QRIS"). WAJIB dinormalisasi sesuai master data.
  * Status & Reimbursement:
    - "status_pembayaran": "Lunas" (ongkir selalu lunas)
    - "is_reimbursement": WAJIB false secara default (data ongkir by default BUKAN talangan).
    - HANYA set "is_reimbursement": true jika caption atau teks secara EKSPLISIT menyebutkan bahwa ongkir ditalangi karyawan / minta direimburse (kata kunci: "reimburse", "rembes", "talangan", "ditalangi"). Jika tidak ada kata kunci eksplisit tersebut, WAJIB false.
    - "keterangan": catatan pengiriman (misal: "Pengiriman cake ultah ke Tebet")

Instruksi Tambahan:
- Pisahkan transaksi beda entitas menjadi beberapa objek di array "items".
- Jika terdapat beberapa baris/poin/nomor transaksi dalam 1 pesan (misal daftar beberapa ongkir pengiriman atau daftar beberapa karyawan tukar cash), WAJIB ekstrak SEMUA baris tersebut menjadi masing-masing 1 objek terpisah di array "items". JANGAN menggabungkan beberapa transaksi berbeda menjadi 1 total gabungan.
- Status Pembayaran: Selain kasus COD di atas, status pembayaran WAJIB "Lunas".
- Jika ada nomor invoice/nota (No. Nota, Inv #, No. Pesanan, Struk #), ekstrak ke "no_invoice". Jika tidak ditemukan isi "-".
- Jika caption atau teks mengandung kata "reimburse", "rembes", "talangan", "ditalangi", set "is_reimbursement": true, jika tidak false.
- Ekstrak "satuan" barang jika tertera di nota atau teks (misal: "bungkus", "box", "dus", "karton", "pouch", "kg", "gram", "kaleng", "pack", "sak", "bal", "botol", "tray", "pcs"). Jika tidak tertera, isi "Pcs".
- Jika terdapat turunan kemasan atau berat/isi per bungkus (misal "1 bungkus isi 1kg", "500g", "isi 6 pouch 2kg"), sertakan di nama barang atau keterangan agar dapat dicocokkan ke turunan master.

Aturan Biaya & Diskon (Khususnya Marketplace seperti Shopee/Tokopedia/TikTok):
- "ongkir": Ongkos kirim BERSIH yang benar-benar ditagihkan/dibayar (ongkir asli dikurangi voucher diskon gratis ongkir). Jika gratis ongkir penuh, isi 0.
- "diskon": HANYA diskon produk / voucher belanja toko. JANGAN memasukkan diskon gratis ongkir ke kolom "diskon" barang!
- "tax": Pajak resmi (PPN/PB1). Jika tidak ada isi 0.
- "biaya_lainnya": Biaya layanan aplikasi/platform, biaya penanganan, biaya admin, proteksi/asuransi pengiriman. Dipisah dari pajak!
- Jika satu nota/keranjang berisi beberapa barang (multi-item), masukkan nilai "ongkir" dan "biaya_lainnya" hanya pada item pertama (atau item utama), sedangkan item lainnya diisi 0 agar tidak terhitung ganda (double count).
- Rumus per baris: total_harga = (qty * harga_satuan) + ongkir + tax + biaya_lainnya - diskon.
{extra}
WAJIB HANYA KELUARKAN JSON VALID. Format Wajib:
{{ "items": [ {{ "tanggal": "YYYY-MM-DD", "barang": "Nama", "qty": 1, "satuan": "Pcs", "kategori": "Bahan Kue", "harga_satuan": 0, "ongkir": 0, "tax": 0, "biaya_lainnya": 0, "diskon": 0, "total_harga": 0, "toko_supplier": "Toko", "metode_bayar": "Tunai", "status_pembayaran": "Lunas", "jatuh_tempo": "-", "keterangan": "-", "no_invoice": "-", "is_reimbursement": false }} ] }}"""


# ──────────────────────────────────────────────
# Core fetch ke Sumopod API
# ──────────────────────────────────────────────

async def _execute_fetch(messages: list[dict]) -> dict:
    """
    Core async HTTP call ke Sumopod.
    Return parsed dict dengan key 'items' atau 'error'.
    """
    payload = {
        "model": settings.sumopod_model,
        "messages": messages,
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {settings.sumopod_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.post(settings.sumopod_url, json=payload, headers=headers)
            data = res.json()

        if "error" in data:
            raise ValueError(str(data["error"]))

        raw = data["choices"][0]["message"]["content"]

        # Ekstrak JSON dari respons (sama seperti GAS)
        match = re.search(r"\{[\s\S]*\}", raw)
        parsed = json.loads(match.group(0) if match else raw)

        # Normalisasi ke format {items: [...]}
        if "items" not in parsed:
            if isinstance(parsed, list):
                parsed = {"items": parsed}
            elif "barang" in parsed:
                parsed = {"items": [parsed]}
            else:
                parsed = {"items": []}

        # Deteksi konteks prompt pesan (berguna untuk multi-item dalam 1 chat)
        user_msg_text = ""
        for m in messages:
            if m.get("role") == "user":
                c = m.get("content")
                if isinstance(c, str):
                    user_msg_text += " " + c
                elif isinstance(c, list):
                    for part in c:
                        if isinstance(part, dict) and part.get("type") == "text":
                            user_msg_text += " " + str(part.get("text", ""))
        user_msg_l = user_msg_text.lower()
        is_ongkir_prompt = "/ongkir" in user_msg_l or "ongkir:" in user_msg_l
        is_tukar_cash_prompt = "/tukercash" in user_msg_l or "tukar cash" in user_msg_l

        # Normalisasi tanggal pemesanan jika AI memakai key alternatif & pengamanan aturan COD (Skenario 1)
        normalized_items = []
        for item in parsed.get("items", []):
            if not isinstance(item, dict):
                continue
            order_date = (
                item.get("tanggal_pemesanan")
                or item.get("waktu_pesanan")
                or item.get("tgl_pesanan")
                or item.get("tgl_pemesanan")
                or item.get("order_date")
                or item.get("tanggal")
            )
            if order_date:
                item["tanggal"] = str(order_date)[:10]

            from app.services.master_data_service import normalize_payment_method_name

            raw_pm = str(item.get("metode_bayar") or "").strip()
            notes = str(item.get("keterangan") or "").strip().lower()
            status_p = str(item.get("status_pembayaran") or "").strip().lower()
            barang_l = str(item.get("barang") or "").strip().lower()
            sup_l = str(item.get("toko_supplier") or "").strip().lower()
            kat_l = str(item.get("kategori") or "").strip().lower()

            # Normalisasi metode bayar agar SELALU sesuai dengan master data
            norm_pm = normalize_payment_method_name(raw_pm)
            item["metode_bayar"] = norm_pm
            pay_m = norm_pm.lower()

            # Aturan Status Pembayaran: selain pembayaran COD maka status nya lunas
            if norm_pm == "COD":
                # Jika tidak dinyatakan eksplisit sudah lunas, pastikan status Belum Lunas
                is_explicit_paid = any(k in notes for k in ("sudah lunas", "sudah dibayar", "lunas kasir", "sudah bayar"))
                if not is_explicit_paid:
                    item["status_pembayaran"] = "Belum Lunas"
                    if not item.get("keterangan") or item.get("keterangan") == "-":
                        item["keterangan"] = "COD - Bayar di Kasir"
                else:
                    item["status_pembayaran"] = "Lunas"
            else:
                # Selain pembayaran COD maka status nya lunas
                item["status_pembayaran"] = "Lunas"

            # Normalisasi Bukti Transfer / Tukar Cash Karyawan
            is_tukar_cash = (
                is_tukar_cash_prompt
                or "tukar cash" in barang_l
                or "tarik tunai" in barang_l
                or "tukercash" in notes
                or "tukar cash" in kat_l
                or "tarik tunai" in notes
                or any(b in sup_l for b in ("m-bca", "bca mobile", "livin", "brimo", "qris transfer"))
                or ("transfer" in barang_l and any(b in sup_l for b in ("bca", "mandiri", "bri", "bni", "dana")))
            )
            if is_tukar_cash:
                item["kategori"] = "Tukar Cash"
                if not item.get("satuan") or item.get("satuan") == "Pcs":
                    item["satuan"] = "Trans"
                # Metode bayar SELALU Cash / Tunai (kas fisik toko yang keluar)
                item["metode_bayar"] = "Tunai"
                item["status_pembayaran"] = "Lunas"

                # Bank transfer masuk ke Catatan saja, dan TIDAK ADA SUPPLIER (toko_supplier = "-")
                bank_info = []
                orig_sup = str(item.get("toko_supplier") or "").strip()
                if orig_sup and orig_sup not in ("-", "None"):
                    bank_info.append(f"Bank/Layanan: {orig_sup}")
                inv_ref = str(item.get("no_invoice") or "").strip()
                if inv_ref and inv_ref not in ("-", "None"):
                    bank_info.append(f"Ref: {inv_ref}")

                curr_notes = str(item.get("keterangan") or "").strip()
                if curr_notes in ("-", "", "Tarik tunai kasir (uang masuk ke rekening)"):
                    if bank_info:
                        item["keterangan"] = f"Transfer {', '.join(bank_info)}"
                    else:
                        item["keterangan"] = "Tukar cash kasir (uang transfer masuk ke rekening)"
                else:
                    if bank_info and not any(bi in curr_notes for bi in bank_info):
                        item["keterangan"] = f"{curr_notes} ({', '.join(bank_info)})"

                # Tidak ada supplier untuk Tukar Cash
                item["toko_supplier"] = "-"

            # Normalisasi Bukti Ongkir & Kurir Instan
            is_ongkir = (
                (is_ongkir_prompt and not is_tukar_cash)
                or kat_l == "ongkir"
                or "ongkir" in barang_l
                or "ongkos kirim" in barang_l
                or "gosend" in barang_l
                or "grabexpress" in barang_l
                or "lalamove" in barang_l
                or "maxim" in barang_l
                or any(k in sup_l for k in ("gosend", "grabexpress", "lalamove", "maxim", "gojek", "grab", "j&t", "sicepat", "anteraja"))
            )
            if is_ongkir and item.get("kategori") != "Tukar Cash":
                item["kategori"] = "Ongkir"
                if not any(item.get("barang", "").lower().startswith(p) for p in ("ongkir", "ongkos kirim")):
                    item["barang"] = f"Ongkir {item.get('barang', 'delivery cake')}"
                if not item.get("satuan") or item.get("satuan") == "Pcs":
                    item["satuan"] = "Trip"
                # Pastikan nama kurir di toko_supplier
                if not item.get("toko_supplier") or item.get("toko_supplier") == "-":
                    for kurir in ("GoSend Car", "GoSend Bike", "GoSend", "GrabExpress", "Lalamove", "Maxim", "J&T", "SiCepat"):
                        if kurir.lower() in barang_l or kurir.lower() in notes:
                            item["toko_supplier"] = kurir
                            break
                    if not item.get("toko_supplier") or item.get("toko_supplier") == "-":
                        item["toko_supplier"] = "Kurir"
                # Ongkir by default TIDAK masuk talangan (is_reimbursement = False)
                # HANYA jika caption/catatan secara eksplisit menyebutkan talangan/reimburse
                has_reimb_keyword = any(
                    k in notes for k in ("reimburse", "rembes", "talangan", "ditalangi")
                ) or any(
                    k in barang_l for k in ("reimburse", "rembes", "talangan", "ditalangi")
                )
                if has_reimb_keyword:
                    item["is_reimbursement"] = True
                    if not item.get("keterangan") or item.get("keterangan") == "-":
                        item["keterangan"] = "Ongkir ditalangi karyawan"
                else:
                    item["is_reimbursement"] = False

            normalized_items.append(item)
        parsed["items"] = normalized_items

        return parsed

    except Exception as e:
        return {"error": True, "message": str(e)}


# ──────────────────────────────────────────────
# Public API: text / image / voice
# ──────────────────────────────────────────────

async def call_ai_text(text: str) -> dict:
    """Ekstrak data dari teks biasa. Port dari callSumopodText."""
    messages = [
        {"role": "system", "content": get_system_prompt()},
        {"role": "user", "content": f'Input: "{text}"'},
    ]
    return await _execute_fetch(messages)


async def call_ai_image(base64_image: str, caption: str = "") -> dict:
    """Ekstrak data dari foto struk. Port dari callSumopodImage."""
    messages = [
        {"role": "system", "content": get_system_prompt()},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": f'Caption: "{caption}"'},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"},
                },
            ],
        },
    ]
    return await _execute_fetch(messages)


async def call_ai_voice(base64_audio: str) -> dict:
    """Transkripsi & ekstrak dari voice note. Port dari callSumopodVoice."""
    messages = [
        {
            "role": "system",
            "content": get_system_prompt(extra="Ekstra: Ekstrak data dari transkrip audio."),
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "input_audio",
                    "input_audio": {"data": base64_audio, "format": "ogg"},
                }
            ],
        },
    ]
    return await _execute_fetch(messages)


async def call_ai_fix_categories(items_to_fix: list[dict]) -> dict:
    """
    Minta AI untuk fix kategori yang tidak valid.
    Port dari runAutoFix di GAS.
    """
    categories_str = ", ".join(settings.valid_categories)
    prompt = (
        f"Perbaiki kategori dari data belanja berikut. Patuhi aturan ini: "
        f"Bunga/bunga artificial/cake base/tatakan kue/stiker -> \"Kemasan\". "
        f"Light box/poster -> \"Asset\". Iuran/sumbangan/kerja bakti -> \"Iuran\". "
        f"Selain itu, cocokkan dengan daftar ini: {categories_str}.\n\n"
        f"Data Salah:\n{json.dumps(items_to_fix, ensure_ascii=False)}\n\n"
        f"WAJIB keluarkan HANYA JSON:\n"
        f'{{ "items": [ {{ "row": <angka_baris>, "kategori_baru": "<Kategori_Valid>" }} ] }}'
    )
    messages = [
        {"role": "system", "content": "Anda auditor data keuangan."},
        {"role": "user", "content": prompt},
    ]
    return await _execute_fetch(messages)
