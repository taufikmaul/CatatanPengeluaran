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

def get_system_prompt(extra: str = "") -> str:
    today = date.today().isoformat()
    categories = "\n".join(f"- {c}" for c in settings.valid_categories)
    return f"""Anda asisten keuangan pintar untuk toko kue Historycake. Ekstrak data belanja/mutasi/invoice ke JSON murni.
Tanggal hari ini: {today}.

Perhatikan Aturan Khusus Klasifikasi Kategori:
1. Bunga, bunga artificial, cake base, tatakan kue, dan stiker WAJIB masuk kategori "Kemasan".
2. Light box dan poster WAJIB masuk kategori "Asset".
3. Iuran, sumbangan, kerja bakti, dan sejenisnya WAJIB masuk kategori "Iuran".
4. Jika caption mengandung "/tukercash", masukkan kategori "Tukar Cash".
5. KATEGORI WAJIB DIPILIH DARI SALAH SATU DAFTAR BERIKUT (Harus sama persis):
{categories}

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

Aturan Pembayaran COD (Cash on Delivery / Bayar di Tempat) - Skenario Kasir:
- Jika pada struk, nota, invoice, atau screenshot pesanan (Shopee, Tokopedia, TikTok Shop, dll) tertera metode pembayaran "COD", "Cash on Delivery", atau "Bayar di Tempat":
  * Set "metode_bayar": "COD"
  * KECUALI jika ada keterangan/caption eksplisit bahwa pesanan sudah dibayar/lunas (misal: "sudah dibayar", "lunas", "sudah lunas"), WAJIB set "status_pembayaran": "Belum Lunas".
  * Jika kolom "keterangan" kosong atau "-", isi dengan "COD - Bayar di Kasir".
  * Alasan: Uang kas fisik kasir baru akan dibayarkan saat kurir tiba mengantar barang di toko, sehingga saat baru di-checkout/dipesan harus berstatus "Belum Lunas".

Instruksi Tambahan:
- Pisahkan transaksi beda entitas menjadi beberapa objek di array "items".
- Status Pembayaran selain kasus COD di atas, asumsikan "Lunas" kecuali disebut sebaliknya.
- Jika ada nomor invoice/nota (No. Nota, Inv #, No. Pesanan, Struk #), ekstrak ke "no_invoice". Jika tidak ditemukan isi "-".
- Jika caption atau teks mengandung kata "reimburse", "rembes", "talangan", "ditalangi", set "is_reimbursement": true, jika tidak false.
- Ekstrak "satuan" barang jika tertera di nota atau teks (misal: "box", "dus", "karton", "pouch", "kg", "kaleng", "pack", "sak", "bal", "botol", "tray", "pcs"). Jika tidak tertera, isi "Pcs".

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

            # Aturan COD (Skenario 1: Uang kas kasir baru keluar saat barang tiba)
            pay_m = str(item.get("metode_bayar") or "").strip().lower()
            notes = str(item.get("keterangan") or "").strip().lower()
            status_p = str(item.get("status_pembayaran") or "").strip().lower()

            is_cod = any(k in pay_m for k in ("cod", "bayar di tempat", "cash on delivery"))
            if is_cod:
                item["metode_bayar"] = "COD"
                # Jika tidak dinyatakan eksplisit sudah lunas, pastikan status Belum Lunas
                is_explicit_paid = any(k in notes for k in ("sudah lunas", "sudah dibayar", "lunas kasir", "sudah bayar"))
                if not is_explicit_paid and status_p != "lunas":
                    item["status_pembayaran"] = "Belum Lunas"
                    if not item.get("keterangan") or item.get("keterangan") == "-":
                        item["keterangan"] = "COD - Bayar di Kasir"
                elif not is_explicit_paid and status_p == "lunas":
                    # AI default ke lunas karena asumsi prompt umum, tapi ini transaksi COD
                    item["status_pembayaran"] = "Belum Lunas"
                    if not item.get("keterangan") or item.get("keterangan") == "-":
                        item["keterangan"] = "COD - Bayar di Kasir"

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
