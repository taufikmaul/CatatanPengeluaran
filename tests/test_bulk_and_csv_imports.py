"""
tests/test_bulk_and_csv_imports.py — Pengujian lengkap endpoint Bulk Form & Import Template CSV
untuk Aset Inventaris, Supplier/Kurir, Master Item, dan Menu Produk.
"""
import pytest


@pytest.mark.asyncio
async def test_assets_template_bulk_and_csv_import(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Unduh Template CSV Aset
    tpl_res = await client.get("/api/v1/assets/template-csv")
    assert tpl_res.status_code == 200
    assert "text/csv" in tpl_res.headers.get("content-type", "")
    tpl_text = tpl_res.content.decode("utf-8-sig")
    assert "Nama Aset" in tpl_text
    assert "Harga Perolehan" in tpl_text

    # 2. Tambah Masal via Form JSON (/assets/bulk)
    bulk_res = await client.post(
        "/api/v1/assets/bulk",
        json={
            "items": [
                {
                    "name": "Mixer Planetary 20L",
                    "asset_group": "Mesin & Peralatan Dapur",
                    "brand_model": "Getra B20",
                    "purchase_date": "2026-10-01",
                    "acquisition_cost": 4500000,
                    "salvage_value": 500000,
                    "useful_life_months": 48,
                    "location": "Dapur Produksi",
                    "vendor_name": "Toko Mesin",
                    "warranty_months": 12,
                },
                {
                    "name": "Timbangan Digital Mini",
                    "purchase_date": "2026-10-05",
                    "acquisition_cost": 180000,
                    "location": "Meja Packing",
                },
            ]
        },
    )
    assert bulk_res.status_code in (200, 201)
    bdata = bulk_res.json()
    assert bdata["ok"] is True
    assert bdata["added"] == 2
    assert bdata["skipped"] == 0
    assert bdata["items"][0]["capitalization_status"] == "capitalized"
    assert bdata["items"][1]["capitalization_status"] == "expensed_low_value"

    # 3. Import CSV dengan delimiter semicolon (;) & format tanggal/angka Indonesia
    csv_payload = (
        "Nama Aset;Kelompok Aset;Merk / Model;Nomor Seri;Tanggal Perolehan;Harga Perolehan;Nilai Residu;Masa Manfaat (Bulan);Lokasi;PIC;Vendor / Toko;Garansi (Bulan);Kondisi;Status;Catatan\n"
        "Chiller 2 Pintu;Pendingin & Showcase;GEA Expo-800;SN-881;15/10/2026;Rp 6.200.000;Rp 700.000;60;Area Display;Rina;Toko Pendingin;24;Baik;Aktif;Unit utama\n"
        "Rak Besi Gudang;Furnitur & Rak;Custom;;2026-10-16;450000;0;36;Gudang;Budi;Toko Besi;0;Baik;Aktif;\n"
    ).encode("utf-8")

    csv_res = await client.post(
        "/api/v1/assets/import-csv",
        files={"file": ("aset_baru.csv", csv_payload, "text/csv")},
    )
    assert csv_res.status_code == 200
    cdata = csv_res.json()
    assert cdata["ok"] is True
    assert cdata["added"] == 2
    assert cdata["items"][0]["name"] == "Chiller 2 Pintu"
    assert cdata["items"][0]["acquisition_cost"] == 6200000.0


@pytest.mark.asyncio
async def test_suppliers_template_bulk_and_csv_import(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Unduh Template CSV Supplier
    tpl_res = await client.get("/api/v1/suppliers/template-csv")
    assert tpl_res.status_code == 200
    tpl_text = tpl_res.content.decode("utf-8-sig")
    assert "Nama Supplier" in tpl_text
    assert "Tipe (toko/kurir)" in tpl_text

    # 2. Tambah Masal via Form JSON (/suppliers/bulk)
    bulk_res = await client.post(
        "/api/v1/suppliers/bulk",
        json={
            "update_existing": True,
            "items": [
                {
                    "name": "Toko Bahan Maju",
                    "supplier_type": "toko",
                    "phone": "0811111111",
                    "address": "Jl. Merdeka 10",
                    "aliases": "TB Maju, Maju Jaya",
                    "is_active": True,
                },
                {
                    "name": "Kurir Mas Agus",
                    "supplier_type": "kurir",
                    "courier_category": "Kurir Langganan",
                    "is_subscribed": True,
                    "phone": "0822222222",
                    "is_active": True,
                },
            ],
        },
    )
    assert bulk_res.status_code in (200, 201)
    assert bulk_res.json()["added"] == 2

    # 3. Import CSV dengan koma (,) -> 1 update existing + 1 baru
    csv_payload = (
        "Nama Supplier,Tipe (toko/kurir),Kategori Kurir,Kurir Langganan (ya/tidak),No Telp,Alamat,Alias,Catatan,Aktif (ya/tidak)\n"
        "Toko Bahan Maju,toko,,tidak,0811999999,Jl. Merdeka No 10B,TB Maju,Langganan tepung,ya\n"
        "Paxel Express,kurir,Ekspedisi Reguler,tidak,1500999,,paxel,Kurir dingin,ya\n"
    ).encode("utf-8")

    csv_res = await client.post(
        "/api/v1/suppliers/import-csv",
        files={"file": ("suppliers.csv", csv_payload, "text/csv")},
        data={"update_existing": "true"},
    )
    assert csv_res.status_code == 200
    cdata = csv_res.json()
    assert cdata["added"] == 1
    assert cdata["updated"] == 1

    # 4. Import ulang dgn update_existing=false -> semua existing di-skip
    skip_res = await client.post(
        "/api/v1/suppliers/import-csv",
        files={"file": ("suppliers.csv", csv_payload, "text/csv")},
        data={"update_existing": "false"},
    )
    assert skip_res.status_code == 200
    assert skip_res.json()["skipped"] == 2
    assert skip_res.json()["added"] == 0


@pytest.mark.asyncio
async def test_master_items_template_bulk_and_csv_import(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Unduh Template CSV Master Item
    tpl_res = await client.get("/api/v1/master-items/template-csv")
    assert tpl_res.status_code == 200
    tpl_text = tpl_res.content.decode("utf-8-sig")
    assert "Nama Item" in tpl_text
    assert "Satuan Beli" in tpl_text

    # 2. Tambah Masal via Structured Form (/master-items/bulk dengan items[])
    bulk_res = await client.post(
        "/api/v1/master-items/bulk",
        json={
            "default_category": "Bahan Kue",
            "update_existing": True,
            "items": [
                {
                    "item_name": "Mentega Anchor Unsalted",
                    "category": "Bahan Kue",
                    "satuan_beli": "Kg",
                    "tipe_satuan": "keduanya",
                    "isi_paket": "5 kg",
                    "satuan_ecer": "Gram",
                    "default_supplier": "Toko Bahan Maju",
                    "aliases": "anchor butter, mentega anchor",
                },
                {
                    "item_name": "Box Tart 22x22",
                    "category": "Kemasan",
                    "satuan_beli": "Pack",
                    "tipe_satuan": "paket",
                    "isi_paket": "25 pcs",
                    "satuan_ecer": "Pcs",
                },
            ],
        },
    )
    assert bulk_res.status_code in (200, 201)
    assert bulk_res.json()["added"] == 2

    # 3. Backwards compatibility raw_text di /master-items/bulk tetap berjalan
    raw_res = await client.post(
        "/api/v1/master-items/bulk",
        json={
            "raw_text": "Gula Halus Claris | Bahan Kue | gula halus | Toko Bahan Maju | Pack | keduanya | 500 gr | Gram",
            "default_category": "Bahan Kue",
        },
    )
    assert raw_res.status_code == 200
    assert raw_res.json()["added"] == 1

    # 4. Import CSV Master Item (semicolon) -> 1 update + 1 add
    csv_payload = (
        "Nama Item;Kategori;Satuan Beli;Tipe Satuan (paket/ecer/keduanya);Isi Paket;Satuan Ecer;Supplier Default;Alias\n"
        "Box Tart 22x22;Kemasan;Box;keduanya;50 pcs;Pcs;Toko Plastik;dus tart 22\n"
        "Coklat Bubuk Bensdorp;Bahan Kue;Kg;keduanya;1 kg;Gram;Toko Bahan Maju;bensdorp\n"
    ).encode("utf-8")

    csv_res = await client.post(
        "/api/v1/master-items/import-csv",
        files={"file": ("master_items.csv", csv_payload, "text/csv")},
        data={"default_category": "Bahan Kue", "update_existing": "true"},
    )
    assert csv_res.status_code == 200
    cdata = csv_res.json()
    assert cdata["added"] == 1
    assert cdata["updated"] == 1


@pytest.mark.asyncio
async def test_menus_bulk_form_and_csv_import(client, auth_cookies):
    client.cookies.update(auth_cookies)

    # 1. Template CSV Menu
    tpl_res = await client.get("/api/v1/menus/template-csv")
    assert tpl_res.status_code == 200
    assert "Nama Menu" in tpl_res.content.decode("utf-8-sig")

    # 2. Tambah Masal via Form (/menus/bulk)
    bulk_res = await client.post(
        "/api/v1/menus/bulk",
        json={
            "update_existing": True,
            "items": [
                {
                    "name": "Kopi Susu Gula Aren",
                    "sku": "KSGA-01",
                    "category": "Minuman",
                    "product_group": "Signature",
                    "unit": "Cup",
                    "selling_price": 22000,
                    "hpp_manual": 8500,
                    "hpp_mode": "manual",
                    "is_active": True,
                },
                {
                    "name": "Lapis Legit Prunes",
                    "sku": "LLP-20",
                    "category": "Kue",
                    "unit": "Box",
                    "selling_price": 185000,
                    "hpp_manual": 78000,
                    "hpp_mode": "manual",
                    "is_active": True,
                },
            ],
        },
    )
    assert bulk_res.status_code in (200, 201)
    bdata = bulk_res.json()
    assert bdata["ok"] is True
    assert bdata["added"] == 2
    assert bdata["updated"] == 0

    # 3. Update existing via /menus/bulk
    upd_res = await client.post(
        "/api/v1/menus/bulk",
        json={
            "update_existing": True,
            "items": [
                {
                    "name": "Kopi Susu Gula Aren",
                    "category": "Minuman",
                    "unit": "Cup",
                    "selling_price": 24000,
                    "hpp_manual": 9000,
                    "hpp_mode": "manual",
                    "is_active": True,
                },
            ],
        },
    )
    assert upd_res.status_code in (200, 201)
    assert upd_res.json()["updated"] == 1
