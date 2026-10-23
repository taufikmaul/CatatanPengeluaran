import pytest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool
from app.database.connection import Base
from app.models.expense import Expense
from app.models.user import User
from app.services.telegram_sync_service import (
    parse_telegram_msg_link,
    sync_telegram_users_from_links,
)


def test_parse_telegram_msg_link():
    # Supergroup with thread
    chat_id, msg_id = parse_telegram_msg_link("https://t.me/c/3586832862/7/3499")
    assert chat_id == -1003586832862
    assert msg_id == 3499

    # Supergroup without thread
    chat_id, msg_id = parse_telegram_msg_link("https://t.me/c/3586832862/1234")
    assert chat_id == -1003586832862
    assert msg_id == 1234

    # Public channel
    chat_id, msg_id = parse_telegram_msg_link("https://t.me/mychannel/567")
    assert chat_id == "@mychannel"
    assert msg_id == 567

    # Non-telegram link
    chat_id, msg_id = parse_telegram_msg_link("Web Dashboard")
    assert chat_id is None
    assert msg_id is None


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
async def test_sync_telegram_users_service(async_db: AsyncSession):
    # Setup admin user
    admin = User(telegram_id=115334079, name="Admin Taufik", is_auth=True)
    async_db.add(admin)
    await async_db.commit()

    # Setup expense with msg_link but no user_id
    exp = Expense(
        expense_date=date.today(),
        supplier="Toko A",
        item_name="Coklat Bubuk",
        qty=Decimal("1"),
        unit="Kg",
        unit_price=Decimal("50000"),
        total_price=Decimal("50000"),
        user_id=None,
        msg_link="https://t.me/c/3586832862/7/9999",
    )
    async_db.add(exp)
    await async_db.commit()

    # Mock httpx responses for forwardMessage and deleteMessage
    mock_fwd_resp = MagicMock()
    mock_fwd_resp.json.return_value = {
        "ok": True,
        "result": {
            "message_id": 100,
            "forward_origin": {
                "type": "user",
                "sender_user": {
                    "id": 998877,
                    "first_name": "Siti",
                    "last_name": "Rahma",
                    "username": "sitirahma",
                },
            },
        },
    }

    mock_del_resp = MagicMock()
    mock_del_resp.json.return_value = {"ok": True}

    with patch("httpx.AsyncClient.post") as mock_post:
        mock_post.side_effect = [mock_fwd_resp, mock_del_resp]
        res = await sync_telegram_users_from_links(async_db, target_chat_id=115334079, batch_delay_seconds=0)

    assert res["ok"] is True
    assert res["updated_count"] == 1
    assert res["links_processed"] == 1

    # Cek bahwa user baru Siti Rahma dibuat dan terhubung ke expense
    await async_db.refresh(exp)
    assert exp.user_id is not None

    user = await async_db.get(User, exp.user_id)
    assert user is not None
    assert user.telegram_id == 998877
    assert user.name == "Siti Rahma"
