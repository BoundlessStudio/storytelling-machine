"""Refresh published prose, canon metadata, ratings and covers from a pinned source commit."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

if __package__:
    from .illustrate_import import SLUG, ensure_illustrations
    from .import_snapshot import import_lock, install_snapshot
    from .story_art import local_file
else:
    from illustrate_import import SLUG, ensure_illustrations
    from import_snapshot import import_lock, install_snapshot
    from story_art import local_file


ROOT = Path(__file__).resolve().parents[1]
RATINGS = {"General", "Teen", "Mature", "Explicit"}


def git_bytes(repository: Path, commit: str, path: str) -> bytes:
    return subprocess.check_output(
        ["git", "-C", str(repository), "show", f"{commit}:{path}"], stderr=subprocess.PIPE
    )


def git_text(repository: Path, commit: str, path: str) -> str:
    return git_bytes(repository, commit, path).decode("utf-8")


def source_rating(repository: Path, commit: str, slug: str) -> str:
    try:
        source = git_text(repository, commit, f"stories/{slug}/ratings.md")
    except subprocess.CalledProcessError as error:
        existing = subprocess.check_output(
            ["git", "-C", str(repository), "ls-tree", "--name-only", commit,
             f"stories/{slug}/ratings.md"], text=True
        ).strip()
        if existing:
            raise
        overrides = json.loads((ROOT / "content" / "rating-overrides.json").read_text(encoding="utf-8"))
        rating = overrides.get(slug)
        if rating in RATINGS:
            return rating
        raise ValueError(f"Missing source rating for {slug}") from error
    match = re.search(r"^- \*\*Rating:\*\* (.+)$", source, re.MULTILINE)
    if match:
        rating = match.group(1).strip()
    else:
        lines = [line.strip() for line in source.splitlines()]
        heading = next((i for i, line in enumerate(lines)
                        if line.lower() in {"# rating", "# content rating"}), None)
        rating = next((line for line in lines[heading + 1:] if line), None) if heading is not None else None
    if rating not in RATINGS:
        raise ValueError(f"Missing or unsupported rating for {slug}")
    return rating


def writing_prompt(source: str, slug: str, *, tagged_only: bool = False) -> str:
    """Read tagged prompts and the opening request in newer packages."""
    flags = re.IGNORECASE | re.MULTILINE | re.DOTALL
    section = re.match(
        r"\A\s*#[ \t]+(?:Prompt|Request|User request|Original request)[ \t]*\r?\n"
        r"(.*?)(?=^#{1,6}[ \t]|\Z)",
        source, flags,
    )
    request = None
    if section:
        request = section.group(1)
        heading_start = section.end()
    else:
        heading = re.search(r"^#{1,6}[ \t]+([^\r\n]*)", source, re.MULTILINE)
        heading_start = heading.start() if heading else 0
        if heading and heading.group(1).strip().casefold() == "supplied reference images":
            request = source[:heading_start]
    nested = re.match(
        r"#{2,6}[ \t]+My request:?[ \t]*\r?\n(.*?)(?=^#{1,6}[ \t]|\Z)",
        source[heading_start:], flags,
    )
    if nested:
        request = nested.group(1)
    match = re.search(r"^\s*(?:>\s*)?\[?(?:WP|SP)\]\s*(.+)$",
                      source if request is None else request, re.MULTILINE)
    if match:
        prompt = match.group(1).strip()
        for opening, closing in (("“", "”"), ('"', '"')):
            if (prompt.startswith(opening) and prompt.endswith(closing)
                    and opening not in prompt[1:-1] and closing not in prompt[1:-1]):
                return prompt[1:-1]
        return prompt
    if tagged_only:
        return ""
    if request is not None and (prompt := request.strip()):
        return prompt
    raise ValueError(f"Missing writing prompt for {slug}")


def source_prose_path(slug: str, paths: set[str]) -> str:
    for name in ("story.md", "05-story.md"):
        path = f"stories/{slug}/{name}"
        if path in paths:
            return path
    raise ValueError(f"Missing source prose for {slug}")


def new_story(repository: Path, commit: str, slug: str, *, prompt: str = "", path: str | None = None) -> dict:
    path = path or f"stories/{slug}/story.md"
    source = git_text(repository, commit, path)
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)\Z", source, re.DOTALL)
    if not match:
        raise ValueError(f"Missing story frontmatter for {slug}")
    frontmatter, prose = match.groups()
    fields = dict(re.findall(r"^([\w-]+):\s*(.*?)\s*$", frontmatter, re.MULTILINE))
    title = fields["title"].strip('"\'')
    created = fields["created"]
    first_commit = subprocess.check_output(
        ["git", "-C", str(repository), "log", "--format=%aI", "--reverse", commit,
         "--", path], text=True
    ).splitlines()[0]
    body = prose.strip()
    if not body:
        raise ValueError(f"Missing story prose for {slug}")
    if body.splitlines()[0].strip() != f"# {title}":
        body = f"# {title}\n\n{body}"
    return {
        "slug": slug, "title": title, "created": created, "createdAt": first_commit,
        "edited": created, "rating": source_rating(repository, commit, slug),
        "canon": fields.get("canon", "false") == "true", "status": "reviewed",
        "prompt": prompt, "cover": f"covers/{slug}.jpg",
        "body": body,
    }


def refresh_story(repository: Path, commit: str, story: dict, paths: set[str]) -> dict:
    slug = story["slug"]
    prefix = f"stories/{slug}/"
    path = source_prose_path(slug, paths)
    source = git_text(repository, commit, path)
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)\Z", source, re.DOTALL)
    if not match:
        raise ValueError(f"Missing story frontmatter for {slug}")
    frontmatter, prose = match.groups()
    fields = dict(re.findall(r"^([\w-]+):\s*(.*?)\s*$", frontmatter, re.MULTILINE))
    title = fields["title"].strip('"\'')
    body = prose.strip()
    if not body:
        raise ValueError(f"Missing story prose for {slug}")
    # Preserve an authored heading even when it differs from the package title.
    if not body.startswith("# "):
        body = f"# {title}\n\n{body}"
    updated = {**story, "title": title, "body": body}
    if body != story["body"]:
        updated["edited"] = subprocess.check_output(
            ["git", "-C", str(repository), "log", "-1", "--format=%as", commit, "--", path], text=True
        ).strip()
    metadata_path = prefix + "story.json"
    metadata = json.loads(git_text(repository, commit, metadata_path)) if metadata_path in paths else {}
    updated["canon"] = metadata.get("canon", fields.get("canon", "false") == "true")
    if not isinstance(updated["canon"], bool):
        raise ValueError(f"Invalid source canon status for {slug}")
    # Publication membership, prompts and original chronology belong to the
    # site's snapshot; refreshing prose must not withdraw or reorder stories.
    return updated


def sync(repository: Path, revision: str, add_stories: list[str] | None = None,
         *, include_prompt: bool = False, references: list[str] | None = None) -> None:
    with import_lock(ROOT):
        _sync(repository, revision, add_stories or [], include_prompt, references or [])


def _sync(repository: Path, revision: str, add_stories: list[str],
          include_prompt: bool, references: list[str]) -> None:
    commit = subprocess.check_output(
        ["git", "-C", str(repository), "rev-parse", f"{revision}^{{commit}}"],
        text=True,
    ).strip()
    catalog_path = ROOT / "content" / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    stories = catalog["stories"]
    slugs = {story["slug"] for story in stories}
    if len(slugs) != len(stories):
        raise ValueError("Duplicate catalog slug")
    paths = set(subprocess.check_output(
        ["git", "-C", str(repository), "ls-tree", "-rz", "--name-only", commit, "stories"],
        encoding="utf-8"
    ).split("\0"))
    approved: dict[str, list[str]] = {}
    for slug in add_stories:
        if not re.fullmatch(SLUG, slug):
            raise ValueError(f"Invalid --add-story slug: {slug}")
        if slug in approved:
            raise ValueError(f"Duplicate --add-story slug: {slug}")
        approved[slug] = []
    for entry in references:
        slug, slash, filename = entry.partition("/")
        if not slash or slug not in approved or not filename or "/" in filename or "\\" in filename:
            raise ValueError(f"Expected --reference SLUG/FILENAME for a story in this import: {entry}")
        if any(filename.casefold() == name.casefold() for name in approved[slug]):
            raise ValueError(f"Duplicate --reference filename: {entry}")
        if f"stories/{slug}/art/references/{filename}" not in paths:
            raise ValueError(f"Approved reference is missing from the pinned revision: {entry}")
        approved[slug].append(filename)
    for add_story in add_stories:
        if add_story in slugs:
            continue
        prefix = f"stories/{add_story}/"
        prompt_path = next((prefix + name for name in ("prompt.md", "00-prompt.md") if prefix + name in paths),
                           prefix + "prompt.md")
        prompt = ""
        if include_prompt or prompt_path in paths:
            prompt = writing_prompt(git_text(repository, commit, prompt_path), add_story,
                                   tagged_only=not include_prompt)
        stories.insert(0, new_story(repository, commit, add_story, prompt=prompt, path=source_prose_path(add_story, paths)))
    stories[:] = [refresh_story(repository, commit, story, paths) for story in stories]
    for story in stories:
        story["rating"] = source_rating(repository, commit, story["slug"])
    for slug in add_stories:
        ensure_illustrations(ROOT, repository, commit, slug, paths, approved_references=approved[slug])
    covers = {}
    for story in stories:
        slug = story["slug"]
        cover = ROOT / "static" / "story-art" / slug / "title-image.jpg"
        historical = f"stories/{slug}/title-image.jpg"
        if local_file(cover, ROOT / "static"):
            data = cover.read_bytes()
        elif historical in paths:
            data = git_bytes(repository, commit, historical)
        else:
            raise ValueError(f"Missing accepted cover for {slug}")
        covers[story["cover"]] = hashlib.sha256(data).hexdigest()
    source = {"repository": "BoundlessStudio/story-computing-machine", "commit": commit}
    ratings = dict(source, stories=len(stories), counts=dict(sorted(Counter(s["rating"] for s in stories).items())),
                   localOverrides=json.loads((ROOT / "content" / "rating-overrides.json").read_text(encoding="utf-8")))
    documents = {
        "covers.json": json.dumps(covers, sort_keys=True, indent=2) + "\n",
        "source.json": json.dumps(source, indent=2) + "\n",
        "ratings-source.json": json.dumps(ratings, indent=2) + "\n",
        "catalog.json": json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n",
    }
    install_snapshot(ROOT, repository, documents, prepare_art=bool(add_stories))
    print(f"Refreshed {len(stories)} stories and ratings from {commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--add-story", action="append", dest="add_stories", default=[],
                        help="Import or retry a published story. List new stories oldest first.")
    parser.add_argument("--include-prompt", action="store_true",
                        help="Also publish the untagged opening request from prompt.md on new stories")
    parser.add_argument("--reference", action="append", default=[], metavar="SLUG/FILENAME",
                        help="An approved private visual input from the pinned story's art/references; repeat as needed")
    args = parser.parse_args()
    sync(args.repository, args.revision, args.add_stories, include_prompt=args.include_prompt, references=args.reference)
