"""
tests/test_sheets_sync.py — Unit & integration tests for Google Sheets synchronization.
"""
from datetime import date, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.database.connection import get_db
from app.models.expense import Expense
from app.services.dashboard_auth_service import SESSION_COOKIE_NAME, create_session_token
from app.services.sheets_service import (
    extract_spreadsheet_id,
    resolve_credentials_path,
    sync_to_sheets,
)


@pytest.fixture
async def client(db: AsyncSession):
    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def auth_cookies():
    token = create_session_token()
    return {SESSION_COOKIE_NAME: token}


class TestExtractSpreadsheetId:
    def test_extract_from_plain_id(self):
        assert extract_spreadsheet_id("13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo") == "13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo"

    def test_extract_from_plain_id_with_whitespace(self):
        assert extract_spreadsheet_id("  13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo \n") == "13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo"

    def test_extract_from_full_google_sheets_url(self):
        url = "https://docs.google.com/spreadsheets/d/13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo/edit#gid=0"
        assert extract_spreadsheet_id(url) == "13SCek2yQckWWaNf6AAcZaOjf088p_x5PfTEe8fuXfDo"

    def test_extract_from_view_url(self):
        url = "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view"
        assert extract_spreadsheet_id(url) == "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"

    def test_extract_empty(self):
        assert extract_spreadsheet_id("") == ""
        assert extract_spreadsheet_id(None) == ""


class TestSyncToSheetsValidation:
    @pytest.mark.asyncio
    async def test_missing_spreadsheet_id_raises_when_requested(self, db: AsyncSession, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "spreadsheet_id", "")

        with pytest.raises(ValueError, match="Spreadsheet ID belum diatur"):
            await sync_to_sheets(db, raise_on_error=True)

        # Silent mode returns 0
        assert await sync_to_sheets(db, raise_on_error=False) == 0

    @pytest.mark.asyncio
    async def test_missing_credentials_file_raises_when_requested(self, db: AsyncSession, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "spreadsheet_id", "test_sheet_123")
        monkeypatch.setattr(settings, "google_credentials_json", "non_existent_creds_999.json")

        with pytest.raises(FileNotFoundError, match="belum ada"):
            await sync_to_sheets(db, raise_on_error=True)

        # Silent mode returns 0
        assert await sync_to_sheets(db, raise_on_error=False) == 0


class TestSyncToSheetsExecution:
    @pytest.mark.asyncio
    async def test_sync_no_unsynced_items(self, db: AsyncSession, monkeypatch, tmp_path):
        from app.config import settings
        creds_file = tmp_path / "creds.json"
        creds_file.write_text('{"client_email": "sa@test.iam.gserviceaccount.com"}')

        monkeypatch.setattr(settings, "spreadsheet_id", "test_sheet_123")
        monkeypatch.setattr(settings, "google_credentials_json", str(creds_file))

        res = await sync_to_sheets(db, raise_on_error=True)
        assert res == 0

    @pytest.mark.asyncio
    async def test_sync_successful_with_items(
        self, db: AsyncSession, monkeypatch, tmp_path
    ):
        from app.config import settings
        creds_file = tmp_path / "creds.json"
        creds_file.write_text('{"client_email": "sa@test.iam.gserviceaccount.com"}')

        monkeypatch.setattr(settings, "spreadsheet_id", "https://docs.google.com/spreadsheets/d/real_sheet_id_xyz/edit")
        monkeypatch.setattr(settings, "google_credentials_json", str(creds_file))

        # Insert 2 unsynced items
        exp1 = Expense(
            expense_date=date(2026, 10, 20),
            supplier="Toko Kue Enak",
            item_name="Cokelat Bubuk 1kg",
            qty=Decimal("2"),
            category="Bahan Kue",
            unit_price=Decimal("45000"),
            tax=Decimal("0"),
            discount=Decimal("5000"),
            total_price=Decimal("85000"),
            pay_method="Transfer",
            pay_status="Lunas",
            due_date="-",
            notes="Untuk adonan brownies",
            msg_link="Private Chat",
            sheets_synced=False,
        )
        exp2 = Expense(
            expense_date=date(2026, 10, 21),
            supplier="Plastik Jaya",
            item_name="Mika 10x10",
            qty=Decimal("100"),
            category="Kemasan",
            unit_price=Decimal("500"),
            tax=Decimal("0"),
            discount=Decimal("0"),
            total_price=Decimal("50000"),
            pay_method="Tunai",
            pay_status="Lunas",
            due_date="-",
            notes="-",
            msg_link="Private Chat",
            sheets_synced=False,
        )
        db.add_all([exp1, exp2])
        await db.commit()

        # Mock gspread
        mock_sheet = MagicMock()
        mock_doc = MagicMock()
        mock_doc.worksheet.return_value = mock_sheet
        mock_gc = MagicMock()
        mock_gc.open_by_key.return_value = mock_doc

        with patch("gspread.authorize", return_value=mock_gc):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                count = await sync_to_sheets(db, raise_on_error=True)

        assert count == 2
        mock_gc.open_by_key.assert_called_once_with("real_sheet_id_xyz")
        mock_sheet.append_rows.assert_called_once()
        appended_values = mock_sheet.append_rows.call_args[0][0]
        assert len(appended_values) == 2
        assert len(appended_values[0]) == 20
        assert appended_values[0][3] == "Cokelat Bubuk 1kg"
        assert appended_values[0][15] == "Untuk adonan brownies"
        assert appended_values[1][3] == "Mika 10x10"
        assert appended_values[1][15] == "-"

        # Verify items are marked sheets_synced = True in DB
        res = await db.execute(select(Expense).where(Expense.id.in_([exp1.id, exp2.id])))
        rows = res.scalars().all()
        for r in rows:
            assert r.sheets_synced is True

    @pytest.mark.asyncio
    async def test_auto_creates_pengeluaran_tab_if_missing(
        self, db: AsyncSession, monkeypatch, tmp_path
    ):
        import gspread.exceptions
        from app.config import settings

        creds_file = tmp_path / "creds.json"
        creds_file.write_text('{"client_email": "sa@test.iam.gserviceaccount.com"}')

        monkeypatch.setattr(settings, "spreadsheet_id", "sheet_new_123")
        monkeypatch.setattr(settings, "google_credentials_json", str(creds_file))

        exp = Expense(
            expense_date=date(2026, 10, 22),
            item_name="Keju Cheddar",
            total_price=Decimal("30000"),
            sheets_synced=False,
        )
        db.add(exp)
        await db.commit()

        # Mock worksheet missing
        mock_sheet = MagicMock()
        mock_doc = MagicMock()
        mock_doc.worksheet.side_effect = gspread.exceptions.WorksheetNotFound("Pengeluaran")
        mock_doc.worksheets.return_value = []
        mock_doc.add_worksheet.return_value = mock_sheet

        mock_gc = MagicMock()
        mock_gc.open_by_key.return_value = mock_doc

        with patch("gspread.authorize", return_value=mock_gc):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                count = await sync_to_sheets(db, raise_on_error=True)

        assert count == 1
        mock_doc.add_worksheet.assert_called_once_with(title="Pengeluaran", rows=1000, cols=20)
        mock_sheet.append_row.assert_called_once()
        mock_sheet.append_rows.assert_called_once()

    @pytest.mark.asyncio
    async def test_sync_raises_informative_permission_error_when_gspread_raises_empty_error(
        self, db: AsyncSession, monkeypatch, tmp_path
    ):
        from app.config import settings
        creds_file = tmp_path / "creds.json"
        creds_file.write_text('{"client_email": "bot@iam.gserviceaccount.com"}')

        monkeypatch.setattr(settings, "spreadsheet_id", "some_sheet_id")
        monkeypatch.setattr(settings, "google_credentials_json", str(creds_file))

        exp = Expense(
            expense_date=date(2026, 10, 22),
            item_name="Cokelat",
            total_price=Decimal("10000"),
            sheets_synced=False,
        )
        db.add(exp)
        await db.commit()

        mock_gc = MagicMock()
        mock_gc.open_by_key.side_effect = PermissionError()

        with patch("gspread.authorize", return_value=mock_gc):
            with patch("google.oauth2.service_account.Credentials.from_service_account_file"):
                with pytest.raises(PermissionError) as exc_info:
                    await sync_to_sheets(db, raise_on_error=True)

        assert str(exc_info.value) != ""
        assert "Akses Google Sheets ditolak" in str(exc_info.value)
        assert "bot@iam.gserviceaccount.com" in str(exc_info.value)


class TestSyncSheetsApiEndpoint:
    @pytest.mark.asyncio
    async def test_api_sync_sheets_returns_400_on_missing_creds(self, client, auth_cookies, monkeypatch):
        from app.config import settings
        client.cookies.update(auth_cookies)

        monkeypatch.setattr(settings, "spreadsheet_id", "some_sheet_id")
        monkeypatch.setattr(settings, "google_credentials_json", "nonexistent.json")

        res = await client.post("/api/v1/config/sync-sheets")
        assert res.status_code == 400
        data = res.json()
        assert "belum ada" in data["detail"]

    @pytest.mark.asyncio
    async def test_api_sync_sheets_handles_empty_permission_error(self, client, auth_cookies):
        client.cookies.update(auth_cookies)

        with patch("app.api.config.sync_to_sheets", side_effect=PermissionError()):
            res = await client.post("/api/v1/config/sync-sheets")
            assert res.status_code == 400
            data = res.json()
            assert data["detail"] != ""
            assert "Akses Google Sheets ditolak" in data["detail"]

    @pytest.mark.asyncio
    async def test_api_sync_sheets_success_returns_count(self, client, auth_cookies, monkeypatch):
        client.cookies.update(auth_cookies)

        with patch("app.api.config.sync_to_sheets", return_value=16):
            res = await client.post("/api/v1/config/sync-sheets")
            assert res.status_code == 200
            data = res.json()
            assert data["ok"] is True
            assert data["synced_count"] == 16
            assert "16 baris data" in data["message"]
