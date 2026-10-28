"""
app/services/job_queue.py — Sistem Antrean & Aksi Latar Belakang (Background Queue & Actions)
Menangani audit berat dan operasi penggabungan (merge) secara asinkron tanpa memblokir request HTTP.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Coroutine
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from app.database.connection import AsyncSessionLocal


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobType(str, Enum):
    AUDIT_MASTER_ITEMS = "audit_master_items"
    AUDIT_SUPPLIERS = "audit_suppliers"
    AUDIT_EXPENSES = "audit_expenses"
    MERGE_MASTER_ITEMS = "merge_master_items"
    MERGE_SUPPLIERS = "merge_suppliers"
    BATCH_MERGE_ITEMS = "batch_merge_items"


@dataclass
class BackgroundJob:
    id: str
    type: JobType
    title: str
    status: JobStatus = JobStatus.QUEUED
    progress: int = 0
    progress_message: str = "Menunggu antrean..."
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    result: Any = None
    error: str | None = None
    actor: str = "user"

    def set_progress(self, pct: int, msg: str | None = None) -> None:
        self.progress = max(0, min(100, pct))
        if msg:
            self.progress_message = msg

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value if isinstance(self.type, JobType) else str(self.type),
            "title": self.title,
            "status": self.status.value if isinstance(self.status, JobStatus) else str(self.status),
            "progress": self.progress,
            "progress_message": self.progress_message,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_seconds": self.duration_seconds,
            "payload": self.payload,
            "result": self.result,
            "error": self.error,
            "actor": self.actor,
        }


class JobQueueManager:
    """Manajer antrean latar belakang in-process dengan worker pool."""

    def __init__(self, max_history: int = 150):
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._jobs: dict[str, BackgroundJob] = {}
        self._running_tasks: dict[str, asyncio.Task] = {}
        self._workers: list[asyncio.Task] = []
        self._session_factory = AsyncSessionLocal
        self._max_history = max_history
        self._is_running = False

    def set_session_factory(self, factory: Any) -> None:
        """Digunakan untuk injeksi sesi database saat pengujian (unit testing)."""
        self._session_factory = factory

    def start_workers(self, num_workers: int = 2) -> None:
        """Nyalakan worker pool untuk memproses antrean tugas."""
        if self._is_running:
            return
        self._is_running = True
        for i in range(num_workers):
            task = asyncio.create_task(self._worker_loop(worker_idx=i))
            self._workers.append(task)

    async def stop_workers(self) -> None:
        """Hentikan worker pool secara aman (graceful shutdown)."""
        self._is_running = False
        for task in self._workers:
            task.cancel()
        if self._workers:
            await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    def enqueue(
        self,
        job_type: JobType,
        title: str,
        payload: dict[str, Any],
        actor: str = "user",
    ) -> BackgroundJob:
        """Daftarkan tugas baru ke dalam antrean."""
        job_id = f"job_{uuid4().hex[:10]}"
        job = BackgroundJob(
            id=job_id,
            type=job_type,
            title=title,
            payload=payload,
            actor=actor,
        )
        self._jobs[job_id] = job
        self._trim_history()
        self._queue.put_nowait(job_id)
        return job

    def get_job(self, job_id: str) -> BackgroundJob | None:
        return self._jobs.get(job_id)

    def list_jobs(
        self,
        limit: int = 50,
        status: JobStatus | str | None = None,
        job_type: JobType | str | None = None,
    ) -> list[BackgroundJob]:
        all_jobs = list(self._jobs.values())
        all_jobs.sort(key=lambda j: j.created_at, reverse=True)

        filtered = []
        for j in all_jobs:
            if status:
                s_val = status.value if isinstance(status, JobStatus) else str(status)
                if j.status.value != s_val:
                    continue
            if job_type:
                t_val = job_type.value if isinstance(job_type, JobType) else str(job_type)
                if j.type.value != t_val:
                    continue
            filtered.append(j)
            if len(filtered) >= limit:
                break
        return filtered

    def cancel_job(self, job_id: str) -> bool:
        """Batalkan tugas yang sedang antre atau sedang berjalan."""
        job = self._jobs.get(job_id)
        if not job:
            return False

        if job.status == JobStatus.QUEUED:
            job.status = JobStatus.CANCELLED
            job.progress_message = "Tugas dibatalkan saat masih dalam antrean"
            job.completed_at = datetime.now(timezone.utc).isoformat()
            return True

        if job.status == JobStatus.RUNNING and job_id in self._running_tasks:
            task = self._running_tasks[job_id]
            task.cancel()
            job.status = JobStatus.CANCELLED
            job.progress_message = "Tugas dibatalkan oleh pengguna"
            job.completed_at = datetime.now(timezone.utc).isoformat()
            return True

        return False

    def _trim_history(self) -> None:
        if len(self._jobs) <= self._max_history:
            return
        sorted_keys = sorted(
            self._jobs.keys(),
            key=lambda k: self._jobs[k].created_at,
        )
        to_remove = len(self._jobs) - self._max_history
        for k in sorted_keys[:to_remove]:
            if self._jobs[k].status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                del self._jobs[k]

    async def _worker_loop(self, worker_idx: int) -> None:
        while self._is_running:
            try:
                job_id = await self._queue.get()
            except asyncio.CancelledError:
                break

            job = self._jobs.get(job_id)
            if not job or job.status == JobStatus.CANCELLED:
                self._queue.task_done()
                continue

            current_task = asyncio.current_task()
            if current_task:
                self._running_tasks[job_id] = current_task

            start_t = datetime.now(timezone.utc)
            job.status = JobStatus.RUNNING
            job.started_at = start_t.isoformat()
            job.set_progress(5, "Memulai pemrosesan tugas...")

            try:
                async with self._session_factory() as session:
                    res = await self._execute_job(job, session)
                    job.result = res
                    job.status = JobStatus.COMPLETED
                    job.set_progress(100, "Tugas berhasil diselesaikan")
            except asyncio.CancelledError:
                job.status = JobStatus.CANCELLED
                job.error = "Tugas dibatalkan saat sedang berjalan"
                job.progress_message = "Dibatalkan"
            except Exception as exc:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                job.progress_message = f"Gagal: {str(exc)}"
            finally:
                end_t = datetime.now(timezone.utc)
                job.completed_at = end_t.isoformat()
                job.duration_seconds = round((end_t - start_t).total_seconds(), 2)
                self._running_tasks.pop(job_id, None)
                self._queue.task_done()

    async def _execute_job(self, job: BackgroundJob, db: AsyncSession) -> Any:
        from app.services.master_item_service import (
            audit_duplicate_master_items,
            merge_master_items,
        )
        from app.services.supplier_service import (
            audit_duplicate_suppliers,
            merge_suppliers,
        )
        from app.services.expense_service import audit_duplicate_expenses

        payload = job.payload

        if job.type == JobType.AUDIT_MASTER_ITEMS:
            job.set_progress(20, "Membaca katalog item dan statistik...")
            min_score = float(payload.get("min_score", 0.70))
            limit = int(payload.get("limit", 150))
            supplier = payload.get("supplier")
            supplier_id = payload.get("supplier_id")
            strict_supplier = bool(payload.get("strict_supplier", False))
            res = await audit_duplicate_master_items(
                db,
                min_score=min_score,
                limit=limit,
                supplier_id=supplier_id,
                supplier_name=supplier,
                strict_supplier=strict_supplier,
            )
            await db.commit()
            job.set_progress(90, f"Menganalisis hasil ({res.get('total_duplicates', 0)} duplikat ditemukan)...")
            return res

        elif job.type == JobType.AUDIT_SUPPLIERS:
            job.set_progress(20, "Menganalisis kemiripan nama toko dan supplier...")
            threshold = float(payload.get("threshold", 0.75))
            res = await audit_duplicate_suppliers(db, threshold=threshold)
            job.set_progress(90, f"Ditemukan {len(res)} cluster toko ganda...")
            return res

        elif job.type == JobType.AUDIT_EXPENSES:
            job.set_progress(20, "Mengecek duplikasi transaksi belanja...")
            min_similarity = float(payload.get("min_similarity", 0.90))
            month = payload.get("month")
            year = payload.get("year")
            category = payload.get("category")
            limit = int(payload.get("limit", 150))
            res = await audit_duplicate_expenses(
                db,
                min_similarity=min_similarity,
                month=month,
                year=year,
                category=category,
                limit=limit,
            )
            job.set_progress(90, f"Ditemukan {res.get('total_duplicates', 0)} duplikat...")
            return res

        elif job.type == JobType.MERGE_MASTER_ITEMS:
            job.set_progress(20, "Memvalidasi target dan item duplikat...")
            res = await merge_master_items(
                db=db,
                target_item_id=payload["target_item_id"],
                source_item_ids=payload["source_item_ids"],
                custom_name=payload.get("custom_name"),
                custom_category=payload.get("custom_category"),
                custom_supplier=payload.get("custom_supplier"),
                custom_satuan_beli=payload.get("custom_satuan_beli"),
                custom_tipe_satuan=payload.get("custom_tipe_satuan"),
                custom_isi_paket=payload.get("custom_isi_paket"),
                custom_satuan_ecer=payload.get("custom_satuan_ecer"),
                merge_aliases=payload.get("merge_aliases", True),
                update_expenses=payload.get("update_expenses", True),
            )
            job.set_progress(80, "Menyimpan transaksi dan alias...")
            await db.commit()
            return res

        elif job.type == JobType.MERGE_SUPPLIERS:
            job.set_progress(30, "Mengalihkan riwayat belanja ke supplier utama...")
            res = await merge_suppliers(
                db=db,
                target_id=payload["target_id"],
                source_ids=payload["source_ids"],
                actor=job.actor,
            )
            job.set_progress(80, "Menyimpan riwayat dan alias toko...")
            await db.commit()
            return res

        elif job.type == JobType.BATCH_MERGE_ITEMS:
            merges: list[dict] = payload.get("merges", [])
            total = len(merges)
            if total == 0:
                return {"success": True, "merged_count": 0, "results": []}

            results = []
            total_reassigned = 0
            for idx, m_spec in enumerate(merges):
                pct = int(10 + (idx / total) * 80)
                job.set_progress(pct, f"Menggabungkan grup item #{idx + 1} dari {total}...")
                try:
                    m_res = await merge_master_items(
                        db=db,
                        target_item_id=m_spec["target_item_id"],
                        source_item_ids=m_spec["source_item_ids"],
                        custom_name=m_spec.get("custom_name"),
                        custom_category=m_spec.get("custom_category"),
                        custom_supplier=m_spec.get("custom_supplier"),
                        merge_aliases=m_spec.get("merge_aliases", True),
                        update_expenses=m_spec.get("update_expenses", True),
                    )
                    results.append(m_res)
                    total_reassigned += m_res.get("expenses_reassigned_count", 0)
                except Exception as e:
                    results.append({
                        "ok": False,
                        "error": str(e),
                        "target_item_id": m_spec["target_item_id"],
                    })

            await db.commit()
            return {
                "success": True,
                "merged_count": len([r for r in results if r.get("ok", True)]),
                "total_expenses_reassigned": total_reassigned,
                "results": results,
            }

        raise ValueError(f"Tipe tugas latar belakang tidak dikenali: {job.type}")


# Singleton instance global
background_queue = JobQueueManager()
