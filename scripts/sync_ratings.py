"""Refresh published prose, canon metadata, ratings and covers from a pinned source commit."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path


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


def writing_prompt(source: str, slug: str) -> str:
    """Read legacy [WP] prompts and the opening request in newer packages."""
    section = re.match(
        r"\A\s*#[ \t]+(?:Prompt|Request|User request|Original request)[ \t]*\r?\n"
        r"(.*?)(?=^#{1,6}[ \t]|\Z)",
        source, re.IGNORECASE | re.MULTILINE | re.DOTALL,
    )
    request = section.group(1) if section else source
    match = re.search(r"^\s*(?:>\s*)?\[WP\]\s*(.+)$", request, re.MULTILINE)
    if match:
        return match.group(1).strip().strip('“”"')
    if section and (prompt := section.group(1).strip()):
        return prompt
    raise ValueError(f"Missing writing prompt for {slug}")


def new_story(repository: Path, commit: str, slug: str) -> dict:
    source = git_text(repository, commit, f"stories/{slug}/story.md")
    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n(.*)\Z", source, re.DOTALL)
    if not match:
        raise ValueError(f"Missing story frontmatter for {slug}")
    frontmatter, prose = match.groups()
    fields = dict(re.findall(r"^([\w-]+):\s*(.*?)\s*$", frontmatter, re.MULTILINE))
    title = fields["title"].strip('"\'')
    created = fields["created"]
    prompt_source = git_text(repository, commit, f"stories/{slug}/prompt.md")
    prompt = writing_prompt(prompt_source, slug)
    first_commit = subprocess.check_output(
        ["git", "-C", str(repository), "log", "--format=%aI", "--reverse", commit,
         "--", f"stories/{slug}/story.md"], text=True
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
    path = next((prefix + name for name in ("story.md", "05-story.md") if prefix + name in paths), None)
    if path is None:
        raise ValueError(f"Missing source prose for {slug}")
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


def sync(repository: Path, revision: str, add_stories: list[str] | None = None) -> None:
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
    for add_story in add_stories or []:
        if add_story in slugs or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", add_story):
            raise ValueError("Invalid or duplicate new story slug")
        stories.insert(0, new_story(repository, commit, add_story))
        slugs.add(add_story)
    paths = set(subprocess.check_output(
        ["git", "-C", str(repository), "ls-tree", "-r", "--name-only", commit, "stories"], text=True
    ).splitlines())
    stories[:] = [refresh_story(repository, commit, story, paths) for story in stories]
    for story in stories:
        story["rating"] = source_rating(repository, commit, story["slug"])
    covers = {
        story["cover"]: hashlib.sha256(git_bytes(
            repository, commit, f"stories/{story['slug']}/title-image.jpg"
        )).hexdigest()
        for story in stories
    }
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (ROOT / "content" / "covers.json").write_text(
        json.dumps(covers, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "content" / "source.json").write_text(
        json.dumps({"repository": "BoundlessStudio/story-computing-machine", "commit": commit},
                   indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "content" / "ratings-source.json").write_text(
        json.dumps({"repository": "BoundlessStudio/story-computing-machine", "commit": commit,
                    "stories": len(stories), "counts": dict(sorted(Counter(s["rating"] for s in stories).items())),
                    "localOverrides": json.loads((ROOT / "content" / "rating-overrides.json").read_text(encoding="utf-8"))},
                   indent=2) + "\n", encoding="utf-8"
    )
    print(f"Refreshed {len(stories)} stories and ratings from {commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--add-story", action="append", dest="add_stories", default=[],
                        help="Import a newly published story; repeat for multiple stories, oldest first")
    args = parser.parse_args()
    sync(args.repository, args.revision, args.add_stories)
