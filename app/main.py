"""
app/main.py — FastAPI Application Entry Point
Menggantikan seluruh Google Apps Script
"""
from contextlib import asynccontextmanager
import hmac
import os
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from app.config import settings
from app.database.connection import init_db
from app.bot.webhook import router as webhook_router
from app.api.router import api_router
from app.scheduler.jobs import setup_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup & shutdown lifecycle."""
    # ── Startup ──
    print("🚀 CatatanPengeluaran starting up...")

    # Init database tables
    await init_db()
    print("✅ Database initialized")

    # Load persistent system settings from database
    try:
        from app.database.connection import AsyncSessionLocal
        from app.services.system_setting_service import load_and_apply_system_settings
        async with AsyncSessionLocal() as session:
            loaded_settings = await load_and_apply_system_settings(session)
            if loaded_settings:
                print(f"✅ Loaded {len(loaded_settings)} system settings from database")
    except Exception as e:
        print(f"⚠️  Gagal memuat system settings dari database: {e}")

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
    print("✅ Scheduler started (weekly report + reminders)")

    # Start background job queue workers
    from app.services.job_queue import background_queue
    background_queue.start_workers(num_workers=2)
    print("✅ Background queue workers started")

    yield  # App running

    # ── Shutdown ──
    await background_queue.stop_workers()
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
    docs_url="/docs" if settings.enable_api_docs else None,
    openapi_url="/openapi.json" if settings.enable_api_docs else None,
    redoc_url=None,
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
        "script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; "
        "connect-src 'self';",
    )
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response

# Routers
app.include_router(webhook_router)
app.include_router(api_router)

# Redirect legacy /dashboard to modern React SPA
@app.get("/dashboard", include_in_schema=False)
@app.get("/dashboard/{full_path:path}", include_in_schema=False)
async def redirect_legacy_dashboard(full_path: str = ""):
    return RedirectResponse(url="/app", status_code=307)

# Serve React SPA jika build dist sudah tersedia
frontend_dist = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(os.path.join(frontend_dist, "assets")):
    app.mount("/app/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="app_assets")
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")

@app.get("/app", response_class=FileResponse)
@app.get("/app/{full_path:path}", response_class=FileResponse)
async def serve_react_app(full_path: str = ""):
    index_file = os.path.join(frontend_dist, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse(
        {"status": "building", "message": "Frontend React sedang disiapkan. Silakan jalankan build di folder frontend."},
        status_code=503,
    )


# ──────────────────────────────────────────────
# Utility Endpoints
# ──────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root(request: Request):
    accept = request.headers.get("accept", "")
    # Browser request atau navigasi yang membawa SSO token: arahkan ke SPA /app
    if "text/html" in accept or "token" in request.query_params:
        query_str = str(request.query_params)
        target = f"/app{'?' + query_str if query_str else ''}"
        return RedirectResponse(url=target, status_code=307)

    # Permintaan API / CLI / Test: kembalikan info status aplikasi
    return JSONResponse({
        "app": "CatatanPengeluaran v2.0",
        "status": "running",
        "agent": "Hermes",
        "docs": "/docs",
        "dashboard": "/app",
    })


@app.get("/health")
async def health():
    """Health check untuk load balancer / monitoring."""
    return {"status": "ok"}


@app.post("/setup-webhook")
async def setup_webhook(request: Request):
    """Set ulang webhook Telegram secara manual.

    Dilindungi SECRET_KEY pada header X-Admin-Token.
    """
    from fastapi import HTTPException
    from app.bot.telegram_client import set_webhook

    token = (request.headers.get("X-Admin-Token") or "").strip()
    expected = (settings.secret_key or "").strip()
    if not expected or expected in ("change_me", "change_this_to_a_random_secret_string") or not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not settings.webhook_url:
        return {"error": "WEBHOOK_URL tidak dikonfigurasi di .env"}
    result = await set_webhook(settings.webhook_url)
    return result
