"""
tests/test_grouped_invoices.py - Integration tests for Smart Invoice Grouping Option B,
GET /api/v1/expenses/grouped pagination/filtering, and POST /api/v1/expenses/unpaid/payment.
"""
from datetime import date, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bank_account import BankAccount
from app.models.expense import Expense
from app.services.expense_service import (
    _compute_invoice_group_key,
    batch_insert_expenses,
    save_expenses,
)


class TestSmartInvoiceGroupingRules:
    def test_group_key_priority_and_exclusions(self):
        # Priority 1: Non-placeholder invoice_number + date + normalized supplier
        e_inv_a = Expense(
            id=1,
            expense_date=date(2026, 11, 10),
            supplier="PT Toko Kue ",
            item_name="Tepung",
            total_price=Decimal("50000"),
            invoice_number="INV-2026-001",
            invoice_group_id="grp-unused",
            msg_link="https://t.me/c/100/200",
        )
        e_inv_b = Expense(
            id=2,
            expense_date=date(2026, 11, 10),
            supplier="pt toko kue",
            item_name="Gula",
            total_price=Decimal("30000"),
            invoice_number="inv-2026-001",
            msg_link="Web Dashboard",
        )
        assert _compute_invoice_group_key(e_inv_a) == _compute_invoice_group_key(e_inv_b)
        assert _compute_invoice_group_key(e_inv_a).startswith("inv:")

        # Different dates with placeholder invoice "-" must NOT group via Priority 1
        e_placeholder = Expense(
            id=3,
            expense_date=date(2026, 11, 10),
            supplier="PT Toko Kue",
            item_name="Susu",
            total_price=Decimal("25000"),
            invoice_number="-",
            invoice_group_id="batch-abc123",
            msg_link="https://t.me/c/100/999",
        )
        assert _compute_invoice_group_key(e_placeholder) == "grp:batch-abc123"

        # Priority 3: Specific Telegram message link fallback for historical rows
        e_tg = Expense(
            id=4,
            expense_date=date(2026, 11, 10),
            supplier="Toko Online",
            item_name="Coklat",
            total_price=Decimal("40000"),
            invoice_number="N/A",
            invoice_group_id=None,
            msg_link="https://t.me/c/123456/789",
        )
        e_tg_2 = Expense(
            id=6,
            expense_date=date(2026, 11, 10),
            supplier="toko online ",
            item_name="Selai",
            total_price=Decimal("25000"),
            invoice_number="-",
            invoice_group_id=None,
            msg_link="https://t.me/c/123456/789",
        )
        assert _compute_invoice_group_key(e_tg) == "tg:https://t.me/c/123456/789|2026-11-10|toko online"
        assert _compute_invoice_group_key(e_tg) == _compute_invoice_group_key(e_tg_2)

        # Priority 4: Non-specific links stay single
        for generic_link in ["tg://user?id=12345", "Private Chat", "Web Dashboard", "Import CSV", "-"]:
            e_single = Expense(
                id=5,
                expense_date=date(2026, 11, 10),
                supplier="Toko Online",
                item_name="Keju",
                total_price=Decimal("40000"),
                invoice_number="-",
                invoice_group_id=None,
                msg_link=generic_link,
            )
            assert _compute_invoice_group_key(e_single) == "single:5"

    @pytest.mark.asyncio
    async def test_batch_endpoint_and_save_expenses_assign_group_ids_while_csv_does_not(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)

        # 1. POST /expenses/batch with 2 regular items & no invoice_number -> auto invoice_group_id
        batch_payload = {
            "items": [
                {
                    "expense_date": "2026-11-12",
                    "supplier": "Toko Kemasan",
                    "item_name": "Box Kue 20x20",
                    "qty": 10,
                    "unit": "Pcs",
                    "category": "Kemasan",
                    "unit_price": 5000,
                    "shipping_fee": 15000,
                    "tax": 5500,
                    "other_fee": 2000,
                    "discount": 2500,
                    "total_price": 70000,
                    "pay_method": "Transfer",
                    "pay_status": "Lunas",
                },
                {
                    "expense_date": "2026-11-12",
                    "supplier": "Toko Kemasan",
                    "item_name": "Pita Satin",
                    "qty": 2,
                    "unit": "Roll",
                    "category": "Kemasan",
                    "unit_price": 15000,
                    "total_price": 30000,
                    "pay_method": "Transfer",
                    "pay_status": "Lunas",
                },
            ]
        }
        res = await client.post("/api/v1/expenses/batch", json=batch_payload)
        assert res.status_code == 201, res.text
        created_batch = res.json()
        assert len(created_batch) == 2
        assert created_batch[0]["invoice_group_id"]
        assert created_batch[0]["invoice_group_id"] == created_batch[1]["invoice_group_id"]

        # 2. save_expenses with 2 Telegram/chat items (Private Chat, no invoice_number) -> auto group id
        chat_items = await save_expenses(
            db,
            items=[
                {
                    "tanggal": "2026-11-13",
                    "toko_supplier": "Pasar Besar",
                    "barang": "Telur Ayam",
                    "qty": 5,
                    "unit": "Kg",
                    "kategori": "Bahan Kue",
                    "harga_satuan": 28000,
                    "total_harga": 140000,
                },
                {
                    "tanggal": "2026-11-13",
                    "toko_supplier": "Pasar Besar",
                    "barang": "Mentega",
                    "qty": 2,
                    "unit": "Kg",
                    "kategori": "Bahan Kue",
                    "harga_satuan": 35000,
                    "total_harga": 70000,
                },
            ],
            msg_link="Private Chat",
        )
        assert len(chat_items) == 2
        assert chat_items[0].invoice_group_id is not None
        assert chat_items[0].invoice_group_id == chat_items[1].invoice_group_id

        # 3. CSV import path (assign_group_ids=False default) must NOT assign invoice_group_id
        csv_items = await batch_insert_expenses(
            db,
            items=[
                {
                    "expense_date": "2026-11-14",
                    "supplier": "Supplier A",
                    "item_name": "Kopi",
                    "qty": 1,
                    "unit_price": 20000,
                    "total_price": 20000,
                    "msg_link": "Import CSV",
                },
                {
                    "expense_date": "2026-11-14",
                    "supplier": "Supplier B",
                    "item_name": "Teh",
                    "qty": 1,
                    "unit_price": 15000,
                    "total_price": 15000,
                    "msg_link": "Import CSV",
                },
            ],
        )
        assert len(csv_items) == 2
        assert csv_items[0].invoice_group_id is None
        assert csv_items[1].invoice_group_id is None

        await db.commit()

        # Verify grouped endpoint aggregates fees/discount & items cleanly
        grouped_res = await client.get("/api/v1/expenses/grouped?page=1&per_page=10&month=11&year=2026")
        assert grouped_res.status_code == 200, grouped_res.text
        payload = grouped_res.json()
        # Expected 4 groups: batch(2), save_expenses(2), csv1(1), csv2(1)
        assert payload["total"] == 4
        assert payload["total_items"] == 6

        kemasan_group = next(g for g in payload["data"] if g["supplier"] == "Toko Kemasan")
        assert kemasan_group["is_grouped"] is True
        assert kemasan_group["items_count"] == 2
        assert kemasan_group["subtotal_items"] == 80000.0  # 10*5000 + 2*15000
        assert kemasan_group["shipping_fee"] == 15000.0
        assert kemasan_group["tax"] == 5500.0
        assert kemasan_group["other_fee"] == 2000.0
        assert kemasan_group["discount"] == 2500.0
        assert kemasan_group["total_amount"] == 100000.0  # 70000 + 30000


class TestGroupedPaginationFilteringAndPayment:
    @pytest.mark.asyncio
    async def test_pagination_does_not_split_groups_and_retains_siblings_on_search(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        # Seed 3 items in Invoice A + 1 item in Invoice B
        e1 = Expense(
            expense_date=date(2026, 11, 20),
            supplier="Toko Kue A",
            item_name="Terigu Protein Tinggi",
            qty=Decimal("2"),
            unit_price=Decimal("15000"),
            total_price=Decimal("30000"),
            invoice_number="INV-SPLIT-1",
            pay_method="Transfer",
            pay_status="Lunas",
        )
        e2 = Expense(
            expense_date=date(2026, 11, 20),
            supplier="Toko Kue A",
            item_name="Mentega Anchor",
            qty=Decimal("1"),
            unit_price=Decimal("60000"),
            total_price=Decimal("60000"),
            invoice_number="INV-SPLIT-1",
            pay_method="Transfer",
            pay_status="Lunas",
        )
        e3 = Expense(
            expense_date=date(2026, 11, 20),
            supplier="Toko Kue A",
            item_name="Vanilla Essence",
            qty=Decimal("1"),
            unit_price=Decimal("20000"),
            total_price=Decimal("20000"),
            invoice_number="INV-SPLIT-1",
            pay_method="Transfer",
            pay_status="Lunas",
        )
        e4 = Expense(
            expense_date=date(2026, 11, 18),
            supplier="Toko B",
            item_name="Kardus Polos",
            qty=Decimal("5"),
            unit_price=Decimal("4000"),
            total_price=Decimal("20000"),
            invoice_number="INV-SPLIT-2",
            pay_method="Tunai",
            pay_status="Lunas",
        )
        db.add_all([e1, e2, e3, e4])
        await db.commit()

        # Page 1 with per_page=1 must hold ALL 3 items of INV-SPLIT-1 together
        p1 = await client.get("/api/v1/expenses/grouped?page=1&per_page=1&month=11&year=2026")
        assert p1.status_code == 200
        j1 = p1.json()
        assert j1["total"] == 2
        assert j1["total_items"] == 4
        assert len(j1["data"]) == 1
        assert j1["data"][0]["invoice_number"] == "INV-SPLIT-1"
        assert j1["data"][0]["items_count"] == 3
        assert j1["data"][0]["total_amount"] == 110000.0

        # Page 2 holds INV-SPLIT-2
        p2 = await client.get("/api/v1/expenses/grouped?page=2&per_page=1&month=11&year=2026")
        assert p2.status_code == 200
        j2 = p2.json()
        assert len(j2["data"]) == 1
        assert j2["data"][0]["invoice_number"] == "INV-SPLIT-2"

        # Searching "Mentega" retains all 3 siblings of INV-SPLIT-1 while marking matched_items_count=1
        s_res = await client.get("/api/v1/expenses/grouped?search=Mentega&month=11&year=2026")
        assert s_res.status_code == 200
        sj = s_res.json()
        assert sj["total"] == 1
        assert sj["data"][0]["items_count"] == 3
        assert sj["data"][0]["matched_items_count"] == 1
        assert sj["data"][0]["total_amount"] == 110000.0

    @pytest.mark.asyncio
    async def test_unpaid_due_urgency_sorting_and_invoice_level_dp_settlement(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        bank = BankAccount(
            name="BCA Giro",
            bank_name="BCA",
            account_type="bank",
            account_code="1-1125",
            opening_balance=Decimal("5000000"),
            is_active=True,
        )
        db.add(bank)
        await db.commit()
        await db.refresh(bank)

        overdue_str = (date.today() - timedelta(days=3)).isoformat()
        soon_str = (date.today() + timedelta(days=2)).isoformat()

        # Create multi-item unpaid invoice (overdue): 100k + 200k = 300k
        item_a = Expense(
            expense_date=date.today(),
            supplier="PT Bahan Utama",
            item_name="Tepung Cakra 25kg",
            qty=Decimal("1"),
            unit_price=Decimal("100000"),
            total_price=Decimal("100000"),
            pay_method="Tempo / Belum Lunas",
            pay_status="Belum Lunas",
            due_date=overdue_str,
            invoice_number="INV-UNPAID-1",
        )
        item_b = Expense(
            expense_date=date.today(),
            supplier="PT Bahan Utama",
            item_name="Margarin Karton",
            qty=Decimal("1"),
            unit_price=Decimal("200000"),
            total_price=Decimal("200000"),
            pay_method="Tempo / Belum Lunas",
            pay_status="Belum Lunas",
            due_date=overdue_str,
            invoice_number="INV-UNPAID-1",
        )
        # Create second unpaid invoice due soon: 150k
        item_soon = Expense(
            expense_date=date.today(),
            supplier="PT Plastik Jaya",
            item_name="Plastik OPP",
            qty=Decimal("1"),
            unit_price=Decimal("150000"),
            total_price=Decimal("150000"),
            pay_method="Tempo / Belum Lunas",
            pay_status="Belum Lunas",
            due_date=soon_str,
            invoice_number="INV-UNPAID-2",
        )
        db.add_all([item_a, item_b, item_soon])
        await db.commit()
        await db.refresh(item_a)
        await db.refresh(item_b)

        # Verify due_urgency filtering
        res_overdue = await client.get("/api/v1/expenses/grouped?special_type=unpaid&due_urgency=overdue")
        assert res_overdue.status_code == 200
        ov = res_overdue.json()
        assert ov["total"] == 1
        assert ov["data"][0]["invoice_number"] == "INV-UNPAID-1"

        res_soon = await client.get("/api/v1/expenses/grouped?special_type=unpaid&due_urgency=soon")
        assert res_soon.status_code == 200
        sn = res_soon.json()
        assert sn["total"] == 1
        assert sn["data"][0]["invoice_number"] == "INV-UNPAID-2"

        # 1. Invoice-level 40% DP across [item_a, item_b] -> total DP = 120,000 (40k + 80k)
        dp_res = await client.post(
            "/api/v1/expenses/unpaid/payment",
            json={
                "expense_ids": [item_a.id, item_b.id],
                "dp_percent": 40,
                "payment_type": "dp",
                "pay_method": "Transfer",
                "bank_account_id": bank.id,
                "notes": "DP 40% PO",
            },
        )
        assert dp_res.status_code == 200, dp_res.text
        updated = dp_res.json()
        assert len(updated) == 2
        paid_map = {x["id"]: x["paid_amount"] for x in updated}
        assert paid_map[item_a.id] == 40000.0
        assert paid_map[item_b.id] == 80000.0
        assert all(x["pay_status"] == "DP / Sebagian" for x in updated)

        # Verify grouped totals after 40% DP
        g_after_dp = await client.get("/api/v1/expenses/grouped?special_type=unpaid&due_urgency=overdue")
        assert g_after_dp.status_code == 200
        grp = g_after_dp.json()["data"][0]
        assert grp["paid_amount"] == 120000.0
        assert grp["remaining_amount"] == 180000.0
        assert grp["pay_status"] == "DP / Sebagian"

        # 2. Custom termin payment of Rp 90,000 -> total paid becomes 210,000 (remaining 90,000)
        term_res = await client.post(
            "/api/v1/expenses/unpaid/payment",
            json={
                "expense_ids": [item_a.id, item_b.id],
                "amount": 90000,
                "payment_type": "termin",
                "pay_method": "Transfer",
                "bank_account_id": bank.id,
                "notes": "Termin ke-2",
            },
        )
        assert term_res.status_code == 200, term_res.text
        term_updated = term_res.json()
        assert sum(x["paid_amount"] for x in term_updated) == pytest.approx(210000.0, abs=1.0)
        assert sum(x["remaining_amount"] for x in term_updated) == pytest.approx(90000.0, abs=1.0)

        # 3. Full invoice settlement
        settle_res = await client.post(
            "/api/v1/expenses/unpaid/payment",
            json={
                "expense_ids": [item_a.id, item_b.id],
                "settle_full": True,
                "payment_type": "pelunasan",
                "pay_method": "Transfer",
                "bank_account_id": bank.id,
            },
        )
        assert settle_res.status_code == 200, settle_res.text
        settled = settle_res.json()
        assert all(x["pay_status"] == "Lunas" for x in settled)
        assert all(x["remaining_amount"] == 0.0 for x in settled)

        # Overdue unpaid list should now be empty!
        ov_empty = await client.get("/api/v1/expenses/grouped?special_type=unpaid&due_urgency=overdue")
        assert ov_empty.status_code == 200
        assert ov_empty.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_talangan_partial_reimbursement_and_ongkir_scoping(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)

        # Invoice talangan with 2 items sharing invoice_group_id: 1 Belanja + 1 Ongkir, 1 reimbursed, 1 pending
        t1 = Expense(
            expense_date=date(2026, 11, 21),
            supplier="Toko Bahan X",
            item_name="Whipping Cream",
            category="Bahan Kue",
            qty=Decimal("1"),
            unit_price=Decimal("85000"),
            total_price=Decimal("85000"),
            is_reimbursement=True,
            reimbursed_at=date(2026, 11, 22),
            invoice_group_id="tal-grp-1",
        )
        t2 = Expense(
            expense_date=date(2026, 11, 21),
            supplier="GoSend",
            item_name="Ongkir Kirim Bahan",
            category="Ongkir",
            qty=Decimal("1"),
            unit_price=Decimal("25000"),
            total_price=Decimal("25000"),
            is_reimbursement=True,
            reimbursed_at=None,
            invoice_group_id="tal-grp-1",
        )
        # Non-reimbursement item with same group_id should NOT leak into talangan grouped view
        t_non_reimb = Expense(
            expense_date=date(2026, 11, 21),
            supplier="Toko Bahan X",
            item_name="Item Kantor Non-Talangan",
            category="Operasional",
            qty=Decimal("1"),
            unit_price=Decimal("50000"),
            total_price=Decimal("50000"),
            is_reimbursement=False,
            invoice_group_id="tal-grp-1",
        )
        db.add_all([t1, t2, t_non_reimb])
        await db.commit()

        res = await client.get(
            "/api/v1/expenses/grouped?special_type=talangan&is_reimbursement=true&include_ongkir=true&talangan_type=all&reimbursed_status=pending"
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["total"] == 1
        grp = data["data"][0]
        assert grp["items_count"] == 2
        assert grp["reimbursed_status"] == "partial"
        assert grp["reimbursed_count"] == 1
        assert grp["reimbursement_pending_count"] == 1
        assert grp["reimbursement_pending_total"] == 25000.0
        assert all(item["is_reimbursement"] is True for item in grp["items"])

        # Belanja-only filter excludes Ongkir item
        res_belanja = await client.get(
            "/api/v1/expenses/grouped?special_type=talangan&is_reimbursement=true&include_ongkir=false&talangan_type=belanja"
        )
        assert res_belanja.status_code == 200
        b_data = res_belanja.json()
        assert b_data["total"] == 1
        assert b_data["data"][0]["items_count"] == 1
        assert b_data["data"][0]["items"][0]["item_name"] == "Whipping Cream"

    @pytest.mark.asyncio
    async def test_batch_create_multi_item_invoice_with_dp_and_bank_account(
        self, client, auth_cookies, db: AsyncSession
    ):
        client.cookies.update(auth_cookies)
        bank = BankAccount(
            name="Mandiri Operasional",
            bank_name="Mandiri",
            account_type="bank",
            account_code="1-1128",
            opening_balance=Decimal("8000000"),
            is_active=True,
        )
        db.add(bank)
        await db.commit()
        await db.refresh(bank)

        due_str = (date.today() + timedelta(days=10)).isoformat()
        dp_date_str = (date.today() - timedelta(days=1)).isoformat()

        # Submit 1 nota multi-item (tanpa no_invoice) dengan DP 50% (Rp 150.000 dari Rp 300.000)
        res = await client.post(
            "/api/v1/expenses/batch",
            json={
                "items": [
                    {
                        "expense_date": date.today().isoformat(),
                        "supplier": "Toko Kemasan Sentosa",
                        "item_name": "Kardus Kue 22cm",
                        "qty": 10,
                        "unit": "Pcs",
                        "category": "Kemasan",
                        "unit_price": 15000,
                        "shipping_fee": 20000,
                        "tax": 0,
                        "other_fee": 0,
                        "discount": 10000,
                        "total_price": 160000,
                        "pay_method": "Transfer",
                        "pay_status": "DP / Sebagian",
                        "due_date": due_str,
                        "paid_amount": 80000,
                        "dp_type": "percent",
                        "dp_percent": 50,
                        "dp_payment_date": dp_date_str,
                        "bank_account_id": bank.id,
                        "invoice_number": "-",
                    },
                    {
                        "expense_date": date.today().isoformat(),
                        "supplier": "Toko Kemasan Sentosa",
                        "item_name": "Pita Emas",
                        "qty": 7,
                        "unit": "Roll",
                        "category": "Kemasan",
                        "unit_price": 20000,
                        "total_price": 140000,
                        "pay_method": "Transfer",
                        "pay_status": "DP / Sebagian",
                        "due_date": due_str,
                        "paid_amount": 70000,
                        "dp_type": "percent",
                        "dp_percent": 50,
                        "dp_payment_date": dp_date_str,
                        "bank_account_id": bank.id,
                        "invoice_number": "-",
                    },
                ]
            },
        )
        assert res.status_code == 201, res.text
        created = res.json()
        assert len(created) == 2
        assert created[0]["invoice_group_id"]
        assert created[0]["invoice_group_id"] == created[1]["invoice_group_id"]
        assert created[0]["pay_status"] == "DP / Sebagian"
        assert created[1]["pay_status"] == "DP / Sebagian"
        assert created[0]["paid_amount"] == 80000.0
        assert created[1]["paid_amount"] == 70000.0
        assert created[0]["payments_count"] == 1
        assert created[1]["payments_count"] == 1
        assert created[0]["payments"][0]["payment_date"] == dp_date_str
        assert created[0]["payments"][0]["bank_account_id"] == bank.id

        # Verifikasi pada endpoint grouped unpaid
        g_res = await client.get("/api/v1/expenses/grouped?special_type=unpaid&status=DP%20%2F%20Sebagian")
        assert g_res.status_code == 200, g_res.text
        g_data = g_res.json()
        assert g_data["total"] == 1
        grp = g_data["data"][0]
        assert grp["items_count"] == 2
        assert grp["total_amount"] == 300000.0
        assert grp["paid_amount"] == 150000.0
        assert grp["remaining_amount"] == 150000.0
        assert grp["is_dp"] is True
        assert grp["pay_status"] == "DP / Sebagian"
        assert grp["shipping_fee"] == 20000.0
        assert grp["discount"] == 10000.0
