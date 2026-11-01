"""
tests/test_job_queue.py — Uji unit dan integrasi untuk Sistem Antrean Latar Belakang (Job Queue)
"""
import asyncio
from datetime import date
from decimal import Decimal
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.main import app
from app.database.connection import get_db
from app.services.dashboard_auth_service import create_session_token, SESSION_COOKIE_NAME
from app.services.job_queue import JobQueueManager, JobStatus, JobType
from app.models.master_item import MasterItem
from app.models.expense import Expense
from app.models.supplier import Supplier
from app.services.master_item_service import create_master_item


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


@pytest.mark.asyncio
async def test_job_queue_manager_basic_lifecycle(engine):
    """Test enqueue, cancellation, dan listing pada JobQueueManager."""
    queue = JobQueueManager()
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    queue.set_session_factory(session_factory)

    # 1. Enqueue job saat worker mati (status harus queued)
    job = queue.enqueue(
        job_type=JobType.AUDIT_MASTER_ITEMS,
        title="Test Audit Master Items",
        payload={"min_score": 0.70},
    )
    assert job.status == JobStatus.QUEUED
    assert job.progress == 0

    # 2. Ambil dari get_job & list_jobs
    fetched = queue.get_job(job.id)
    assert fetched is not None
    assert fetched.id == job.id

    jobs_list = queue.list_jobs()
    assert len(jobs_list) >= 1
    assert jobs_list[0].id == job.id

    # 3. Cancel queued job
    cancelled = queue.cancel_job(job.id)
    assert cancelled is True
    assert job.status == JobStatus.CANCELLED


@pytest.mark.asyncio
async def test_job_queue_processes_master_items_audit(engine):
    """Test eksekusi background audit master items dengan worker berjalan."""
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Siapkan data master items duplikat
    async with session_factory() as db:
        await create_master_item(db, item_name="Cokelat Bubuk Van Houten 100gr", category="Bahan Kue")
        await create_master_item(db, item_name="Cokelat Bubuk Van Houten 100g", category="Bahan Kue")
        await db.commit()

    queue = JobQueueManager()
    queue.set_session_factory(session_factory)
    queue.start_workers(num_workers=1)

    try:
        job = queue.enqueue(
            job_type=JobType.AUDIT_MASTER_ITEMS,
            title="Audit Duplikat Cokelat",
            payload={"min_score": 0.70, "limit": 10},
        )

        # Tunggu hingga selesai
        for _ in range(50):
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                break
            await asyncio.sleep(0.1)

        assert job.status == JobStatus.COMPLETED
        assert job.progress == 100
        assert job.result is not None
        assert job.result["ok"] is True
        assert len(job.result["pairs"]) >= 1
    finally:
        await queue.stop_workers()


@pytest.mark.asyncio
async def test_job_queue_processes_merge_master_items(engine):
    """Test eksekusi background merge master items beserta pengalihan transaksi belanja."""
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        item_a = await create_master_item(db, item_name="Terigu Segitiga Biru 1kg", category="Bahan Kue")
        item_b = await create_master_item(db, item_name="Tepung Terigu Segitiga Biru 1kg", category="Bahan Kue")
        await db.commit()

        exp = Expense(
            expense_date=date(2026, 10, 26),
            item_name="Tepung Terigu Segitiga Biru 1kg",
            master_item_id=item_b.id,
            qty=Decimal("2"),
            unit="Kg",
            unit_price=Decimal("14000"),
            total_price=Decimal("28000"),
            category="Bahan Kue",
            pay_method="Tunai",
            pay_status="Lunas",
        )
        db.add(exp)
        await db.commit()
        target_id = item_a.id
        source_id = item_b.id

    queue = JobQueueManager()
    queue.set_session_factory(session_factory)
    queue.start_workers(num_workers=1)

    try:
        job = queue.enqueue(
            job_type=JobType.MERGE_MASTER_ITEMS,
            title="Merge Terigu",
            payload={
                "target_item_id": target_id,
                "source_item_ids": [source_id],
                "custom_name": "Tepung Terigu Segitiga Biru 1kg",
                "merge_aliases": True,
                "update_expenses": True,
            },
        )

        for _ in range(50):
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                break
            await asyncio.sleep(0.1)

        assert job.status == JobStatus.COMPLETED
        assert job.result["ok"] is True
        assert job.result["expenses_reassigned_count"] == 1

        # Verifikasi item_b sudah terhapus dan expense dialihkan ke target_id
        async with session_factory() as db:
            src = await db.get(MasterItem, source_id)
            assert src is None

            target = await db.get(MasterItem, target_id)
            assert target is not None
            assert "Terigu Segitiga Biru 1kg" in target.aliases
    finally:
        await queue.stop_workers()


@pytest.mark.asyncio
async def test_api_jobs_endpoints(client: AsyncClient, auth_cookies, engine):
    """Test API endpoint /api/v1/jobs."""
    from app.services.job_queue import background_queue
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    background_queue.set_session_factory(session_factory)

    # 1. Enqueue audit via API
    res = await client.post(
        "/api/v1/jobs/audit/master-items",
        json={"min_score": 0.70, "limit": 50},
        cookies=auth_cookies,
    )
    assert res.status_code == 200
    data = res.json()
    job_id = data["id"]
    assert data["status"] in ("queued", "running", "completed")

    # 2. Get Job Detail
    res_detail = await client.get(f"/api/v1/jobs/{job_id}", cookies=auth_cookies)
    assert res_detail.status_code == 200
    assert res_detail.json()["id"] == job_id

    # 3. List Jobs
    res_list = await client.get("/api/v1/jobs?limit=10", cookies=auth_cookies)
    assert res_list.status_code == 200
    assert any(j["id"] == job_id for j in res_list.json())

    # 4. Cancel invalid job returns 400
    res_cancel = await client.post("/api/v1/jobs/non_existent_id/cancel", cookies=auth_cookies)
    assert res_cancel.status_code == 400


@pytest.mark.asyncio
async def test_job_queue_processes_batch_merge(engine):
    """Test eksekusi background batch merge beberapa grup item duplikat sekaligus."""
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as db:
        g1_a = await create_master_item(db, item_name="Gula Pasir Gulaku 1kg", category="Bahan Baku")
        g1_b = await create_master_item(db, item_name="Gula Pasir Gulaku 1 kg", category="Bahan Baku")
        g2_a = await create_master_item(db, item_name="Minyak Bimoli 2L", category="Bahan Baku")
        g2_b = await create_master_item(db, item_name="Minyak Bimoli 2 Liter", category="Bahan Baku")
        await db.commit()
        id1_a, id1_b = g1_a.id, g1_b.id
        id2_a, id2_b = g2_a.id, g2_b.id

    queue = JobQueueManager()
    queue.set_session_factory(session_factory)
    queue.start_workers(num_workers=1)

    try:
        job = queue.enqueue(
            job_type=JobType.BATCH_MERGE_ITEMS,
            title="Batch Merge 2 Pasang",
            payload={
                "merges": [
                    {
                        "target_item_id": id1_a,
                        "source_item_ids": [id1_b],
                        "custom_name": "Gula Pasir Gulaku 1kg",
                    },
                    {
                        "target_item_id": id2_a,
                        "source_item_ids": [id2_b],
                        "custom_name": "Minyak Bimoli 2 Liter",
                    },
                ]
            },
        )

        for _ in range(50):
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                break
            await asyncio.sleep(0.1)

        assert job.status == JobStatus.COMPLETED
        assert job.result["merged_count"] == 2

        async with session_factory() as db:
            assert await db.get(MasterItem, id1_b) is None
            assert await db.get(MasterItem, id2_b) is None
            assert await db.get(MasterItem, id1_a) is not None
            assert await db.get(MasterItem, id2_a) is not None
    finally:
        await queue.stop_workers()


@pytest.mark.asyncio
async def test_job_queue_database_persistence(engine):
    """Test bahwa job otomatis disimpan ke database dan bisa dibaca ulang meski cache memori dihapus."""
    from app.models.background_job import BackgroundJobRecord
    from sqlalchemy import select

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    queue = JobQueueManager()
    queue.set_session_factory(session_factory)
    queue.start_workers(num_workers=1)

    try:
        job = queue.enqueue(
            job_type=JobType.AUDIT_MASTER_ITEMS,
            title="Persistence Test Job",
            payload={"min_score": 0.80, "limit": 5},
        )

        for _ in range(50):
            if job.status in (JobStatus.COMPLETED, JobStatus.FAILED):
                break
            await asyncio.sleep(0.1)

        assert job.status == JobStatus.COMPLETED

        # Verifikasi record tersimpan di tabel background_jobs
        async with session_factory() as db:
            stmt = select(BackgroundJobRecord).where(BackgroundJobRecord.id == job.id)
            res = await db.execute(stmt)
            record = res.scalar_one_or_none()
            assert record is not None
            assert record.id == job.id
            assert record.status == "completed"
            assert record.progress == 100
            assert record.title == "Persistence Test Job"
            assert record.payload == {"min_score": 0.80, "limit": 5}
            assert record.result is not None

        # Simulasikan server restart dengan membersihkan in-memory cache
        queue._jobs.clear()
        assert queue.get_job(job.id) is None

        # Ambil kembali via get_job_async (database fallback)
        recovered_job = await queue.get_job_async(job.id)
        assert recovered_job is not None
        assert recovered_job.id == job.id
        assert recovered_job.status == JobStatus.COMPLETED
        assert recovered_job.progress == 100

        # Ambil kembali via list_jobs_async
        recovered_list = await queue.list_jobs_async(limit=10)
        assert any(j.id == job.id for j in recovered_list)
    finally:
        await queue.stop_workers()


@pytest.mark.asyncio
async def test_job_queue_recovery_on_startup(engine):
    """Test pemulihan tugas orphaned (running -> failed, queued -> re-enqueue) saat server startup."""
    from app.models.background_job import BackgroundJobRecord
    from datetime import datetime, timezone
    from sqlalchemy import select

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Siapkan 1 job running (orphaned saat server mati mendadak) dan 1 job queued di DB
    async with session_factory() as db:
        orphan_running = BackgroundJobRecord(
            id="job_orphaned_run",
            type="audit_suppliers",
            title="Interrupted Job",
            status="running",
            progress=40,
            progress_message="Sedang berjalan...",
            created_at=datetime.now(timezone.utc),
            started_at=datetime.now(timezone.utc),
            payload={},
            actor="test",
        )
        orphan_queued = BackgroundJobRecord(
            id="job_orphaned_que",
            type="audit_suppliers",
            title="Queued Job to Recover",
            status="queued",
            progress=0,
            progress_message="Menunggu...",
            created_at=datetime.now(timezone.utc),
            payload={"threshold": 0.80},
            actor="test",
        )
        db.add_all([orphan_running, orphan_queued])
        await db.commit()

    queue = JobQueueManager()
    queue.set_session_factory(session_factory)

    # Jalankan proses pemulihan
    await queue.recover_orphaned_jobs()

    # 1. Job running harus ditandai 'failed'
    async with session_factory() as db:
        res = await db.execute(select(BackgroundJobRecord).where(BackgroundJobRecord.id == "job_orphaned_run"))
        rec_run = res.scalar_one_or_none()
        assert rec_run is not None
        assert rec_run.status == "failed"
        assert "direstart" in (rec_run.error or "")

    # 2. Job queued harus dimasukkan ke antrean memori
    assert "job_orphaned_que" in queue._jobs
    assert queue._jobs["job_orphaned_que"].status == JobStatus.QUEUED
    assert queue._queue.qsize() == 1


