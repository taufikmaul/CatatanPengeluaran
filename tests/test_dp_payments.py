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
