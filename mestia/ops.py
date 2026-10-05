"""Local backup and offline restore. Archives exclude .env, but include user credentials."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import stat
import tempfile
import zipfile


@contextmanager
def runtime_lock(database):
    """Serialize supported server and restore processes on Unix/Android."""
    path = Path(str(database) + ".runtime.lock")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        os.chmod(path, 0o600)
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Server is running. Stop it before this operation.") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def backup(database, media_dir, output):
    database, media_dir, output = Path(database), Path(media_dir), Path(output)
    if not database.is_file():
        raise ValueError("Database does not exist. Run init-db first.")
    if output.exists():
        raise ValueError("Backup destination already exists; choose a new filename.")
    if output.resolve() == database.resolve() or output.resolve().is_relative_to(media_dir.resolve()):
        raise ValueError("Save the backup outside the database and media directory.")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Serialize with the supported server: image uploads and SQLite rows then
    # represent the same stopped application state, with no half-copied uploads.
    with runtime_lock(database), tempfile.TemporaryDirectory(prefix="mestia-backup-") as tmp:
        snapshot = Path(tmp) / "database.sqlite3"
        source = sqlite3.connect(database)
        target = sqlite3.connect(snapshot)
        try:
            source.backup(target)
            # Make a self-contained portable snapshot, even when the source is
            # WAL-backed. A restore may target a host that cannot support WAL
            # (for example PythonAnywhere's network filesystem).
            target.execute("PRAGMA journal_mode = DELETE")
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Database failed integrity check.")
        finally:
            target.close()
            source.close()
        temporary_output = output.with_name(output.name + ".partial")
        if temporary_output.exists():
            raise ValueError("A partial backup already exists at the destination.")
        try:
            with temporary_output.open("xb") as raw:
                os.chmod(temporary_output, 0o600)
                with zipfile.ZipFile(raw, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.write(snapshot, "database.sqlite3")
                    archive.writestr("manifest.json", json.dumps({
                        "format": "mestia-backup", "version": 1,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "environment_secrets_included": False,
                    }))
                    if media_dir.exists():
                        for path in sorted(media_dir.rglob("*")):
                            if path.is_symlink():
                                raise ValueError("Media directory contains a symbolic link; backup aborted.")
                            if path.is_file():
                                archive.write(path, "media/" + path.relative_to(media_dir).as_posix())
            os.replace(temporary_output, output)
        except BaseException:
            temporary_output.unlink(missing_ok=True)
            raise
    return output


def _extract_verified(archive_path, staging):
    seen = set()
    with zipfile.ZipFile(archive_path) as archive:
        total = 0
        for item in archive.infolist():
            name = PurePosixPath(item.filename)
            if (item.filename in seen or name.is_absolute() or ".." in name.parts
                    or "\\" in item.filename or not name.parts
                    or (item.filename not in ("manifest.json", "database.sqlite3") and name.parts[0] != "media")
                    or stat.S_ISLNK(item.external_attr >> 16)):
                raise ValueError("Backup contains an unsafe or unexpected entry.")
            seen.add(item.filename)
            total += item.file_size
            if total > 2 * 1024 ** 3 or len(seen) > 100000:
                raise ValueError("Backup exceeds the 2 GiB / 100,000-file restore limit.")
        archive.extractall(staging)
    manifest = json.loads((staging / "manifest.json").read_text())
    if not isinstance(manifest, dict) or manifest.get("format") != "mestia-backup" or manifest.get("version") != 1:
        raise ValueError("Unsupported backup format.")
    dbpath = staging / "database.sqlite3"
    if not dbpath.is_file():
        raise ValueError("Backup is missing its database.")
    conn = sqlite3.connect(dbpath.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Backup database failed integrity check.")
        required = {"users", "settings", "services", "enquiries", "quotes", "bookings", "resources"}
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required <= tables:
            raise ValueError("This is not a complete Mestia application database.")
        if conn.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Backup database contains invalid references.")
    finally:
        conn.close()
    (staging / "media").mkdir(exist_ok=True)


def restore(database, media_dir, archive_path):
    database, media_dir, archive_path = Path(database), Path(media_dir), Path(archive_path)
    if database.resolve().is_relative_to(media_dir.resolve()) or media_dir.resolve().is_relative_to(database.resolve()):
        raise ValueError("Database and media destinations must be separate paths.")
    database.parent.mkdir(parents=True, exist_ok=True)
    media_dir.parent.mkdir(parents=True, exist_ok=True)
    with runtime_lock(database), tempfile.TemporaryDirectory(prefix="mestia-restore-", dir=database.parent) as tmp:
        staging = Path(tmp)
        _extract_verified(archive_path, staging)
        # A backup of the pre-restore state provides a manual recovery route too.
        old_db = database.with_name(database.name + ".pre-restore")
        old_media = media_dir.with_name(media_dir.name + ".pre-restore")
        if old_db.exists() or old_media.exists():
            raise ValueError("A .pre-restore copy already exists. Preserve or remove it before another restore.")
        if database.exists():
            check = sqlite3.connect(database, timeout=1, isolation_level=None)
            try:
                check.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                check.execute("BEGIN EXCLUSIVE")
                check.execute("COMMIT")
            except sqlite3.OperationalError as exc:
                raise RuntimeError("Database is busy. Stop every application process before restore.") from exc
            finally:
                check.close()
        staged_media = Path(tempfile.mkdtemp(prefix=".mestia-media-", dir=media_dir.parent))
        db_moved = media_moved = new_db = new_media = False
        try:
            shutil.copytree(staging / "media", staged_media, dirs_exist_ok=True)
            if database.exists():
                os.replace(database, old_db)
                db_moved = True
            if media_dir.exists():
                os.replace(media_dir, old_media)
                media_moved = True
            # Server runtime lock is held and all SQLite connections are closed.
            for suffix in ("-wal", "-shm"):
                Path(str(database) + suffix).unlink(missing_ok=True)
            os.replace(staging / "database.sqlite3", database)
            new_db = True
            os.chmod(database, 0o600)
            os.replace(staged_media, media_dir)
            new_media = True
        except BaseException:
            if new_db:
                database.unlink(missing_ok=True)
            if new_media:
                shutil.rmtree(media_dir)
            if db_moved:
                os.replace(old_db, database)
            if media_moved:
                os.replace(old_media, media_dir)
            raise
        finally:
            if staged_media.exists():
                shutil.rmtree(staged_media)
    return database
