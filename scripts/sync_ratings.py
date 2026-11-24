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
    """Extract a tagged opening or a recognized request section."""
    flags = re.IGNORECASE | re.MULTILINE | re.DOTALL
    heading = r"^ {0,3}#{1,6}[ \t]+"
    section_body = rf"(.*?)(?={heading}|\Z)"
    section = re.match(
        r"\A\s*#[ \t]+(Prompt|Request|User request|Original request|Prompt contract)[ \t]*\r?\n" + section_body,
        source, flags,
    )
    request = None
    opening = ""
    nested_title = "My request:?"
    if section:
        if section.group(1).casefold() == "prompt contract":
            nested_title = "Verbatim writing prompt"
        else:
            request = section.group(2)
        heading_start = section.end()
    else:
        first_heading = re.search(heading + r"([^\r\n]*)", source, re.MULTILINE)
        heading_start = first_heading.start() if first_heading else len(source)
        opening = source[:heading_start]
        if first_heading and first_heading.group(1).strip().casefold() == "supplied reference images":
            request = opening
    nested = re.match(
        r" {0,3}#{2,6}[ \t]+" + nested_title + r"[ \t]*\r?\n" + section_body,
        source[heading_start:], flags,
    )
    if nested:
        request = nested.group(1)
    first_line = (opening if request is None else request).lstrip().partition("\n")[0].strip()
    first_line = first_line.removeprefix(">").lstrip()
    tag = r"\[?(?:WP|SP)\]"
    if not tagged_only:
        if first_line.startswith("**") and first_line.endswith("**"):
            first_line = first_line[2:-2]
        tag = r"(?:\\?\[)?(?:WP|SP)\\?\]"
    match = re.match(tag + r"[ \t]*(.+)", first_line)
    if match:
        prompt = match.group(1).strip()
        for left_quote, right_quote in (("“", "”"), ('"', '"')):
            if (prompt.startswith(left_quote) and prompt.endswith(right_quote)
                    and left_quote not in prompt[1:-1] and right_quote not in prompt[1:-1]):
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


def retained_editions(stories: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    """Carry forward published editions whose entire source package is absent."""
    content = ROOT / "content"
    static = ROOT / "static"
    source = json.loads((content / "source.json").read_text(encoding="utf-8"))
    previous_covers = json.loads((content / "covers.json").read_text(encoding="utf-8"))
    indexed_assets = None
    commits, covers = {}, {}
    for story in stories:
        slug = story["slug"]
        commit = source.get("retainedStoryCommits", {}).get(slug, source.get("commit"))
        if not isinstance(commit, str) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", commit):
            raise ValueError(f"Missing or invalid previous source commit for {slug}")
        if story["rating"] not in RATINGS:
            raise ValueError(f"Missing or unsupported published rating for {slug}")
        digest = previous_covers.get(story["cover"])
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError(f"Missing or invalid approved cover digest for {slug}")
        cover = static / "story-art" / slug / "title-image.jpg"
        if local_file(cover, static):
            matches = hashlib.sha256(cover.read_bytes()).hexdigest() == digest
        else:
            if indexed_assets is None:
                index = content / "media-index.json"
                indexed_assets = json.loads(index.read_text(encoding="utf-8"))["assets"] if index.is_file() else []
            path = f"stories/{slug}/title-image.jpg"
            matches = [item["sha256"] for item in indexed_assets if item["path"] == path] == [digest]
        if not matches:
            raise ValueError(f"Cannot verify approved cover digest for {slug}")
        commits[slug] = commit
        covers[story["cover"]] = digest
    return commits, covers


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
    retained_commits: dict[str, str] = {}
    covers: dict[str, str] = {}
    if add_stories:
        packages = {path.split("/", 2)[1] for path in paths if path.startswith("stories/")}
        absent = slugs - packages - approved.keys()
        if absent:
            retained_commits, covers = retained_editions([story for story in stories if story["slug"] in absent])
    for add_story in add_stories:
        if add_story in slugs:
            continue
        prose_path = source_prose_path(add_story, paths)
        prefix = f"stories/{add_story}/"
        prompt_path = next((prefix + name for name in ("prompt.md", "00-prompt.md") if prefix + name in paths),
                           prefix + "prompt.md")
        prompt = ""
        if include_prompt or (prose_path.endswith("/05-story.md") and prompt_path in paths):
            prompt = writing_prompt(git_text(repository, commit, prompt_path), add_story,
                                   tagged_only=not include_prompt)
        stories.insert(0, new_story(repository, commit, add_story, prompt=prompt, path=prose_path))
    for position, story in enumerate(stories):
        slug = story["slug"]
        if slug not in retained_commits:
            refreshed = refresh_story(repository, commit, story, paths)
            refreshed["rating"] = source_rating(repository, commit, slug)
            stories[position] = refreshed
    for slug in add_stories:
        ensure_illustrations(ROOT, repository, commit, slug, paths, approved_references=approved[slug])
    for story in stories:
        slug = story["slug"]
        if slug in retained_commits:
            continue
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
    if retained_commits:
        source["retainedStoryCommits"] = dict(sorted(retained_commits.items()))
    ratings = dict(source, stories=len(stories), counts=dict(sorted(Counter(s["rating"] for s in stories).items())),
                   localOverrides=json.loads((ROOT / "content" / "rating-overrides.json").read_text(encoding="utf-8")))
    documents = {
        "covers.json": json.dumps(covers, sort_keys=True, indent=2) + "\n",
        "source.json": json.dumps(source, indent=2) + "\n",
        "ratings-source.json": json.dumps(ratings, indent=2) + "\n",
        "catalog.json": json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n",
    }
    install_snapshot(ROOT, repository, documents, prepare_art=bool(add_stories))
    print(f"Refreshed {len(stories) - len(retained_commits)} stories and ratings from {commit[:12]}")
    for slug, retained_commit in retained_commits.items():
        print(f"Retained published edition of {slug} from {retained_commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--add-story", action="append", dest="add_stories", default=[],
                        help="Import or retry a published story. List new stories oldest first.")
    parser.add_argument("--include-prompt", action="store_true",
                        help="Publish the opening writing request when adding a story to the catalog")
    parser.add_argument("--reference", action="append", default=[], metavar="SLUG/FILENAME",
                        help="An approved private visual input from the pinned story's art/references; repeat as needed")
    args = parser.parse_args()
    sync(args.repository, args.revision, args.add_stories, include_prompt=args.include_prompt, references=args.reference)
