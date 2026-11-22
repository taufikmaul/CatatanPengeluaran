"""
app/services/ai_chat_service.py — Layanan orkestrasi AI Financial Chat (SSE + Read-Only Tool Calling)
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timezone
from typing import Any, AsyncIterator, Callable

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.models.ai_chat import AiChatMessage, AiChatSession
from app.services.ai_chat_tools import (
    AI_CHAT_TOOL_LABELS,
    AI_CHAT_TOOL_SCHEMAS,
    MONTH_NAMES_ID,
    build_fallback_snapshot,
    execute_ai_chat_tool,
)

logger = logging.getLogger(__name__)

MAX_CONTEXT_MESSAGES = 8
MAX_TOOL_ROUNDS = 5


class _UpstreamHttpError(Exception):
    """Error HTTP dari provider LLM upstream."""

    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Upstream HTTP {status_code}: {body[:240]}")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_http_client() -> httpx.AsyncClient:
    """Factory httpx.AsyncClient agar mudah di-mock saat testing."""
    return httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0))


def format_sse_event(event: str, payload: dict[str, Any]) -> str:
    """Format satu frame Server-Sent Events."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _derive_session_title(prompt_text: str) -> str:
    cleaned = " ".join(prompt_text.strip().split())
    if not cleaned:
        return "Percakapan Baru"
    if len(cleaned) <= 72:
        return cleaned
    return cleaned[:69].rstrip() + "..."


def _parse_tool_calls_json(raw: str | None) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def resolve_provider_config(
    provider: str | None = None,
    model_id: str | None = None,
) -> tuple[str, str, str, str]:
    """
    Selesaikan (provider_id, model_name, endpoint_url, api_key) untuk AI Chat.
    Melempar ValueError jika provider tidak valid atau API key belum diatur.
    """
    catalog = settings.get_ai_chat_catalog()
    target_provider = (provider or "").strip().lower() or catalog["default_provider"]
    if target_provider not in ("classai", "sumopod"):
        raise ValueError("Provider AI harus 'classai' atau 'sumopod'.")

    if target_provider == "classai":
        url = (settings.ai_analysis_url or "https://router.classai.id/v1/chat/completions").strip()
        api_key = (settings.ai_analysis_api_key or "").strip()
        default_model = (settings.ai_analysis_model or "deepseek-v4.1-flash-1017").strip()
        label = "ClassAI"
    else:
        url = (settings.sumopod_url or "https://ai.sumopod.com/v1/chat/completions").strip()
        api_key = (settings.sumopod_api_key or "").strip()
        default_model = (settings.sumopod_model or "seed-2-0-mini").strip()
        label = "Sumopod"

    if not settings._is_api_key_configured(api_key):
        raise ValueError(
            f"API key untuk provider {label} belum diatur. Silakan isi di tab Pengaturan -> AI."
        )

    if not url.startswith(("http://", "https://")):
        raise ValueError(f"URL endpoint untuk provider {label} tidak valid.")

    resolved_model = (model_id or "").strip()
    if not resolved_model:
        if target_provider == catalog["default_provider"] and catalog.get("default_model"):
            resolved_model = str(catalog["default_model"]).strip()
        else:
            resolved_model = default_model

    return target_provider, resolved_model, url, api_key


async def list_sessions(db: AsyncSession, limit: int = 50) -> list[dict[str, Any]]:
    """Daftar sesi chat Owner urut terbaru, lengkap dengan jumlah pesan & pratinjau."""
    stmt = (
        select(AiChatSession)
        .options(selectinload(AiChatSession.messages))
        .order_by(AiChatSession.updated_at.desc(), AiChatSession.id.desc())
        .limit(limit)
    )
    rows = list((await db.execute(stmt)).scalars().all())
    result: list[dict[str, Any]] = []
    for s in rows:
        msgs = list(s.messages or [])
        last_msg = msgs[-1] if msgs else None
        preview = ""
        if last_msg and last_msg.content:
            one_line = " ".join(last_msg.content.split())
            preview = one_line[:90] + ("..." if len(one_line) > 90 else "")
        result.append(
            {
                "id": s.id,
                "title": s.title,
                "provider": s.provider,
                "model_id": s.model_id,
                "message_count": len(msgs),
                "last_message_preview": preview,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
        )
    return result


async def create_session(
    db: AsyncSession,
    provider: str | None = None,
    model_id: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Buat sesi chat baru dengan default provider & model dari katalog."""
    catalog = settings.get_ai_chat_catalog()
    target_provider = (provider or "").strip().lower() or catalog["default_provider"]
    if target_provider not in ("classai", "sumopod"):
        target_provider = catalog["default_provider"]

    provider_info = next(
        (p for p in catalog["providers"] if p["id"] == target_provider),
        catalog["providers"][0],
    )
    resolved_model = (model_id or "").strip() or (
        catalog["default_model"]
        if target_provider == catalog["default_provider"]
        else provider_info.get("default_model", "")
    )
    clean_title = (title or "").strip()[:200] or "Percakapan Baru"

    session = AiChatSession(
        title=clean_title,
        provider=target_provider,
        model_id=resolved_model,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "id": session.id,
        "title": session.title,
        "provider": session.provider,
        "model_id": session.model_id,
        "message_count": 0,
        "last_message_preview": "",
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


async def get_session_with_messages(
    db: AsyncSession, session_id: int
) -> dict[str, Any] | None:
    """Ambil detail sesi beserta seluruh riwayat pesannya."""
    stmt = (
        select(AiChatSession)
        .options(selectinload(AiChatSession.messages))
        .where(AiChatSession.id == session_id)
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        return None

    messages = [
        {
            "id": m.id,
            "session_id": m.session_id,
            "role": m.role,
            "content": m.content,
            "provider": m.provider,
            "model_used": m.model_used,
            "tool_calls": _parse_tool_calls_json(m.tool_calls_json),
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in (session.messages or [])
    ]
    return {
        "id": session.id,
        "title": session.title,
        "provider": session.provider,
        "model_id": session.model_id,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": messages,
    }


async def update_session(
    db: AsyncSession,
    session_id: int,
    title: str | None = None,
    provider: str | None = None,
    model_id: str | None = None,
) -> dict[str, Any] | None:
    """Perbarui judul atau preferensi provider/model sesi."""
    session = await db.get(AiChatSession, session_id)
    if session is None:
        return None

    if title is not None and title.strip():
        session.title = title.strip()[:200]
    if provider is not None and provider.strip().lower() in ("classai", "sumopod"):
        session.provider = provider.strip().lower()
    if model_id is not None:
        session.model_id = model_id.strip()[:120]
    session.updated_at = _utc_now()

    await db.commit()
    await db.refresh(session)

    count_res = await db.execute(
        select(func.count(AiChatMessage.id)).where(AiChatMessage.session_id == session.id)
    )
    msg_count = int(count_res.scalar() or 0)

    return {
        "id": session.id,
        "title": session.title,
        "provider": session.provider,
        "model_id": session.model_id,
        "message_count": msg_count,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


async def delete_session(db: AsyncSession, session_id: int) -> bool:
    """Hapus sesi beserta seluruh pesannya."""
    session = await db.get(AiChatSession, session_id)
    if session is None:
        return False
    await db.execute(delete(AiChatMessage).where(AiChatMessage.session_id == session_id))
    await db.delete(session)
    await db.commit()
    return True


def _build_system_prompt(fallback_snapshot: dict[str, Any] | None = None) -> str:
    today = date.today()
    month_label = MONTH_NAMES_ID[today.month - 1]
    base = (
        "Anda adalah Asisten Keuangan AI untuk toko kue Historycake yang membantu Owner "
        "memeriksa dan menganalisis data keuangan aktual dari database.\n"
        f"Tanggal hari ini: {today.isoformat()} ({month_label} {today.year}).\n\n"
        "Aturan wajib:\n"
        "1. Selalu gunakan tools yang tersedia untuk mengambil data aktual sebelum menjawab "
        "pertanyaan tentang angka, transaksi, saldo, budget, hutang, harga bahan, HPP menu, "
        "aset, atau pengajuan belanja. Dilarang keras mengarang angka.\n"
        "2. Jika hasil tool menunjukkan data kosong atau bernilai 0, laporkan apa adanya.\n"
        "3. Sajikan jawaban dalam Bahasa Indonesia yang jelas, ringkas, dan profesional "
        "dalam format Markdown rapi (gunakan tabel Markdown jika membandingkan daftar item, "
        "kategori, rekening, atau menu; format nominal dengan Rp).\n"
        "4. Jangan gunakan karakter em dash. Gunakan koma, titik dua, atau tanda kurung.\n"
        "5. Sebutkan periode atau cakupan data yang diperiksa agar Owner mudah memverifikasi."
    )
    if fallback_snapshot is not None:
        base += (
            "\n\nCatatan: Model aktif tidak mendukung pemanggilan tool otomatis, "
            "gunakan snapshot data aktual berikut untuk menjawab dengan akurat:\n"
            f"{json.dumps(fallback_snapshot, ensure_ascii=False)}"
        )
    return base


async def _stream_completion_round(
    client: httpx.AsyncClient,
    *,
    url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
) -> AsyncIterator[tuple[str, Any]]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    full_content_parts: list[str] = []
    tool_calls_acc: dict[int, dict[str, Any]] = {}

    async with client.stream("POST", url, json=payload, headers=headers) as resp:
        if resp.status_code != 200:
            raw_err = await resp.aread()
            err_text = raw_err.decode("utf-8", errors="replace")
            raise _UpstreamHttpError(resp.status_code, err_text)

        async for raw_line in resp.aiter_lines():
            line = raw_line.strip()
            if not line or not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if data_str == "[DONE]":
                break
            try:
                chunk = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            choices = chunk.get("choices") or []
            if not choices:
                continue
            choice = choices[0] or {}
            delta = choice.get("delta") or choice.get("message") or {}

            content_piece = delta.get("content")
            if isinstance(content_piece, str) and content_piece:
                full_content_parts.append(content_piece)
                yield ("delta", content_piece)

            tc_list = delta.get("tool_calls") or []
            for tc in tc_list:
                idx = int(tc.get("index", 0))
                entry = tool_calls_acc.setdefault(
                    idx,
                    {
                        "id": "",
                        "type": "function",
                        "function": {"name": "", "arguments": ""},
                    },
                )
                if tc.get("id"):
                    entry["id"] = str(tc["id"])
                if tc.get("type"):
                    entry["type"] = str(tc["type"])
                fn = tc.get("function") or {}
                if fn.get("name"):
                    entry["function"]["name"] += str(fn["name"])
                if fn.get("arguments"):
                    entry["function"]["arguments"] += str(fn["arguments"])

    assembled_calls = [
        tool_calls_acc[k]
        for k in sorted(tool_calls_acc.keys())
        if tool_calls_acc[k]["function"]["name"]
    ]
    for i, tc in enumerate(assembled_calls):
        if not tc["id"]:
            tc["id"] = f"call_{i}"

    yield (
        "round_done",
        {
            "content": "".join(full_content_parts),
            "tool_calls": assembled_calls,
        },
    )


async def stream_chat_response(
    session_factory: Callable[[], AsyncSession],
    *,
    session_id: int,
    user_message: str,
    provider: str | None = None,
    model_id: str | None = None,
) -> AsyncIterator[str]:
    """
    Generator SSE untuk mengirim pertanyaan user, menjalankan tool calling read-only,
    mengalirkan token jawaban, dan menyimpan pesan ke database.
    """
    cleaned_user_msg = (user_message or "").strip()
    if not cleaned_user_msg:
        yield format_sse_event("error", {"message": "Pesan tidak boleh kosong."})
        return

    try:
        async with session_factory() as db:
            chat_session = await db.get(AiChatSession, session_id)
            if chat_session is None:
                yield format_sse_event("error", {"message": "Sesi percakapan tidak ditemukan."})
                return

            try:
                resolved_provider, resolved_model, api_url, api_key = resolve_provider_config(
                    provider=provider or chat_session.provider,
                    model_id=model_id or chat_session.model_id,
                )
            except ValueError as exc:
                yield format_sse_event("error", {"message": str(exc)})
                return

            # Simpan pesan user segera
            user_row = AiChatMessage(
                session_id=session_id,
                role="user",
                content=cleaned_user_msg,
                provider=resolved_provider,
                model_used=resolved_model,
            )
            db.add(user_row)

            if not chat_session.title.strip() or chat_session.title == "Percakapan Baru":
                chat_session.title = _derive_session_title(cleaned_user_msg)
            chat_session.provider = resolved_provider
            chat_session.model_id = resolved_model
            chat_session.updated_at = _utc_now()
            await db.commit()

            # Ambil maksimal N pesan terakhir untuk mencegah context bloat
            hist_stmt = (
                select(AiChatMessage)
                .where(AiChatMessage.session_id == session_id)
                .order_by(AiChatMessage.created_at.desc(), AiChatMessage.id.desc())
                .limit(MAX_CONTEXT_MESSAGES)
            )
            recent_rows = list((await db.execute(hist_stmt)).scalars().all())
            recent_rows.reverse()

            llm_messages: list[dict[str, Any]] = [
                {"role": "system", "content": _build_system_prompt()}
            ]
            for row in recent_rows:
                llm_messages.append({"role": row.role, "content": row.content})

            executed_tools: list[dict[str, Any]] = []
            assistant_chunks: list[str] = []
            use_tools = True

            async with create_http_client() as http_client:
                for round_idx in range(MAX_TOOL_ROUNDS):
                    round_result: dict[str, Any] = {"content": "", "tool_calls": []}
                    try:
                        async for kind, val in _stream_completion_round(
                            http_client,
                            url=api_url,
                            api_key=api_key,
                            model=resolved_model,
                            messages=llm_messages,
                            tools=AI_CHAT_TOOL_SCHEMAS if use_tools else None,
                        ):
                            if kind == "delta":
                                assistant_chunks.append(val)
                                yield format_sse_event("delta", {"text": val})
                            elif kind == "round_done":
                                round_result = val
                    except _UpstreamHttpError as http_err:
                        # Fallback aman jika model/router menolak parameter `tools`
                        if round_idx == 0 and use_tools and http_err.status_code in (400, 422):
                            logger.info(
                                "Model %s menolak parameter tools (HTTP %s), beralih ke snapshot fallback.",
                                resolved_model,
                                http_err.status_code,
                            )
                            yield format_sse_event(
                                "tool_start",
                                {
                                    "tool": "financial_snapshot",
                                    "label": "Mengambil ringkasan keuangan bulan berjalan",
                                    "arguments": {},
                                },
                            )
                            snapshot = await build_fallback_snapshot(db)
                            snap_trace = {
                                "tool": "financial_snapshot",
                                "label": "Ringkasan keuangan bulan berjalan (mode kompatibilitas)",
                                "period": snapshot.get("snapshot_period", "-"),
                                "status": "success",
                                "summary": f"Snapshot keuangan {snapshot.get('snapshot_period', '-')} dimuat.",
                            }
                            executed_tools.append(snap_trace)
                            yield format_sse_event("tool_end", snap_trace)

                            llm_messages[0] = {
                                "role": "system",
                                "content": _build_system_prompt(fallback_snapshot=snapshot),
                            }
                            use_tools = False
                            async for kind, val in _stream_completion_round(
                                http_client,
                                url=api_url,
                                api_key=api_key,
                                model=resolved_model,
                                messages=llm_messages,
                                tools=None,
                            ):
                                if kind == "delta":
                                    assistant_chunks.append(val)
                                    yield format_sse_event("delta", {"text": val})
                                elif kind == "round_done":
                                    round_result = val
                        else:
                            logger.error(
                                "AI Chat upstream error (%s/%s): HTTP %s - %s",
                                resolved_provider,
                                resolved_model,
                                http_err.status_code,
                                http_err.body[:300],
                            )
                            yield format_sse_event(
                                "error",
                                {
                                    "message": (
                                        f"Layanan AI ({resolved_provider}) mengembalikan error "
                                        f"HTTP {http_err.status_code}. Periksa konfigurasi model atau API key."
                                    )
                                },
                            )
                            return

                    tool_calls = round_result.get("tool_calls") or []
                    if not tool_calls:
                        break

                    llm_messages.append(
                        {
                            "role": "assistant",
                            "content": round_result.get("content") or None,
                            "tool_calls": tool_calls,
                        }
                    )

                    for tc in tool_calls:
                        fn = tc.get("function") or {}
                        tool_name = str(fn.get("name") or "").strip()
                        raw_args = fn.get("arguments") or "{}"
                        try:
                            parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                            if not isinstance(parsed_args, dict):
                                parsed_args = {}
                        except json.JSONDecodeError:
                            parsed_args = {}

                        label = AI_CHAT_TOOL_LABELS.get(tool_name, tool_name)
                        yield format_sse_event(
                            "tool_start",
                            {
                                "tool": tool_name,
                                "label": label,
                                "arguments": parsed_args,
                            },
                        )

                        obs = await execute_ai_chat_tool(db, tool_name, parsed_args)
                        trace = {
                            "tool": tool_name,
                            "label": obs.get("label", label),
                            "period": obs.get("period", "-"),
                            "status": obs.get("status", "success"),
                            "summary": obs.get("summary", ""),
                        }
                        executed_tools.append(trace)
                        yield format_sse_event("tool_end", trace)

                        llm_messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.get("id", tool_name),
                                "content": json.dumps(obs, ensure_ascii=False),
                            }
                        )

            final_text = "".join(assistant_chunks).strip()
            if not final_text and executed_tools:
                # Jika loop tool mencapai batas tanpa teks penutup, rangkum dari trace tool
                summary_lines = [
                    "Berikut ringkasan data yang berhasil diambil:",
                    *[f"- **{t['label']} ({t['period']})**: {t['summary']}" for t in executed_tools],
                ]
                final_text = "\n".join(summary_lines)
                yield format_sse_event("delta", {"text": final_text})
            elif not final_text:
                final_text = "Maaf, model AI tidak mengembalikan jawaban. Silakan coba lagi atau ganti model."
                yield format_sse_event("delta", {"text": final_text})

            assistant_row = AiChatMessage(
                session_id=session_id,
                role="assistant",
                content=final_text,
                provider=resolved_provider,
                model_used=resolved_model,
                tool_calls_json=json.dumps(executed_tools, ensure_ascii=False) if executed_tools else None,
            )
            db.add(assistant_row)
            chat_session.updated_at = _utc_now()
            await db.commit()
            await db.refresh(assistant_row)

            yield format_sse_event(
                "done",
                {
                    "session_id": session_id,
                    "message_id": assistant_row.id,
                    "title": chat_session.title,
                    "provider": resolved_provider,
                    "model_used": resolved_model,
                    "tool_calls": executed_tools,
                },
            )
    except asyncio.CancelledError:
        logger.info("Stream AI Chat dibatalkan oleh klien pada sesi %s.", session_id)
        raise
    except httpx.TimeoutException:
        yield format_sse_event(
            "error",
            {"message": "Koneksi ke layanan AI timeout. Silakan coba lagi atau pilih model yang lebih cepat."},
        )
    except httpx.HTTPError as exc:
        logger.error("Network error AI Chat: %s", exc)
        yield format_sse_event(
            "error",
            {"message": "Gagal terhubung ke server AI. Periksa URL endpoint dan koneksi jaringan."},
        )
    except Exception as exc:
        logger.exception("Unhandled error di stream_chat_response: %s", exc)
        yield format_sse_event(
            "error",
            {"message": f"Terjadi kesalahan internal saat memproses chat ({type(exc).__name__})."},
        )
