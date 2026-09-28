"""Import approved story ratings and optionally a new story from a pinned source commit."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RATINGS = {"General", "Teen", "Mature", "Explicit"}


def git_text(repository: Path, commit: str, path: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repository), "show", f"{commit}:{path}"]
    ).decode("utf-8")


def source_rating(repository: Path, commit: str, slug: str) -> str:
    source = git_text(repository, commit, f"stories/{slug}/ratings.md")
    match = re.search(r"^- \*\*Rating:\*\* (.+)$", source, re.MULTILINE)
    if not match or match.group(1) not in RATINGS:
        raise ValueError(f"Missing or unsupported rating for {slug}")
    return match.group(1)


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
    prompt_match = re.search(r"^\s*(?:>\s*)?\[WP\]\s*(.+)$", prompt_source, re.MULTILINE)
    if not prompt_match:
        raise ValueError(f"Missing writing prompt for {slug}")
    prompt = prompt_match.group(1).strip().strip('“”"')
    first_commit = subprocess.check_output(
        ["git", "-C", str(repository), "log", "--format=%aI", "--reverse", commit,
         "--", f"stories/{slug}/story.md"], text=True
    ).splitlines()[0]
    return {
        "slug": slug, "title": title, "created": created, "createdAt": first_commit,
        "edited": created, "rating": source_rating(repository, commit, slug),
        "canon": fields.get("canon", "false") == "true", "status": "reviewed",
        "prompt": prompt, "cover": f"covers/{slug}.jpg",
        "body": f"# {title}\n\n{prose.strip()}",
    }


def sync(repository: Path, revision: str, add_story: str | None = None) -> None:
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
    if add_story:
        if add_story in slugs or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", add_story):
            raise ValueError("Invalid or duplicate new story slug")
        stories.insert(0, new_story(repository, commit, add_story))
    for story in stories:
        story["rating"] = source_rating(repository, commit, story["slug"])
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (ROOT / "content" / "ratings-source.json").write_text(
        json.dumps({"repository": "BoundlessStudio/story-computing-machine", "commit": commit,
                    "stories": len(stories), "counts": dict(sorted(Counter(s["rating"] for s in stories).items()))},
                   indent=2) + "\n", encoding="utf-8"
    )
    print(f"Updated {len(stories)} ratings from {commit[:12]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", default="origin/main")
    parser.add_argument("--add-story", help="Import a newly published story from the source commit")
    args = parser.parse_args()
    sync(args.repository, args.revision, args.add_story)
