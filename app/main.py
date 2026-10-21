"""
app/main.py — FastAPI Application Entry Point
Menggantikan seluruh Google Apps Script
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from app.database.connection import init_db
from app.bot.webhook import router as webhook_router
from app.dashboard.routes import router as dashboard_router
from app.scheduler.jobs import setup_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup & shutdown lifecycle."""
    # ── Startup ──
    print("🚀 CatatanPengeluaran starting up...")

    # Init database tables
    await init_db()
    print("✅ Database initialized")

    # Register webhook ke Telegram
    from app.config import settings
    from app.bot.telegram_client import set_webhook
    if settings.webhook_url:
        result = await set_webhook(settings.webhook_url)
        print(f"✅ Webhook set: {result}")
    else:
        print("⚠️  WEBHOOK_URL tidak dikonfigurasi — set manual via /setup-webhook")

    # Start scheduler
    scheduler = setup_scheduler()
    scheduler.start()
    print("✅ Scheduler started (weekly report + sheets sync)")

    yield  # App running

    # ── Shutdown ──
    scheduler.shutdown(wait=False)
    print("👋 CatatanPengeluaran shutdown")


# ──────────────────────────────────────────────
# FastAPI App
# ──────────────────────────────────────────────

app = FastAPI(
    title="CatatanPengeluaran",
    description="Bot Telegram Pencatatan Pengeluaran dengan Hermes Agent — powered by Sumopod AI",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
)

# Routers
app.include_router(webhook_router)
app.include_router(dashboard_router)


# ──────────────────────────────────────────────
# Utility Endpoints
# ──────────────────────────────────────────────

@app.get("/", response_class=JSONResponse)
async def root():
    return {
        "app": "CatatanPengeluaran v2.0",
        "status": "running",
        "agent": "Hermes",
        "docs": "/docs",
        "dashboard": "/dashboard",
    }


@app.get("/health")
async def health():
    """Health check untuk load balancer / monitoring."""
    return {"status": "ok"}


@app.post("/setup-webhook")
async def setup_webhook(request: Request):
    """Set ulang webhook Telegram secara manual.

    Dilindungi SECRET_KEY (header X-Admin-Token atau query ?token=) karena
    endpoint ini memicu panggilan ke Telegram API dan terbuka ke publik.
    """
    from fastapi import HTTPException
    from app.config import settings
    from app.bot.telegram_client import set_webhook

    token = request.headers.get("X-Admin-Token") or request.query_params.get("token")
    if not settings.secret_key or token != settings.secret_key:
        raise HTTPException(status_code=403, detail="Forbidden")

    if not settings.webhook_url:
        return {"error": "WEBHOOK_URL tidak dikonfigurasi di .env"}
    result = await set_webhook(settings.webhook_url)
    return result
