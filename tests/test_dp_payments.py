"""
tests/test_dp_payments.py — Uji lengkap fitur DP (Down Payment) & Pelunasan pada /unpaid
"""
from datetime import date, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import Expense
from app.models.bank_account import BankAccount
from app.models.supplier import Supplier
from app.services.bank_account_service import list_bank_accounts
from app.services.expense_service import get_monthly_report
from app.services.accounting_service import get_accounting_report
from app.services.supplier_service import get_supplier_by_id


class TestDpAndSettlementFlow:
    @pytest.mark.asyncio
    async def test_create_expense_with_dp_percent_and_nominal(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        bank = BankAccount(
            name="BCA Operasional",
            bank_name="BCA",
            account_type="bank",
            account_code="1-1120",
            opening_balance=Decimal("10000000"),
            is_active=True,
        )
        db.add(bank)
        await db.commit()
        await db.refresh(bank)

        due_str = (date.today() + timedelta(days=14)).isoformat()

        # 1. Buat invoice DP 50% dari Rp 2.000.000
        res1 = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": date.today().isoformat(),
                "supplier": "PT Kemasan Jaya",
                "item_name": "Dus Kue Custom 500pcs",
                "qty": 1,
                "unit": "Pcs",
                "category": "Kemasan",
                "unit_price": 2000000,
                "total_price": 2000000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_type": "percent",
                "dp_percent": 50,
                "due_date": due_str,
                "bank_account_id": bank.id,
            },
        )
        assert res1.status_code == 201, res1.text
        d1 = res1.json()
        assert d1["pay_status"] == "DP / Sebagian"
        assert d1["paid_amount"] == 1000000.0
        assert d1["remaining_amount"] == 1000000.0
        assert d1["payment_progress_pct"] == 50.0
        assert d1["payments_count"] == 1
        assert d1["payments"][0]["payment_type"] == "dp"
        assert d1["payments"][0]["amount"] == 1000000.0
        assert d1["due_date"] == due_str

        # 2. Buat invoice DP nominal Rp 300.000 dari Rp 1.000.000
        res2 = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": date.today().isoformat(),
                "supplier": "PT Kemasan Jaya",
                "item_name": "Stiker Box Gold",
                "qty": 1,
                "unit": "Pcs",
                "category": "Kemasan",
                "unit_price": 1000000,
                "total_price": 1000000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_type": "amount",
                "paid_amount": 300000,
                "due_date": (date.today() + timedelta(days=7)).isoformat(),
                "bank_account_id": bank.id,
            },
        )
        assert res2.status_code == 201, res2.text
        d2 = res2.json()
        assert d2["pay_status"] == "DP / Sebagian"
        assert d2["paid_amount"] == 300000.0
        assert d2["remaining_amount"] == 700000.0
        assert d2["dp_percent"] == 30.0

        # 3. Validasi DP <= 0 ditolak
        res_bad = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": date.today().isoformat(),
                "supplier": "PT Kemasan Jaya",
                "item_name": "Item Invalid DP",
                "qty": 1,
                "unit": "Pcs",
                "category": "Kemasan",
                "unit_price": 500000,
                "total_price": 500000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_type": "amount",
                "paid_amount": 0,
                "due_date": due_str,
            },
        )
        assert res_bad.status_code == 400

        # 4. Cek saldo rekening berkurang tepat sebesar total DP yg dibayar (1jt + 300rb = 1.3jt)
        accounts = await list_bank_accounts(db)
        bca = next(a for a in accounts if a["id"] == bank.id)
        assert bca["estimated_balance"] == 8700000.0

        # 5. Cek Unpaid Summary: total sisa = 1.000.000 + 700.000 = 1.700.000
        sum_res = await client.get("/api/v1/expenses/unpaid/summary")
        assert sum_res.status_code == 200
        sdata = sum_res.json()
        assert sdata["total_unpaid_count"] == 2
        assert sdata["total_unpaid_nominal"] == 1700000.0
        assert sdata["dp_count"] == 2
        assert sdata["dp_paid_nominal"] == 1300000.0
        assert sdata["dp_remaining_nominal"] == 1700000.0

        # 6. Cek filter status tidak salah mencocokkan "Belum Lunas" saat filter "Lunas"
        lunas_list = await client.get("/api/v1/expenses?special_type=unpaid&status=Lunas")
        assert lunas_list.status_code == 200
        assert lunas_list.json()["total"] == 0

        dp_list = await client.get("/api/v1/expenses?special_type=unpaid&status=DP / Sebagian")
        assert dp_list.status_code == 200
        assert dp_list.json()["total"] == 2

    @pytest.mark.asyncio
    async def test_installments_settlement_and_delete_payment(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        bank_bca = BankAccount(
            name="BCA",
            bank_name="BCA",
            account_type="bank",
            account_code="1-1120",
            opening_balance=Decimal("5000000"),
            is_active=True,
        )
        bank_kas = BankAccount(
            name="Kas Tunai",
            bank_name="Kas",
            account_type="cash",
            account_code="1-1110",
            opening_balance=Decimal("3000000"),
            is_active=True,
        )
        sup = Supplier(name="Toko Loyang Utama")
        db.add_all([bank_bca, bank_kas, sup])
        await db.flush()

        today = date.today()
        exp = Expense(
            expense_date=today,
            supplier="Toko Loyang Utama",
            supplier_id=sup.id,
            item_name="Oven Deck 2 Tray",
            qty=Decimal("1"),
            unit="Pcs",
            category="Asset",
            unit_price=Decimal("4000000"),
            total_price=Decimal("4000000"),
            pay_method="Tempo / Tagihan",
            pay_status="Belum Lunas",
            due_date=(today + timedelta(days=3)).isoformat(),
        )
        db.add(exp)
        await db.commit()
        await db.refresh(exp)

        # 1. Bayar DP 25% (Rp 1.000.000) via BCA dan perpanjang tempo ke +21 hari
        new_due = (today + timedelta(days=21)).isoformat()
        p1_res = await client.post(
            f"/api/v1/expenses/{exp.id}/payments",
            json={
                "dp_percent": 25,
                "payment_date": today.isoformat(),
                "pay_method": "Transfer",
                "bank_account_id": bank_bca.id,
                "due_date": new_due,
                "reference_no": "TRF-DP-01",
                "notes": "DP 25% pesan oven",
            },
        )
        assert p1_res.status_code == 200, p1_res.text
        after_p1 = p1_res.json()
        assert after_p1["pay_status"] == "DP / Sebagian"
        assert after_p1["paid_amount"] == 1000000.0
        assert after_p1["remaining_amount"] == 3000000.0
        assert after_p1["due_date"] == new_due
        assert after_p1["payments"][0]["payment_type"] == "dp"

        # 2. Overpayment ditolak (> sisa Rp 3.000.000)
        over_res = await client.post(
            f"/api/v1/expenses/{exp.id}/payments",
            json={"amount": 3500000, "payment_date": today.isoformat()},
        )
        assert over_res.status_code == 400

        # 3. Bayar termin ke-2 Rp 1.000.000 via Kas Tunai
        p2_res = await client.post(
            f"/api/v1/expenses/{exp.id}/payments",
            json={
                "amount": 1000000,
                "payment_date": today.isoformat(),
                "pay_method": "Tunai",
                "bank_account_id": bank_kas.id,
                "notes": "Cicilan ke-2",
            },
        )
        assert p2_res.status_code == 200
        after_p2 = p2_res.json()
        assert after_p2["pay_status"] == "DP / Sebagian"
        assert after_p2["paid_amount"] == 2000000.0
        assert after_p2["remaining_amount"] == 2000000.0
        assert after_p2["payments"][1]["payment_type"] == "installment"

        # Cek monthly report & supplier detail saat masih DP 50% (2jt terbayar, 2jt sisa)
        rep = await get_monthly_report(db, today.year, today.month)
        assert rep["total_lunas"] >= 2000000.0
        hutang_item = next((h for h in rep["list_hutang"] if h["id"] == exp.id), None)
        assert hutang_item is not None
        assert hutang_item["nominal"] == 2000000.0
        assert hutang_item["paid_amount"] == 2000000.0

        sup_detail = await get_supplier_by_id(db, sup.id)
        assert sup_detail is not None
        assert sup_detail["unpaid_bills_total"] == 2000000.0

        # 4. Pelunasan penuh sisa (Rp 2.000.000) via BCA
        p3_res = await client.post(
            f"/api/v1/expenses/{exp.id}/payments",
            json={
                "settle_full": True,
                "payment_date": today.isoformat(),
                "pay_method": "Transfer",
                "bank_account_id": bank_bca.id,
                "notes": "Pelunasan akhir",
            },
        )
        assert p3_res.status_code == 200
        after_p3 = p3_res.json()
        assert after_p3["pay_status"] == "Lunas"
        assert after_p3["paid_amount"] == 4000000.0
        assert after_p3["remaining_amount"] == 0.0
        assert len(after_p3["payments"]) == 3
        settlement_id = after_p3["payments"][2]["id"]

        # Cek saldo kedua rekening tidak double count:
        # BCA: 5jt - 1jt (DP) - 2jt (pelunasan) = 2jt
        # Kas: 3jt - 1jt (cicilan) = 2jt
        accounts = await list_bank_accounts(db)
        bca = next(a for a in accounts if a["id"] == bank_bca.id)
        kas = next(a for a in accounts if a["id"] == bank_kas.id)
        assert bca["estimated_balance"] == 2000000.0
        assert kas["estimated_balance"] == 2000000.0

        # 5. Pembayaran setelah lunas harus ditolak
        after_paid_res = await client.post(
            f"/api/v1/expenses/{exp.id}/payments",
            json={"amount": 100000},
        )
        assert after_paid_res.status_code == 400

        # 6. Hapus pembayaran pelunasan -> status kembali ke "DP / Sebagian" dengan sisa Rp 2jt
        del_res = await client.delete(f"/api/v1/expenses/{exp.id}/payments/{settlement_id}")
        assert del_res.status_code == 200
        reverted = del_res.json()
        assert reverted["pay_status"] == "DP / Sebagian"
        assert reverted["paid_amount"] == 2000000.0
        assert reverted["remaining_amount"] == 2000000.0

    @pytest.mark.asyncio
    async def test_batch_settle_preserves_dp_history_on_revert(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        today = date.today()
        # Buat invoice DP 50%
        create_res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Supplier Bahan Kue",
                "item_name": "Cokelat Couverture 20kg",
                "qty": 1,
                "unit": "Pcs",
                "category": "Bahan Kue",
                "unit_price": 1200000,
                "total_price": 1200000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_type": "percent",
                "dp_percent": 50,
                "due_date": (today + timedelta(days=10)).isoformat(),
            },
        )
        assert create_res.status_code == 201
        exp_id = create_res.json()["id"]

        # Lunasi via /unpaid/settle
        settle_res = await client.post(
            "/api/v1/expenses/unpaid/settle",
            json={"expense_ids": [exp_id], "action": "mark_paid"},
        )
        assert settle_res.status_code == 200
        assert settle_res.json()["updated_count"] == 1

        pay_hist = (await client.get(f"/api/v1/expenses/{exp_id}/payments")).json()
        assert len(pay_hist) == 2
        assert pay_hist[1]["payment_type"] == "settlement"
        assert pay_hist[1]["amount"] == 600000.0

        # Batalkan pelunasan -> harus kembali ke DP / Sebagian (Rp 600.000) bukan 0
        undo_res = await client.post(
            "/api/v1/expenses/unpaid/settle",
            json={"expense_ids": [exp_id], "action": "mark_unpaid"},
        )
        assert undo_res.status_code == 200
        exp_after = (await client.get(f"/api/v1/expenses/{exp_id}")).json()
        assert exp_after["pay_status"] == "DP / Sebagian"
        assert exp_after["paid_amount"] == 600000.0
        assert exp_after["remaining_amount"] == 600000.0

    @pytest.mark.asyncio
    async def test_put_update_expense_creates_and_tracks_settlement_record(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji saat transaksi DP diupdate ke Lunas via PUT /expenses/{id}, track record pelunasan wajib tercipta."""
        client.cookies.update(auth_cookies)
        today = date.today()

        # 1. Buat transaksi DP 40% dari 500.000 (DP = 200.000, Sisa = 300.000)
        c_res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Vendor Kemasan",
                "item_name": "Pita Hampers 100 Roll",
                "qty": 1,
                "unit": "Roll",
                "category": "Kemasan",
                "unit_price": 500000,
                "total_price": 500000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_type": "percent",
                "dp_percent": 40,
                "due_date": (today + timedelta(days=14)).isoformat(),
            },
        )
        assert c_res.status_code == 201
        exp_id = c_res.json()["id"]

        # 2. Pelunasan via update PUT /expenses/{id} dengan pay_status="Lunas"
        u_res = await client.put(
            f"/api/v1/expenses/{exp_id}",
            json={
                "pay_status": "Lunas",
                "notes": "Pelunasan pelunasan via edit",
            },
        )
        assert u_res.status_code == 200
        updated_data = u_res.json()
        assert updated_data["pay_status"] == "Lunas"
        assert updated_data["paid_amount"] == 500000.0
        assert updated_data["remaining_amount"] == 0.0
        assert updated_data["payments_count"] == 2

        # 3. Verifikasi track record pembayaran: DP Awal (200rb) dan Pelunasan (300rb)
        pay_res = await client.get(f"/api/v1/expenses/{exp_id}/payments")
        assert pay_res.status_code == 200
        records = pay_res.json()
        assert len(records) == 2
        assert records[0]["payment_type"] == "dp"
        assert records[0]["amount"] == 200000.0
        assert records[1]["payment_type"] == "settlement"
        assert records[1]["amount"] == 300000.0

        # 4. Batalkan status Lunas kembali ke DP via PUT /expenses/{id}
        revert_res = await client.put(
            f"/api/v1/expenses/{exp_id}",
            json={
                "pay_status": "DP / Sebagian",
            },
        )
        assert revert_res.status_code == 200
        rev_data = revert_res.json()
        assert rev_data["pay_status"] == "DP / Sebagian"
        assert rev_data["paid_amount"] == 200000.0
        assert rev_data["remaining_amount"] == 300000.0
        assert rev_data["payments_count"] == 1
        assert rev_data["payments"][0]["payment_type"] == "dp"

    @pytest.mark.asyncio
    async def test_legacy_dp_without_payments_creates_full_track_record_on_settle(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji transaksi legacy yang paid_amount > 0 tapi tanpa row ExpensePayment, saat dilunasi menghasilkan track record lengkap DP + Settlement."""
        client.cookies.update(auth_cookies)
        today = date.today()

        legacy_exp = Expense(
            expense_date=today,
            supplier="Supplier Legacy",
            item_name="Pewarna Makanan Merah",
            qty=Decimal("1"),
            unit="Btl",
            category="Bahan Kue",
            unit_price=Decimal("100000"),
            total_price=Decimal("100000"),
            pay_method="Transfer",
            pay_status="DP / Sebagian",
            paid_amount=Decimal("30000"),
            dp_percent=Decimal("30"),
            due_date=(today + timedelta(days=7)).isoformat(),
        )
        db.add(legacy_exp)
        await db.commit()
        await db.refresh(legacy_exp)

        # Update ke Lunas
        u_res = await client.put(
            f"/api/v1/expenses/{legacy_exp.id}",
            json={"pay_status": "Lunas"},
        )
        assert u_res.status_code == 200
        pay_res = await client.get(f"/api/v1/expenses/{legacy_exp.id}/payments")
        records = pay_res.json()
        assert len(records) == 2
        assert records[0]["payment_type"] == "dp"
        assert records[0]["amount"] == 30000.0
        assert records[1]["payment_type"] == "settlement"
        assert records[1]["amount"] == 70000.0

    @pytest.mark.asyncio
    async def test_cod_track_record_lifecycle(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji track record transaksi COD dari status Belum Lunas hingga dilunasi oleh kasir."""
        client.cookies.update(auth_cookies)
        today = date.today()

        # 1. Catat belanja COD yang belum dibayar (menunggu kurir datang)
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Kurir J&T",
                "item_name": "Lakban Coklat 6 Roll (COD)",
                "qty": 6,
                "unit": "Roll",
                "category": "Kemasan",
                "unit_price": 15000,
                "total_price": 90000,
                "pay_method": "COD",
                "pay_status": "Belum Lunas",
                "notes": "COD menunggu paket tiba di kasir",
            },
        )
        assert res.status_code == 201
        exp = res.json()
        assert exp["pay_method"] == "COD"
        assert exp["pay_status"] == "Belum Lunas"
        assert exp["remaining_amount"] == 90000.0
        assert exp["payments_count"] == 0

        # 2. Kurir tiba, kasir bayar via endpoint settle unpaid
        settle_res = await client.post(
            "/api/v1/expenses/unpaid/settle",
            json={
                "expense_ids": [exp["id"]],
                "action": "mark_paid",
                "pay_method": "Tunai Kasir",
                "notes": "Pelunasan COD (Bayar di Kasir)",
            },
        )
        assert settle_res.status_code == 200
        assert settle_res.json()["updated_count"] == 1

        # 3. Verifikasi track record pembayaran tercatat rapi
        pay_res = await client.get(f"/api/v1/expenses/{exp['id']}/payments")
        assert pay_res.status_code == 200
        payments = pay_res.json()
        assert len(payments) == 1
        assert payments[0]["payment_type"] == "settlement"
        assert payments[0]["amount"] == 90000.0
        assert payments[0]["pay_method"] == "Tunai Kasir"
        assert "COD" in payments[0]["notes"]

    @pytest.mark.asyncio
    async def test_cod_saved_directly_as_lunas_records_track_record(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji transaksi COD yang dicatat langsung Lunas (sudah dibayar saat diinput) otomatis memiliki track record."""
        client.cookies.update(auth_cookies)
        today = date.today()

        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Kurir SiCepat",
                "item_name": "Plastik Bubble Wrap COD",
                "qty": 1,
                "unit": "Roll",
                "category": "Kemasan",
                "unit_price": 120000,
                "total_price": 120000,
                "pay_method": "COD",
                "pay_status": "Lunas",
                "notes": "Sudah dibayar di kasir saat kurir datang",
            },
        )
        assert res.status_code == 201
        exp = res.json()
        assert exp["pay_status"] == "Lunas"
        assert exp["payments_count"] == 1
        assert exp["payments"][0]["payment_type"] == "settlement"
        assert exp["payments"][0]["amount"] == 120000.0

    @pytest.mark.asyncio
    async def test_reimbursement_track_record_lifecycle(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji track record talangan karyawan saat diganti dan saat dibatalkan."""
        client.cookies.update(auth_cookies)
        today = date.today()

        # 1. Catat belanja talangan oleh staf
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Superindo",
                "item_name": "Susu UHT Diamond 1L (Talangan Staf)",
                "qty": 3,
                "unit": "Dus",
                "category": "Bahan Kue",
                "unit_price": 20000,
                "total_price": 60000,
                "pay_method": "Transfer",
                "pay_status": "Lunas",
                "is_reimbursement": True,
            },
        )
        assert res.status_code == 201
        exp = res.json()
        assert exp["is_reimbursement"] is True
        assert exp["reimbursed_at"] is None

        # 2. Owner/Admin ganti uang talangan via /reimbursements/settle
        settle_res = await client.post(
            "/api/v1/expenses/reimbursements/settle",
            json={
                "expense_ids": [exp["id"]],
                "action": "mark_reimbursed",
            },
        )
        assert settle_res.status_code == 200
        assert settle_res.json()["updated_count"] == 1

        # 3. Verifikasi tercatat riwayat pembayaran 'reimbursement'
        pay_res = await client.get(f"/api/v1/expenses/{exp['id']}/payments")
        assert pay_res.status_code == 200
        payments = pay_res.json()
        assert len(payments) == 1
        assert payments[0]["payment_type"] == "reimbursement"
        assert payments[0]["amount"] == 60000.0
        assert "talangan" in payments[0]["notes"].lower()

        # 4. Batalkan penggantian talangan (unmark)
        unmark_res = await client.post(
            "/api/v1/expenses/reimbursements/settle",
            json={
                "expense_ids": [exp["id"]],
                "action": "unmark",
            },
        )
        assert unmark_res.status_code == 200

        # Verifikasi payment reimbursement terhapus bersih
        pay_res2 = await client.get(f"/api/v1/expenses/{exp['id']}/payments")
        assert len(pay_res2.json()) == 0

    @pytest.mark.asyncio
    async def test_termin_hutang_installments_and_settlement(
        self, client, auth_cookies, db: AsyncSession
    ):
        """Uji track record pembayaran bertahap (Termin #1, Termin #2, hingga Pelunasan Akhir) pada hutang supplier."""
        client.cookies.update(auth_cookies)
        today = date.today()

        # 1. Catat invoice hutang / tempo Rp 1.500.000
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Distributor Bahan Segar",
                "item_name": "Strawberry Segar 50 Pack (Invoice Tempo)",
                "qty": 50,
                "unit": "Pack",
                "category": "Bahan Kue",
                "unit_price": 30000,
                "total_price": 1500000,
                "pay_method": "Tempo / Tagihan",
                "pay_status": "Belum Lunas",
                "due_date": (today + timedelta(days=30)).isoformat(),
            },
        )
        assert res.status_code == 201
        exp = res.json()
        exp_id = exp["id"]
        assert exp["paid_amount"] == 0.0
        assert exp["remaining_amount"] == 1500000.0

        # 2. Bayar Termin #1 sebesar Rp 500.000
        t1_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "amount": 500000,
                "payment_type": "installment",
                "pay_method": "Transfer",
                "notes": "Pembayaran Termin #1",
            },
        )
        assert t1_res.status_code == 200
        d_t1 = t1_res.json()
        assert d_t1["paid_amount"] == 500000.0
        assert d_t1["remaining_amount"] == 1000000.0
        assert d_t1["payments_count"] == 1

        # 3. Bayar Termin #2 sebesar Rp 500.000
        t2_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "amount": 500000,
                "payment_type": "installment",
                "pay_method": "Transfer",
                "notes": "Pembayaran Termin #2",
            },
        )
        assert t2_res.status_code == 200
        d_t2 = t2_res.json()
        assert d_t2["paid_amount"] == 1000000.0
        assert d_t2["remaining_amount"] == 500000.0
        assert d_t2["payments_count"] == 2

        # 4. Pelunasan sisa tagihan (Termin Akhir / Settlement Rp 500.000)
        t3_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "settle_full": True,
                "pay_method": "Transfer",
                "notes": "Pelunasan Akhir (Termin Selesai)",
            },
        )
        assert t3_res.status_code == 200
        d_t3 = t3_res.json()
        assert d_t3["pay_status"] == "Lunas"
        assert d_t3["paid_amount"] == 1500000.0
        assert d_t3["remaining_amount"] == 0.0
        assert d_t3["payments_count"] == 3

        # 5. Cek urutan track record lengkap
        pay_res = await client.get(f"/api/v1/expenses/{exp_id}/payments")
        records = pay_res.json()
        assert len(records) == 3
        assert records[0]["payment_type"] == "installment"
        assert records[0]["amount"] == 500000.0
        assert "Termin #1" in records[0]["notes"]

        assert records[1]["payment_type"] == "installment"
        assert records[1]["amount"] == 500000.0
        assert "Termin #2" in records[1]["notes"]

        assert records[2]["payment_type"] == "settlement"
        assert records[2]["amount"] == 500000.0
        assert "Pelunasan" in records[2]["notes"]


class TestCashflowIntegration:
    """Verifikasi konektivitas real-time antara pembayaran (COD, Talangan, Termin, DP) dan Arus Kas / Rekening."""

    @pytest.mark.asyncio
    async def test_cod_payment_connection_to_cashflow(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        today = date.today()

        # Rekening Kas Tunai Kasir
        kas = BankAccount(
            name="Kas Tunai Kasir",
            bank_name="Kasir",
            account_type="cash",
            account_code="1-1110",
            opening_balance=Decimal("1000000"),
            channel_mappings='["tunai", "cash", "kasir", "cod"]',
            is_active=True,
            is_default=True,
        )
        db.add(kas)
        await db.commit()
        await db.refresh(kas)

        # 1. Catat belanja COD Belum Bayar Rp 250.000
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "Toko Bahan Kue",
                "item_name": "Keju Cheddar 2kg COD",
                "qty": 1,
                "unit": "Pcs",
                "category": "Bahan Baku",
                "unit_price": 250000,
                "total_price": 250000,
                "pay_method": "COD",
                "pay_status": "Belum Lunas",
                "notes": "Bayar nanti di kasir saat paket sampai",
            },
        )
        assert res.status_code == 201
        exp_id = res.json()["id"]

        # Sebelum pelunasan: saldo kas belum berkurang, tapi hutang tercatat
        accounts_before = await list_bank_accounts(db)
        kas_before = next(a for a in accounts_before if a["id"] == kas.id)
        assert kas_before["total_expenses"] == 0.0
        assert kas_before["estimated_balance"] == 1000000.0

        rep_before = await get_accounting_report(db, today.year, today.month)
        pos_before = next(r for r in rep_before["neraca"]["rekening_positions"] if r["id"] == kas.id)
        assert pos_before["outgoing_month"] == 0.0
        assert pos_before["estimated_balance"] == 1000000.0
        assert rep_before["neraca"]["subtotal_kewajiban"] >= 250000.0

        # 2. Pelunasan COD di kasir
        settle_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "settle_full": True,
                "pay_method": "Tunai Kasir",
                "notes": "Pelunasan COD (Bayar di Kasir)",
            },
        )
        assert settle_res.status_code == 200

        # Sesudah pelunasan: saldo kas berkurang Rp 250.000
        accounts_after = await list_bank_accounts(db)
        kas_after = next(a for a in accounts_after if a["id"] == kas.id)
        assert kas_after["total_expenses"] == 250000.0
        assert kas_after["estimated_balance"] == 750000.0

        rep_after = await get_accounting_report(db, today.year, today.month)
        pos_after = next(r for r in rep_after["neraca"]["rekening_positions"] if r["id"] == kas.id)
        assert pos_after["outgoing_month"] == 250000.0
        assert pos_after["estimated_balance"] == 750000.0

        # Arus kas riil dan distribusi metode bayar
        assert rep_after["arus_kas"]["total_kas_keluar_riil"] >= 250000.0

    @pytest.mark.asyncio
    async def test_talangan_reimbursement_connection_to_cashflow(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        today = date.today()

        bank = BankAccount(
            name="BCA Operasional",
            bank_name="BCA",
            account_type="bank",
            account_code="1-1120",
            opening_balance=Decimal("5000000"),
            channel_mappings='["transfer", "bca"]',
            is_active=True,
            is_default=True,
        )
        db.add(bank)
        await db.commit()
        await db.refresh(bank)

        # 1. Catat belanja ditalangi karyawan Rp 400.000
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "SPBU Pertamina",
                "item_name": "Bensin Pengiriman Talangan Budi",
                "qty": 1,
                "unit": "Pcs",
                "category": "Operasional",
                "unit_price": 400000,
                "total_price": 400000,
                "pay_method": "Transfer",
                "pay_status": "Lunas",
                "is_reimbursement": True,
                "notes": "Ditalangi Budi operasional",
            },
        )
        assert res.status_code == 201
        exp_id = res.json()["id"]

        # Belum diganti: Neraca kewajiban mencatat hutang talangan Rp 400.000
        rep_unreimb = await get_accounting_report(db, today.year, today.month)
        assert rep_unreimb["neraca"]["kewajiban_lancar"][1]["nominal"] == 400000.0

        # Saldo bank belum berkurang
        accs_before = await list_bank_accounts(db)
        b_before = next(a for a in accs_before if a["id"] == bank.id)
        assert b_before["total_expenses"] == 0.0
        assert b_before["estimated_balance"] == 5000000.0

        # 2. Ganti uang talangan via settle_reimbursements
        settle_res = await client.post(
            "/api/v1/expenses/reimbursements/settle",
            json={
                "expense_ids": [exp_id],
                "action": "mark_reimbursed",
            },
        )
        assert settle_res.status_code == 200
        assert settle_res.json()["updated_count"] == 1

        # Sesudah diganti: hutang talangan menjadi Rp 0 dan saldo bank berkurang Rp 400.000
        rep_reimb = await get_accounting_report(db, today.year, today.month)
        assert rep_reimb["neraca"]["kewajiban_lancar"][1]["nominal"] == 0.0
        pos_reimb = next(r for r in rep_reimb["neraca"]["rekening_positions"] if r["id"] == bank.id)
        assert pos_reimb["outgoing_month"] == 400000.0
        assert pos_reimb["estimated_balance"] == 4600000.0

        accs_after = await list_bank_accounts(db)
        b_after = next(a for a in accs_after if a["id"] == bank.id)
        assert b_after["total_expenses"] == 400000.0
        assert b_after["estimated_balance"] == 4600000.0

    @pytest.mark.asyncio
    async def test_termin_installments_connection_to_cashflow(self, client, auth_cookies, db: AsyncSession):
        client.cookies.update(auth_cookies)
        today = date.today()

        bank = BankAccount(
            name="Bank Mandiri",
            bank_name="Mandiri",
            account_type="bank",
            account_code="1-1120",
            opening_balance=Decimal("20000000"),
            channel_mappings='["transfer", "mandiri"]',
            is_active=True,
            is_default=True,
        )
        db.add(bank)
        await db.commit()
        await db.refresh(bank)

        # 1. Invoice tempo Rp 6.000.000 dengan DP 20% (Rp 1.200.000)
        res = await client.post(
            "/api/v1/expenses",
            json={
                "expense_date": today.isoformat(),
                "supplier": "PT Kemasan Sentosa",
                "item_name": "Dus Kue 1000pcs",
                "qty": 1,
                "unit": "Pcs",
                "category": "Kemasan",
                "unit_price": 6000000,
                "total_price": 6000000,
                "pay_method": "Transfer",
                "pay_status": "DP / Sebagian",
                "dp_percent": 20,
                "due_date": (today + timedelta(days=30)).isoformat(),
                "bank_account_id": bank.id,
            },
        )
        assert res.status_code == 201
        exp_id = res.json()["id"]

        # DP Rp 1.200.000 memotong rekening, sisa hutang Rp 4.800.000
        accs_dp = await list_bank_accounts(db)
        b_dp = next(a for a in accs_dp if a["id"] == bank.id)
        assert b_dp["total_expenses"] == 1200000.0
        assert b_dp["estimated_balance"] == 18800000.0

        rep_dp = await get_accounting_report(db, today.year, today.month)
        assert rep_dp["neraca"]["subtotal_kewajiban"] >= 4800000.0

        # 2. Bayar Termin #1 Rp 2.000.000
        t1_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "amount": 2000000,
                "payment_type": "installment",
                "pay_method": "Transfer",
                "notes": "Pembayaran Termin #1",
            },
        )
        assert t1_res.status_code == 200

        # Pengeluaran rekening bertambah menjadi Rp 3.200.000 (DP + Termin 1)
        accs_t1 = await list_bank_accounts(db)
        b_t1 = next(a for a in accs_t1 if a["id"] == bank.id)
        assert b_t1["total_expenses"] == 3200000.0
        assert b_t1["estimated_balance"] == 16800000.0

        # 3. Pelunasan Akhir Rp 2.800.000
        t2_res = await client.post(
            f"/api/v1/expenses/{exp_id}/payments",
            json={
                "settle_full": True,
                "pay_method": "Transfer",
                "notes": "Pelunasan Akhir (Termin)",
            },
        )
        assert t2_res.status_code == 200
        assert t2_res.json()["pay_status"] == "Lunas"

        # Rekening terpotong total Rp 6.000.000 penuh dan hutang selesai
        accs_final = await list_bank_accounts(db)
        b_final = next(a for a in accs_final if a["id"] == bank.id)
        assert b_final["total_expenses"] == 6000000.0
        assert b_final["estimated_balance"] == 14000000.0

        rep_final = await get_accounting_report(db, today.year, today.month)
        pos_final = next(r for r in rep_final["neraca"]["rekening_positions"] if r["id"] == bank.id)
        assert pos_final["outgoing_month"] == 6000000.0
        assert pos_final["estimated_balance"] == 14000000.0
