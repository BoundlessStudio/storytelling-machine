"""Import new stories only after their art appears in the verified public R2 index.

The check phase writes a pinned copy of the public index and GitHub Actions
outputs. The apply phase uses that copy and the matching source commit.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from scripts.build import CONTENT, DEFAULT_INDEX_URL, validate_media_index
from scripts.sync_ratings import sync


ROOT = Path(__file__).resolve().parents[1]
INDEX_SNAPSHOT = ROOT / ".cache" / "publication-index.json"
COVER_PATH = re.compile(r"stories/([a-z0-9]+(?:-[a-z0-9]+)*)/title-image\.jpg\Z")


def published_new_slugs(index: dict, catalog: dict) -> list[str]:
    assets = validate_media_index(index)
    existing = {story["slug"] for story in catalog["stories"]}
    covers = {match.group(1) for path in assets if (match := COVER_PATH.fullmatch(path))}
    return sorted(covers - existing)


def public_index() -> dict:
    # The publisher verifies the index with a versioned URL. A fresh query here
    # avoids reading an older CDN cache entry after that verification succeeds.
    url = DEFAULT_INDEX_URL + "?" + urlencode({"v": uuid4().hex})
    request = Request(url, headers={"User-Agent": "StorytellingMachine-PublicationSync/1.0",
                                    "Accept-Encoding": "identity"})
    with urlopen(request, timeout=30) as response:
        index = json.load(response)
    validate_media_index(index)
    return index


def github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as output:
            for key, value in values.items():
                output.write(f"{key}={value}\n")


def check() -> None:
    index = public_index()
    catalog = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))
    slugs = published_new_slugs(index, catalog)
    INDEX_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    INDEX_SNAPSHOT.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n",
                              encoding="utf-8")
    github_output(has_new=str(bool(slugs)).lower(), source_commit=index["sourceCommit"])
    print(f"Verified public index {index['sourceCommit'][:12]}: {len(slugs)} new covered stories")
    if slugs:
        print("New covers: " + ", ".join(slugs))


def git(repository: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repository), *args], text=True).strip()


def apply(repository: Path) -> None:
    index = json.loads(INDEX_SNAPSHOT.read_text(encoding="utf-8"))
    validate_media_index(index)
    commit = index["sourceCommit"]
    if git(repository, "cat-file", "-t", commit) != "commit":
        raise ValueError("Published R2 index commit is absent from the source checkout")
    catalog = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))
    slugs = published_new_slugs(index, catalog)
    if not slugs:
        print("No new covered stories")
        return
    source_paths = set(git(repository, "ls-tree", "-r", "--name-only", commit, "stories").splitlines())
    for slug in slugs:
        required = {f"stories/{slug}/{name}" for name in ("story.md", "prompt.md", "ratings.md",
                                                            "title-image.jpg")}
        missing = required - source_paths
        if missing:
            raise ValueError(f"Published cover for {slug} lacks source files: {', '.join(sorted(missing))}")

    # sync() inserts each story at the front of the catalog. Import oldest first.
    slugs.sort(key=lambda slug: (git(repository, "log", "--format=%aI", "--reverse", commit,
                                     "--", f"stories/{slug}/story.md").splitlines()[0], slug))
    sync(repository, commit, slugs)
    (CONTENT / "media-index.json").write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    covers = json.loads((CONTENT / "covers.json").read_text(encoding="utf-8"))
    assets = validate_media_index(index)
    for story in json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]:
        key = f"stories/{story['slug']}/title-image.jpg"
        if covers[story["cover"]] != assets[key]["sha256"]:
            raise ValueError(f"Published cover differs from source commit: {story['slug']}")

    summary = ROOT / ".cache" / "publication-pr.md"
    summary.write_text(
        "Imports the following stories after their art and the R2 index were verified:\n\n"
        + "".join(f"- `{slug}`\n" for slug in slugs)
        + f"\nSource commit: `{commit}`\nPublic art index: {index['indexUrl']}\n",
        encoding="utf-8")
    github_output(story_count=str(len(slugs)))
    print(f"Imported {len(slugs)} stories from verified index {commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="Check the public index for new covered stories")
    group.add_argument("--apply", action="store_true", help="Import from the pinned index snapshot")
    parser.add_argument("--repository", type=Path, help="Source checkout at the index sourceCommit")
    args = parser.parse_args()
    if args.check:
        check()
    else:
        if not args.repository:
            parser.error("--repository is required with --apply")
        apply(args.repository)
