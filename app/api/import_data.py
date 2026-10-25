"""
app/api/import_data.py — REST API for CSV Import
"""
from fastapi import APIRouter, Depends, UploadFile, File, Form, Response, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import get_db
from app.config import settings
from app.api.deps import require_auth
from app.services.csv_import_service import parse_csv_file
from app.services.expense_service import (
    bulk_check_duplicates,
    batch_insert_expenses,
    make_duplicate_key,
)

router = APIRouter(prefix="/import", tags=["import"], dependencies=[Depends(require_auth)])


@router.post("/csv")
async def api_import_csv(
    file: UploadFile = File(...),
    skip_duplicates: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format file tidak valid. Harap unggah file dengan format .csv",
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gagal membaca file: {str(e)}",
        )

    parsed = parse_csv_file(content, valid_categories=settings.valid_categories)
    if not parsed.valid_rows and not parsed.skipped_rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File CSV kosong atau tidak memiliki baris data yang bisa dibaca.",
        )

    to_insert: list[dict] = []
    skipped_duplicates: list[dict] = []

    if skip_duplicates and parsed.valid_rows:
        dup_keys = await bulk_check_duplicates(db, parsed.valid_rows)
        for item in parsed.valid_rows:
            key = make_duplicate_key(
                item["expense_date"], item["supplier"], item["item_name"], item["total_price"]
            )
            if key in dup_keys:
                skipped_duplicates.append(item)
            else:
                to_insert.append(item)
                dup_keys.add(key)
    else:
        to_insert = parsed.valid_rows

    inserted_expenses = []
    if to_insert:
        inserted_expenses = await batch_insert_expenses(
            db, to_insert, sheets_synced=True, actor="import:csv"
        )
        await db.commit()

    return {
        "ok": True,
        "result": {
            "inserted_count": len(inserted_expenses),
            "duplicate_count": len(skipped_duplicates),
            "failed_count": len(parsed.skipped_rows),
            "total_rows": parsed.total_rows,
            "failed_rows": parsed.skipped_rows[:50],
        },
    }


@router.get("/template")
async def api_download_template():
    template_csv = (
        "Timestamp,Tanggal Nota,Toko / Supplier,Barang,Qty,Kategori,Harga Satuan,Tax,Diskon,Total Harga,Metode Bayar,Status Pembayaran,Jatuh Tempo,Keterangan,Link Pesan\r\n"
        "2026-10-01 10:00:00,2026-10-01,Toko Bahan Roti Makmur,Tepung Terigu Cakra 25kg,2,Bahan Kue,260000,0,0,520000,Transfer,Lunas,-,Bahan adonan utama,Private Chat\r\n"
        "2026-10-02 11:30:00,2026-10-02,Plastik Jaya Sentosa,Dus Kue 20x20,100,Kemasan,3500,0,10000,340000,Tunai,Lunas,-,Box cake reguler,Private Chat\r\n"
        "2026-10-03 14:15:00,2026-10-03,Super Indo,Susu UHT Full Cream 1L,12,Bahan Kue,18500,0,0,222000,Debit,Lunas,-,Stok mingguan,Private Chat\r\n"
    )
    response = Response(content=template_csv, media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=template_import_catpen.csv"
    return response
