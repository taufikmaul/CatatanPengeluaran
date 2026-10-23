"""
app/api/router.py — Main API v1 Router
"""
from fastapi import APIRouter
from app.api.auth import router as auth_router
from app.api.expenses import router as expenses_router
from app.api.reports import router as reports_router
from app.api.config import router as config_router
from app.api.import_data import router as import_router
from app.api.master_items import router as master_items_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router)
api_router.include_router(expenses_router)
api_router.include_router(reports_router)
api_router.include_router(config_router)
api_router.include_router(import_router)
api_router.include_router(master_items_router)
