"""Accepted illustrations owned by the presentation repository."""

from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import quote


STUDIES = ("characters", "landscapes", "interiors")
FORMATS = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


def verified_archived_cover(static: Path, slug: str, edition: dict, original_digest: str | None,
                            prepared: dict[str, str]) -> Path:
    """Resolve the published texture only for its recorded original cover."""
    if (not isinstance(original_digest, str) or not re.fullmatch(r"[a-f0-9]{64}", original_digest)
            or edition["withdrawnOriginals"]["title-image.jpg"] != original_digest):
        raise ValueError(f"Archived reader cover does not match the approved original for {slug}")
    relative = prepared.get(slug)
    if (not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug)
            or relative not in (f"panorama/{slug}-cover.webp", f"story-covers/{slug}.webp")):
        raise ValueError(f"Invalid archived reader cover path for {slug}: {relative}")
    path = static / relative
    if (path.resolve() != static.resolve() / relative or not path.is_file()
            or sha256(path.read_bytes()).hexdigest() != edition["preparedCoverSha256"]):
        raise ValueError(f"Cannot verify archived reader cover for {slug}: {relative}")
    return path


def local_file(path: Path, root: Path) -> bool:
    if not path.is_file():
        return False
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Artwork outside the presentation repository: {path}")
    return True


def local_artwork(static: Path, base: str) -> dict[str, dict]:
    root = static / "story-art"
    assets = {}
    if not root.is_dir():
        return assets
    for directory in sorted(root.iterdir()):
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", directory.name) or not directory.is_dir():
            continue
        receipt = directory / "illustrations.json"
        reviewed = None
        if local_file(receipt, static):
            reviewed = json.loads(receipt.read_text(encoding="utf-8")).get("sha256")
            if not isinstance(reviewed, dict) or "title-image.jpg" not in reviewed:
                raise ValueError(f"Missing reviewed cover digest in {receipt}")
        found = set()
        candidates = [directory / "title-image.jpg"]
        for category in STUDIES:
            candidates.extend(sorted((directory / "art" / category).glob("*")))
        for path in candidates:
            relative = path.relative_to(directory).as_posix()
            if reviewed is not None and relative not in reviewed:
                continue
            media_type = FORMATS.get(path.suffix.lower())
            if not media_type or path.name.startswith(".") or not local_file(path, static):
                continue
            name = path.relative_to(root).as_posix()
            logical = f"stories/{name}"
            digest = sha256(path.read_bytes()).hexdigest()
            if reviewed is not None and digest != reviewed[relative]:
                raise ValueError(f"Reviewed illustration changed: {path}")
            found.add(relative)
            assets[logical] = {"path": logical, "local_file": path, "sha256": digest,
                               "contentType": media_type,
                               "url": f"{base}story-art/{quote(name)}?v={digest[:12]}"}
        if reviewed is not None and (missing := reviewed.keys() - found):
            raise ValueError(f"Missing reviewed illustration for {directory.name}: {sorted(missing)}")
    return assets
