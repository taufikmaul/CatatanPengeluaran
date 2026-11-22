"""
tests/test_ai_chat_api.py — Test RBAC, konfigurasi multi-provider, CRUD sesi, & SSE streaming AI Chat.
"""
from __future__ import annotations

import json
from datetime import date
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.ai_chat import get_chat_session_factory
from app.config import settings
from app.database.connection import get_db
from app.main import app
from app.models.ai_chat import AiChatMessage, AiChatSession
from app.models.expense import Expense
from app.services import ai_chat_service
from app.services.dashboard_auth_service import SESSION_COOKIE_NAME, create_session_token


@pytest.fixture
def preserve_ai_settings():
    snapshot = {
        "ai_analysis_api_key": settings.ai_analysis_api_key,
        "ai_analysis_url": settings.ai_analysis_url,
        "ai_analysis_model": settings.ai_analysis_model,
        "sumopod_api_key": settings.sumopod_api_key,
        "sumopod_url": settings.sumopod_url,
        "sumopod_model": settings.sumopod_model,
        "ai_chat_default_provider": settings.ai_chat_default_provider,
        "ai_chat_default_model": settings.ai_chat_default_model,
        "ai_chat_openrouter_models": settings.ai_chat_openrouter_models,
        "ai_chat_sumopod_models": settings.ai_chat_sumopod_models,
    }
    yield
    for k, v in snapshot.items():
        setattr(settings, k, v)


@pytest.fixture
async def chat_client(db: AsyncSession, engine):
    test_session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_chat_session_factory] = lambda: test_session_factory

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


def _parse_sse_text(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in raw.strip().split("\n\n"):
        if not block.strip():
            continue
        event_name = "message"
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_name = line[len("event:"):].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
        if data_lines:
            events.append((event_name, json.loads("\n".join(data_lines))))
    return events


class _FakeStreamResponse:
    def __init__(self, status_code: int, lines: list[str], body: str = "") -> None:
        self.status_code = status_code
        self._lines = lines
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def aread(self) -> bytes:
        return self._body.encode("utf-8")

    async def aiter_lines(self):
        for ln in self._lines:
            yield ln


class _FakeHttpClient:
    def __init__(self, handler):
        self._handler = handler

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method: str, url: str, json=None, headers=None):
        return self._handler(method, url, json, headers)


@pytest.mark.anyio
async def test_ai_chat_rbac_owner_only(chat_client):
    # Unauthenticated -> 401
    res_anon = await chat_client.get("/api/v1/ai-chat/models")
    assert res_anon.status_code == 401

    res_anon_sess = await chat_client.post("/api/v1/ai-chat/sessions", json={})
    assert res_anon_sess.status_code == 401

    # Non-admin roles -> 403
    for role in ("staff", "purchasing", "warehouse", "admin_input"):
        token = create_session_token(role=role)
        chat_client.cookies.set(SESSION_COOKIE_NAME, token)
        r_models = await chat_client.get("/api/v1/ai-chat/models")
        assert r_models.status_code == 403, f"role {role} should be forbidden"
        r_sessions = await chat_client.get("/api/v1/ai-chat/sessions")
        assert r_sessions.status_code == 403
        r_stream = await chat_client.post(
            "/api/v1/ai-chat/sessions/1/messages/stream",
            json={"content": "cek pengeluaran"},
        )
        assert r_stream.status_code == 403

    # Admin / Owner -> 200
    chat_client.cookies.set(SESSION_COOKIE_NAME, create_session_token(role="admin"))
    r_ok = await chat_client.get("/api/v1/ai-chat/models")
    assert r_ok.status_code == 200
    data = r_ok.json()
    assert data["ok"] is True
    assert {p["id"] for p in data["providers"]} == {"openrouter", "sumopod"}


@pytest.mark.anyio
async def test_config_multi_provider_and_secret_masking(chat_client, preserve_ai_settings):
    chat_client.cookies.set(SESSION_COOKIE_NAME, create_session_token(role="admin"))

    put_res = await chat_client.put(
        "/api/v1/config",
        json={
            "ai_analysis_api_key": "sk-or-v1-secret-99887766",
            "ai_analysis_url": "https://openrouter.ai/api/v1/chat/completions",
            "ai_analysis_model": "openai/gpt-4o-mini",
            "ai_chat_default_provider": "openrouter",
            "ai_chat_default_model": "openai/gpt-4o-mini",
            "ai_chat_openrouter_models": "openai/gpt-4o-mini,google/gemini-2.5-flash",
            "ai_chat_sumopod_models": "seed-2-0-mini,gpt-4o",
        },
    )
    assert put_res.status_code == 200

    cfg_res = await chat_client.get("/api/v1/config")
    assert cfg_res.status_code == 200
    cfg = cfg_res.json()
    # Pastikan plaintext API key tidak pernah dikembalikan
    assert "sk-or-v1-secret-99887766" not in json.dumps(cfg)
    assert cfg["ai_analysis_api_key_configured"] is True
    assert cfg["ai_analysis_key_masked"].startswith("sk-or-v")
    assert cfg["ai_chat_default_provider"] == "openrouter"
    assert cfg["ai_chat_openrouter_models"] == "openai/gpt-4o-mini,google/gemini-2.5-flash"
    assert cfg["ai_chat_sumopod_models"] == "seed-2-0-mini,gpt-4o"

    # Cek /ai-chat/models ikut mencerminkan katalog terbaru
    models_res = await chat_client.get("/api/v1/ai-chat/models")
    assert models_res.status_code == 200
    catalog = models_res.json()
    openrouter_p = next(p for p in catalog["providers"] if p["id"] == "openrouter")
    assert openrouter_p["label"] == "OpenRouter"
    assert openrouter_p["configured"] is True
    assert "google/gemini-2.5-flash" in openrouter_p["models"]

    # Uji normalisasi legacy 'classai' -> 'openrouter'
    put_legacy = await chat_client.put(
        "/api/v1/config",
        json={"ai_chat_default_provider": "classai"},
    )
    assert put_legacy.status_code == 200
    assert (await chat_client.get("/api/v1/config")).json()["ai_chat_default_provider"] == "openrouter"


@pytest.mark.anyio
async def test_session_crud_and_cascade_delete(chat_client, db, preserve_ai_settings):
    chat_client.cookies.set(SESSION_COOKIE_NAME, create_session_token(role="admin"))

    create_res = await chat_client.post(
        "/api/v1/ai-chat/sessions",
        json={"provider": "sumopod", "model_id": "gpt-4o-mini"},
    )
    assert create_res.status_code == 201
    sess_id = create_res.json()["session"]["id"]

    # Tambah pesan langsung untuk uji cascade delete
    db.add(
        AiChatMessage(
            session_id=sess_id,
            role="user",
            content="Halo tes",
            provider="sumopod",
            model_used="gpt-4o-mini",
        )
    )
    await db.commit()

    list_res = await chat_client.get("/api/v1/ai-chat/sessions")
    assert list_res.status_code == 200
    assert any(s["id"] == sess_id and s["message_count"] == 1 for s in list_res.json()["sessions"])

    patch_res = await chat_client.patch(
        f"/api/v1/ai-chat/sessions/{sess_id}",
        json={"title": "Audit November"},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["session"]["title"] == "Audit November"

    detail_res = await chat_client.get(f"/api/v1/ai-chat/sessions/{sess_id}")
    assert detail_res.status_code == 200
    assert len(detail_res.json()["session"]["messages"]) == 1

    del_res = await chat_client.delete(f"/api/v1/ai-chat/sessions/{sess_id}")
    assert del_res.status_code == 200

    # Pesan ikut terhapus oleh cascade
    msg_rows = (
        await db.execute(select(AiChatMessage).where(AiChatMessage.session_id == sess_id))
    ).scalars().all()
    assert msg_rows == []


@pytest.mark.anyio
async def test_sse_stream_with_tool_calling_and_persistence(
    chat_client, db, monkeypatch, preserve_ai_settings
):
    settings.ai_analysis_api_key = "sk-or-v1-live-test"
    settings.ai_analysis_url = "https://openrouter.ai/api/v1/chat/completions"
    settings.ai_analysis_model = "openai/gpt-4o-mini"

    # Seed satu transaksi pengeluaran agar tool mengembalikan data real
    db.add(
        Expense(
            expense_date=date(2026, 11, 10),
            item_name="Butter Elle & Vire",
            qty=Decimal("2"),
            unit="Pcs",
            unit_price=Decimal("250000"),
            total_price=Decimal("500000"),
            category="Bahan Kue",
            supplier="Toko Sumber",
            pay_method="Transfer",
            pay_status="Lunas",
        )
    )
    await db.commit()

    captured_requests: list[dict] = []

    def fake_stream_handler(method, url, json_payload, headers):
        captured_requests.append({"url": url, "payload": json_payload, "headers": headers})
        if len(captured_requests) == 1:
            lines = [
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_monthly_expense_summary","arguments":"{\\"year\\":2026,"}}]}}]}',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"month\\":11}"}}]}}]}',
                "data: [DONE]",
            ]
            return _FakeStreamResponse(200, lines)

        lines = [
            'data: {"choices":[{"delta":{"content":"Total pengeluaran "}}]}',
            'data: {"choices":[{"delta":{"content":"November 2026 adalah **Rp500.000**."}}]}',
            "data: [DONE]",
        ]
        return _FakeStreamResponse(200, lines)

    monkeypatch.setattr(
        ai_chat_service,
        "create_http_client",
        lambda: _FakeHttpClient(fake_stream_handler),
    )

    chat_client.cookies.set(SESSION_COOKIE_NAME, create_session_token(role="admin"))
    sess_res = await chat_client.post(
        "/api/v1/ai-chat/sessions",
        json={"provider": "openrouter", "model_id": "openai/gpt-4o-mini"},
    )
    sess_id = sess_res.json()["session"]["id"]

    stream_res = await chat_client.post(
        f"/api/v1/ai-chat/sessions/{sess_id}/messages/stream",
        json={
            "content": "Berapa total pengeluaran November 2026?",
            "provider": "openrouter",
            "model_id": "openai/gpt-4o-mini",
        },
    )
    assert stream_res.status_code == 200
    assert "text/event-stream" in stream_res.headers["content-type"]

    events = _parse_sse_text(stream_res.text)
    event_names = [ev[0] for ev in events]
    assert event_names == ["tool_start", "tool_end", "delta", "delta", "done"]

    tool_end_payload = events[1][1]
    assert tool_end_payload["tool"] == "get_monthly_expense_summary"
    assert tool_end_payload["status"] == "success"
    assert "500.000" in tool_end_payload["summary"]

    done_payload = events[-1][1]
    assert done_payload["provider"] == "openrouter"
    assert done_payload["model_used"] == "openai/gpt-4o-mini"
    assert len(done_payload["tool_calls"]) == 1

    # Pastikan OpenRouter URL dan header HTTP-Referer/X-Title dikirim serta hasil tool diteruskan ke round 2
    assert len(captured_requests) == 2
    assert captured_requests[0]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert "HTTP-Referer" in captured_requests[0]["headers"]
    assert captured_requests[0]["headers"].get("X-Title") == "CatatanPengeluaran Historycake"
    round2_messages = captured_requests[1]["payload"]["messages"]
    assert any(m.get("role") == "tool" and "500000.0" in m.get("content", "") for m in round2_messages)

    # Pastikan tersimpan rapi di DB
    detail_res = await chat_client.get(f"/api/v1/ai-chat/sessions/{sess_id}")
    session_data = detail_res.json()["session"]
    assert session_data["title"] == "Berapa total pengeluaran November 2026?"
    assert len(session_data["messages"]) == 2
    assistant_msg = session_data["messages"][1]
    assert assistant_msg["role"] == "assistant"
    assert "Rp500.000" in assistant_msg["content"]
    assert assistant_msg["model_used"] == "openai/gpt-4o-mini"
    assert len(assistant_msg["tool_calls"]) == 1


@pytest.mark.anyio
async def test_sse_fallback_when_tools_unsupported_and_error_handling(
    chat_client, monkeypatch, preserve_ai_settings
):
    settings.sumopod_api_key = "sk-sumopod-live-test"
    settings.sumopod_url = "https://ai.sumopod.com/v1/chat/completions"
    settings.sumopod_model = "seed-2-0-mini"
    settings.ai_analysis_api_key = ""

    chat_client.cookies.set(SESSION_COOKIE_NAME, create_session_token(role="admin"))
    sess_res = await chat_client.post(
        "/api/v1/ai-chat/sessions",
        json={"provider": "sumopod", "model_id": "seed-2-0-mini"},
    )
    sess_id = sess_res.json()["session"]["id"]

    # 1. Uji fallback saat upstream menolak `tools` dengan HTTP 400
    calls = {"count": 0}

    def fallback_handler(method, url, json_payload, headers):
        calls["count"] += 1
        if calls["count"] == 1:
            assert "tools" in json_payload
            return _FakeStreamResponse(400, [], body='{"error":"tools not supported"}')
        assert "tools" not in json_payload
        return _FakeStreamResponse(
            200,
            ['data: {"choices":[{"delta":{"content":"Ringkasan siap."}}]}', "data: [DONE]"],
        )

    monkeypatch.setattr(
        ai_chat_service,
        "create_http_client",
        lambda: _FakeHttpClient(fallback_handler),
    )

    res_fb = await chat_client.post(
        f"/api/v1/ai-chat/sessions/{sess_id}/messages/stream",
        json={"content": "Ringkas bulan ini", "provider": "sumopod", "model_id": "seed-2-0-mini"},
    )
    assert res_fb.status_code == 200
    events_fb = _parse_sse_text(res_fb.text)
    assert [e[0] for e in events_fb] == ["tool_start", "tool_end", "delta", "done"]
    assert events_fb[0][1]["tool"] == "financial_snapshot"

    # 2. Uji error terkendali saat memilih provider yang API key-nya belum diisi (termasuk legacy 'classai')
    res_missing_key = await chat_client.post(
        f"/api/v1/ai-chat/sessions/{sess_id}/messages/stream",
        json={"content": "Tes tanpa key", "provider": "openrouter", "model_id": "openai/gpt-4o-mini"},
    )
    assert res_missing_key.status_code == 200
    events_err = _parse_sse_text(res_missing_key.text)
    assert events_err[0][0] == "error"
    assert "OpenRouter" in events_err[0][1]["message"]

    res_legacy_missing = await chat_client.post(
        f"/api/v1/ai-chat/sessions/{sess_id}/messages/stream",
        json={"content": "Tes legacy", "provider": "classai", "model_id": "openai/gpt-4o-mini"},
    )
    assert res_legacy_missing.status_code == 200
    events_legacy = _parse_sse_text(res_legacy_missing.text)
    assert events_legacy[0][0] == "error"
    assert "OpenRouter" in events_legacy[0][1]["message"]
