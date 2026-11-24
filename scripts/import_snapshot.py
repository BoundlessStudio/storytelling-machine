"""Prepare an import privately and install its catalog and derived artwork together."""

from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import mkdtemp


@contextmanager
def import_lock(root: Path):
    scratch = root / "tmp"
    scratch.mkdir(exist_ok=True)
    with (scratch / "story-import.lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def install_snapshot(root: Path, repository: Path, documents: dict[str, str], *, prepare_art: bool) -> None:
    stage = Path(mkdtemp(dir=root / "tmp", prefix="library-import-"))
    retain_for_recovery = False
    try:
        (stage / "content").mkdir()
        files = []
        for name, data in documents.items():
            path = Path("content", name)
            (stage / path).write_text(data, encoding="utf-8")
            files.append(path)
        if prepare_art:
            for module in ("scripts.sync_panorama", "scripts.sync_story_locations"):
                subprocess.run([sys.executable, "-B", "-m", module, "--repository", str(repository.resolve()),
                                "--output-root", str(stage)], cwd=root, check=True)
            files = [Path("static", category) for category in ("panorama", "story-locations", "story-covers")] + [
                Path("content", "panorama.json"), Path("content", "story-locations.json"), *files]
        attempted = []
        try:
            for path in files:
                target = root / path
                backup = stage / "previous" / path
                # Record intent first. An interrupt can arrive just after a successful rename.
                attempted.append(path)
                if target.exists():
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    target.replace(backup)
                target.parent.mkdir(parents=True, exist_ok=True)
                (stage / path).replace(target)
        except BaseException:
            retain_for_recovery = True
            failures = []
            for path in reversed(attempted):
                target, incoming, backup = root / path, stage / path, stage / "previous" / path
                try:
                    if target.exists() and not incoming.exists():
                        target.replace(incoming)
                    if backup.exists():
                        backup.replace(target)
                except OSError as error:
                    failures.append(f"{path}: {error}")
            if failures:
                raise RuntimeError(f"Snapshot restoration incomplete. Recovery files are in {stage}. "
                                   + ", ".join(failures))
            retain_for_recovery = False
            raise
    finally:
        if not retain_for_recovery:
            shutil.rmtree(stage)
