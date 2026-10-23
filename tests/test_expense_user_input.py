import pytest
from datetime import date
from decimal import Decimal
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool
from app.database.connection import Base
from app.models.expense import Expense
from app.models.user import User
from app.services.expense_service import (
    get_all_expenses_paginated,
    get_all_expense_users,
    save_expenses,
    update_expense,
)
from app.api.expenses import _to_response_dict


@pytest.fixture
async def async_db():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.mark.asyncio
async def test_expense_user_response_and_filtering(async_db: AsyncSession):
    # 1. Buat user
    user1 = User(id=1, telegram_id=111, name="Taufik Maulana", is_auth=True)
    user2 = User(id=2, telegram_id=222, name="Asti Fauzia", is_auth=True)
    async_db.add_all([user1, user2])
    await async_db.commit()

    # 2. Buat expense dengan user_id
    exp1 = Expense(
        expense_date=date.today(),
        supplier="Toko Bahan Kue",
        item_name="Tepung Terigu Cakra Kembar",
        qty=Decimal("5"),
        unit="Kg",
        unit_price=Decimal("15000"),
        total_price=Decimal("75000"),
        user_id=1,
        invoice_number="INV-001",
    )
    exp2 = Expense(
        expense_date=date.today(),
        supplier="Supermarket Bahan",
        item_name="Mentega Wijsman",
        qty=Decimal("2"),
        unit="Kaleng",
        unit_price=Decimal("120000"),
        total_price=Decimal("240000"),
        user_id=2,
        invoice_number="INV-002",
    )
    exp3 = Expense(
        expense_date=date.today(),
        supplier="Pasar Tradisional",
        item_name="Gula Pasir",
        qty=Decimal("10"),
        unit="Kg",
        unit_price=Decimal("17000"),
        total_price=Decimal("170000"),
        user_id=None,
        invoice_number="-",
    )
    async_db.add_all([exp1, exp2, exp3])
    await async_db.commit()

    # 3. Test list users
    users = await get_all_expense_users(async_db)
    assert len(users) == 2
    assert {u.name for u in users} == {"Taufik Maulana", "Asti Fauzia"}

    # 4. Test paginated expenses dengan load user
    expenses, total = await get_all_expenses_paginated(async_db, page=1, per_page=10)
    assert total == 3

    # Cari exp1 dan periksa response dict
    found_exp1 = next(e for e in expenses if e.invoice_number == "INV-001")
    d1 = _to_response_dict(found_exp1)
    assert d1["user_id"] == 1
    assert d1["user_name"] == "Taufik Maulana"

    found_exp2 = next(e for e in expenses if e.invoice_number == "INV-002")
    d2 = _to_response_dict(found_exp2)
    assert d2["user_id"] == 2
    assert d2["user_name"] == "Asti Fauzia"

    found_exp3 = next(e for e in expenses if e.invoice_number == "-")
    d3 = _to_response_dict(found_exp3)
    assert d3["user_id"] is None
    assert d3["user_name"] is None

    # 5. Test filter by user_id
    filtered, total_user1 = await get_all_expenses_paginated(async_db, user_id=1)
    assert total_user1 == 1
    assert filtered[0].item_name == "Tepung Terigu Cakra Kembar"

    # 6. Test search by user name
    searched, total_search = await get_all_expenses_paginated(async_db, search="Asti")
    assert total_search == 1
    assert searched[0].item_name == "Mentega Wijsman"

    # 7. Test update expense user_id
    updated = await update_expense(async_db, found_exp3.id, {"user_id": 1})
    await async_db.commit()
    await async_db.refresh(updated, ["user"])
    d_updated = _to_response_dict(updated)
    assert d_updated["user_id"] == 1
    assert d_updated["user_name"] == "Taufik Maulana"
