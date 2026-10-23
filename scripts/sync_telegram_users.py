"""
scripts/sync_telegram_users.py: Script CLI untuk sinkronisasi penginput dari link Telegram
"""
import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database.connection import AsyncSessionLocal
from app.services.telegram_sync_service import sync_telegram_users_from_links


async def main():
    print("🚀 Memulai sinkronisasi penginput nota dari tautan Telegram...")
    async with AsyncSessionLocal() as db:
        res = await sync_telegram_users_from_links(db)
        print("Hasil:", res)
        if res.get("ok"):
            print(f"✅ Selesai: {res.get('updated_count')} transaksi berhasil dihubungkan.")
        else:
            print(f"❌ Gagal: {res.get('error')}")


if __name__ == "__main__":
    asyncio.run(main())
