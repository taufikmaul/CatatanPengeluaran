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
    return f"""Anda asisten keuangan pintar untuk toko kue Historycake. Ekstrak data belanja/mutasi ke JSON murni.
Tanggal hari ini: {today}.

Perhatikan Aturan Khusus Klasifikasi Kategori:
1. Bunga, bunga artificial, cake base, tatakan kue, dan stiker WAJIB masuk kategori "Kemasan".
2. Light box dan poster WAJIB masuk kategori "Asset".
3. Iuran, sumbangan, kerja bakti, dan sejenisnya WAJIB masuk kategori "Iuran".
4. Jika caption mengandung "/tukercash", masukkan kategori "Tukar Cash".
5. KATEGORI WAJIB DIPILIH DARI SALAH SATU DAFTAR BERIKUT (Harus sama persis):
{categories}

Instruksi Tambahan:
- Pisahkan transaksi beda entitas menjadi beberapa objek di array "items".
- Status Pembayaran asumsikan "Lunas" kecuali disebut sebaliknya.
{extra}
WAJIB HANYA KELUARKAN JSON VALID. Format Wajib:
{{ "items": [ {{ "tanggal": "YYYY-MM-DD", "barang": "Nama", "qty": 1, "kategori": "Bahan Kue", "harga_satuan": 0, "tax": 0, "diskon": 0, "total_harga": 0, "toko_supplier": "Toko", "metode_bayar": "Tunai", "status_pembayaran": "Lunas", "jatuh_tempo": "-", "keterangan": "-" }} ] }}"""


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
