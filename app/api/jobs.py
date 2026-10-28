"""
app/api/jobs.py — Router API untuk Manajemen Antrean & Aksi Latar Belakang
"""
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.services.job_queue import background_queue, JobStatus, JobType
from app.api.deps import require_admin_role

router = APIRouter(prefix="/jobs", tags=["Background Jobs & Queue"])


class JobItemResponse(BaseModel):
    id: str
    type: str
    title: str
    status: str
    progress: int
    progress_message: str
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    result: Any = None
    error: str | None = None
    actor: str = "user"


class EnqueueAuditMasterItemRequest(BaseModel):
    min_score: float = 0.70
    limit: int = 150
    supplier: str | None = None
    supplier_id: int | None = None
    strict_supplier: bool = False


class EnqueueAuditSupplierRequest(BaseModel):
    threshold: float = 0.75


class EnqueueAuditExpenseRequest(BaseModel):
    min_similarity: float = 0.90
    month: int | None = None
    year: int | None = None
    category: str | None = None
    limit: int = 150


class EnqueueMergeMasterItemRequest(BaseModel):
    target_item_id: int
    source_item_ids: list[int]
    custom_name: str | None = None
    custom_category: str | None = None
    custom_supplier: str | None = None
    custom_satuan_beli: str | None = None
    custom_tipe_satuan: str | None = None
    custom_isi_paket: str | None = None
    custom_satuan_ecer: str | None = None
    merge_aliases: bool = True
    update_expenses: bool = True


class EnqueueMergeSupplierRequest(BaseModel):
    target_id: int
    source_ids: list[int]


class BatchMergeGroup(BaseModel):
    target_item_id: int
    source_item_ids: list[int]
    custom_name: str | None = None
    custom_category: str | None = None
    custom_supplier: str | None = None
    merge_aliases: bool = True
    update_expenses: bool = True


class EnqueueBatchMergeRequest(BaseModel):
    merges: list[BatchMergeGroup]


@router.get("", response_model=list[JobItemResponse])
async def list_background_jobs(
    limit: int = Query(default=50, ge=1, le=200),
    status: str | None = Query(default=None),
    job_type: str | None = Query(default=None),
):
    """Ambil daftar riwayat dan status antrean tugas latar belakang."""
    jobs = background_queue.list_jobs(limit=limit, status=status, job_type=job_type)
    return [j.to_dict() for j in jobs]


@router.get("/{job_id}", response_model=JobItemResponse)
async def get_background_job_detail(job_id: str):
    """Ambil status detail dan hasil eksekusi dari tugas tertentu."""
    job = background_queue.get_job(job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tugas latar belakang dengan ID '{job_id}' tidak ditemukan.",
        )
    return job.to_dict()


@router.post("/{job_id}/cancel")
async def cancel_background_job(job_id: str):
    """Batalkan tugas yang sedang berjalan atau mengantre."""
    ok = background_queue.cancel_job(job_id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tugas tidak ditemukan atau sudah selesai/dibatalkan.",
        )
    return {"ok": True, "message": f"Tugas '{job_id}' berhasil dibatalkan."}


@router.post("/audit/master-items", response_model=JobItemResponse)
async def enqueue_audit_master_items(payload: EnqueueAuditMasterItemRequest):
    """Jalankan audit katalog item duplikat di latar belakang (background queue)."""
    title = "Audit Duplikat Katalog Item Baku"
    if payload.supplier:
        title = f"Audit Duplikat Item ({payload.supplier})"
    job = background_queue.enqueue(
        job_type=JobType.AUDIT_MASTER_ITEMS,
        title=title,
        payload=payload.model_dump(),
    )
    return job.to_dict()


@router.post("/audit/suppliers", response_model=JobItemResponse)
async def enqueue_audit_suppliers(payload: EnqueueAuditSupplierRequest):
    """Jalankan audit toko / supplier duplikat di latar belakang."""
    job = background_queue.enqueue(
        job_type=JobType.AUDIT_SUPPLIERS,
        title="Audit Duplikat Toko / Supplier",
        payload=payload.model_dump(),
    )
    return job.to_dict()


@router.post("/audit/expenses", response_model=JobItemResponse)
async def enqueue_audit_expenses(payload: EnqueueAuditExpenseRequest):
    """Jalankan audit transaksi pengeluaran duplikat di latar belakang."""
    job = background_queue.enqueue(
        job_type=JobType.AUDIT_EXPENSES,
        title="Audit Duplikat Data Pengeluaran",
        payload=payload.model_dump(),
    )
    return job.to_dict()


@router.post("/merge/master-items", response_model=JobItemResponse)
async def enqueue_merge_master_items(payload: EnqueueMergeMasterItemRequest):
    """Jalankan penggabungan master item di latar belakang tanpa memblokir browser."""
    job = background_queue.enqueue(
        job_type=JobType.MERGE_MASTER_ITEMS,
        title=f"Penggabungan Item Baku ke ID #{payload.target_item_id}",
        payload=payload.model_dump(),
    )
    return job.to_dict()


@router.post("/merge/suppliers", response_model=JobItemResponse, dependencies=[Depends(require_admin_role)])
async def enqueue_merge_suppliers(payload: EnqueueMergeSupplierRequest):
    """Jalankan penggabungan supplier di latar belakang (khusus Owner/Admin)."""
    job = background_queue.enqueue(
        job_type=JobType.MERGE_SUPPLIERS,
        title=f"Penggabungan Supplier ke ID #{payload.target_id}",
        payload=payload.model_dump(),
        actor="owner",
    )
    return job.to_dict()


@router.post("/merge/batch-master-items", response_model=JobItemResponse)
async def enqueue_batch_merge_master_items(payload: EnqueueBatchMergeRequest):
    """Jalankan penggabungan banyak grup item duplikat sekaligus dalam satu antrean."""
    job = background_queue.enqueue(
        job_type=JobType.BATCH_MERGE_ITEMS,
        title=f"Penggabungan Massal ({len(payload.merges)} grup item)",
        payload=payload.model_dump(),
    )
    return job.to_dict()
