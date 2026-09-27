"""Pin the public story publication snapshots without copying media files.

Run against a Git revision so a local working tree cannot silently change the
published content. The existing story repository remains the editorial source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path, PurePosixPath


SNAPSHOTS = (
    "catalog.json",
    "characters.json",
    "landscapes.json",
    "interiors.json",
    "illustrated.json",
    "graphic-novels.json",
)


def git_bytes(repository: Path, revision: str, path: str) -> bytes:
    result = subprocess.run(
        ["git", "-C", str(repository), "show", f"{revision}:pages/{path}"],
        check=True,
        capture_output=True,
    )
    return result.stdout


def safe_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or "\\" in value or any(
        part in {"", ".", ".."} for part in value.split("/")
    ):
        raise ValueError(f"Unsafe publication path: {value!r}")
    return value


def sync(repository: Path, revision: str, output: Path) -> None:
    commit = subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", f"{revision}^{{commit}}"],
        text=True,
    ).strip()
    snapshots = {
        name: json.loads(git_bytes(repository, commit, name).decode("utf-8"))
        for name in SNAPSHOTS
    }
    stories = snapshots["catalog.json"]["stories"]
    slugs = [story["slug"] for story in stories]
    if len(set(slugs)) != len(slugs):
        raise ValueError("The catalog contains duplicate story slugs")
    for name in ("characters.json", "landscapes.json", "interiors.json"):
        for entry in snapshots[name]["stories"]:
            if entry["slug"] not in slugs:
                raise ValueError(f"{name} references an unpublished story: {entry['slug']}")
            for artwork in entry["images"]:
                for size in ("full", "thumbnail"):
                    safe_relative_path(artwork[size]["path"])

    covers = {}
    for story in stories:
        cover = safe_relative_path(story["cover"])
        if not cover.startswith("covers/"):
            raise ValueError(f"Unexpected cover location: {cover}")
        covers[cover] = hashlib.sha256(git_bytes(repository, commit, cover)).hexdigest()

    output.mkdir(parents=True, exist_ok=True)
    for name, payload in snapshots.items():
        (output / name).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    (output / "covers.json").write_text(
        json.dumps(covers, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    (output / "source.json").write_text(
        json.dumps(
            {"repository": "BoundlessStudio/story-computing-machine", "commit": commit},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Pinned {len(stories)} stories from {commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "content")
    args = parser.parse_args()
    sync(args.repository, args.revision, args.output)
