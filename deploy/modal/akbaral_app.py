"""
AKBARAL! — Modal production deployment wrapper (Path B: Modal + Neon).

Runs the public GHCR image (built by .github/workflows/docker-publish.yml,
contains the dual-engine SQLite/PostgreSQL build) as an always-on Modal
web service backed by a Neon PostgreSQL database.

Verified against Modal Python SDK 1.5.5 and the live 2026-09 Modal docs:
  - modal.Image.from_registry(tag, add_python=...)   [docs/reference/modal.Image]
  - @app.function(cpu, memory, min_containers, max_containers, timeout,
     secrets, env, volumes, schedule)                [docs/reference/modal.Function]
  - @modal.concurrent(max_inputs=...)                [docs/guide/concurrent-inputs]
  - @modal.web_server(port, startup_timeout, label)  [docs/sdk/py/latest/web_server]
  - modal.Secret.from_name(name, required_keys=...)  [docs/guide/secrets]
  - modal.Volume.from_name(name, create_if_missing)  [volumes]

Secrets live ONLY in Modal (created via `modal secret create` or the
dashboard at https://modal.com/secrets). Nothing sensitive is stored in
this repository. See deploy/modal/README.md for the full runbook.

Deploy:    modal deploy deploy/modal/akbaral_app.py
One-shots: modal run deploy/modal/akbaral_app.py::seed_database
           modal run deploy/modal/akbaral_app.py::backup_database
"""

import subprocess

import modal

APP_NAME = "akbaral-app"
IMAGE_REF = "ghcr.io/azadar-templates/akbaral:latest"  # or pin: akbaral:b7debed1cca15795d369cf074b476b55ba8593f4
WORKDIR = "/app"  # image WORKDIR
WEB_PORT = 3000  # public port: Next.js rewrites /api,/uploads,/ws to the internal API on :4000
BACKUP_DIR = "/backups"
BACKUP_VOLUME = "akbaral-backups"

image = modal.Image.from_registry(IMAGE_REF, add_python="3.11")

app = modal.App(APP_NAME, image=image)

# DATABASE_URL  — Neon pooled connection string (postgres://…?sslmode=require)
# SESSION_SECRET — production session signing key (>= 32 chars)
# GOOGLE_API_KEY — optional: Gemini free-tier provider key
production = modal.Secret.from_name(
    "akbaral-production",
    required_keys=["DATABASE_URL", "SESSION_SECRET"],
)

backups = modal.Volume.from_name(BACKUP_VOLUME, create_if_missing=True)


@app.function(
    cpu=0.25,  # ~0.25 vCPU baseline
    memory=1024,  # MiB = 1 GiB
    min_containers=1,  # always-on: no cold starts for the launch
    max_containers=1,  # single container: the in-process automation scheduler
    # and execution queue must never run twice against one database
    timeout=3600,  # generous headroom for long-lived SSE/WebSocket execution streams
    secrets=[production],
    # The container filesystem is ephemeral on Modal: disable the image's
    # internal nightly cron (it would pg_dump to a disk that vanishes on
    # redeploy). Real backups run on the volume via backup_database below.
    env={"DISABLE_BACKUP_CRON": "1"},
)
@modal.concurrent(max_inputs=100)  # Node serves many connections per container
@modal.web_server(WEB_PORT, startup_timeout=300, label="akbaral")
def web() -> None:
    """Always-on AKBARAL! web service.

    The image's entrypoint applies database migrations, then starts the
    production stack (API :4000 + web :3000) with graceful SIGTERM handling.
    Modal probes the web port (up to startup_timeout) and terminates the
    container on stop, which start-prod.mjs turns into a clean shutdown.

    The launching shell supervises: if the Node stack ever exits, it is
    restarted after 5 seconds (migrations are idempotent), so a crashed
    process self-heals without waiting for a container replacement.
    """
    subprocess.Popen(
        [
            "sh",
            "-c",
            "while true; do sh /app/scripts/entrypoint.sh; "
            "echo '[modal-wrapper] akbaral stack exited; restarting in 5s' >&2; sleep 5; done",
        ],
        cwd=WORKDIR,
    )


@app.function(secrets=[production], timeout=1800)
def seed_database() -> None:
    """One-shot: migrate + seed plans, the 4,001-agent registry, and service
    accounts. Safe on a brand-new Neon database (runs migrations first) and
    idempotent on re-run.
    """
    subprocess.run(["node", "dist/src/db/migrate.js"], cwd=WORKDIR, check=True)
    subprocess.run(["node", "dist/src/db/seed.js"], cwd=WORKDIR, check=True)


@app.function(
    secrets=[production],
    volumes={BACKUP_DIR: backups},
    timeout=900,
    schedule=modal.Cron("17 1 * * *"),  # nightly 01:17 UTC, same slot as the SQLite cron
)
def backup_database() -> None:
    """Nightly verified pg_dump snapshot onto the akbaral-backups volume.

    Runs the image's engine-aware backup CLI, which pg_dump's Neon with
    credentials passed only through child environment variables, verifies
    COPY data for the core tables exists in the dump, and keeps the last
    30 snapshots. Also invocable on demand.
    """
    subprocess.run(
        ["node", "dist/src/scripts/backup-db.js", BACKUP_DIR, "30"],
        cwd=WORKDIR,
        check=True,
    )
    volume = modal.Volume.from_name(BACKUP_VOLUME, create_if_missing=True)
    volume.commit()


@app.function(secrets=[production], volumes={BACKUP_DIR: backups}, timeout=1800)
def restore_database(dump_file: str) -> None:
    """Restore a dump from the backup volume by file name.

    Takes an automatic pre-restore safety snapshot first (same volume).
    The web service should be stopped during restore: `modal app stop`.
    """
    subprocess.run(
        ["node", "dist/src/scripts/restore-db.js", f"{BACKUP_DIR}/{dump_file}"],
        cwd=WORKDIR,
        check=True,
    )
    volume = modal.Volume.from_name(BACKUP_VOLUME, create_if_missing=True)
    volume.commit()
