"""Build the public story library from pinned publication snapshots."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path, PurePosixPath
from urllib.parse import quote

import markdown


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
STATIC = ROOT / "static"
DEFAULT_MEDIA_URL = "https://art.rgbknights.com"
DEFAULT_SITE_URL = "https://boundlessstudio.github.io"
TYPES = (
    ("characters", "Characters"),
    ("landscapes", "Landscapes"),
    ("interiors", "Interiors"),
)


def read_json(name: str) -> dict:
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def asset_url(path: str, digest: str, media_url: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError(f"Invalid media hash for {path}")
    name = PurePosixPath(path).name
    if name in {"", ".", ".."} or "/" in name:
        raise ValueError(f"Invalid media name for {path}")
    return f"{media_url.rstrip('/')}/assets/{digest}/{quote(name)}"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def page_url(base: str, relative: str = "") -> str:
    return base + relative


def shell(
    *, title: str, description: str, body: str, active: str, base: str,
    site_url: str, image: str | None = None, page_path: str = "",
) -> str:
    canonical = site_url.rstrip("/") + base + page_path
    nav_links = []
    for label, path in (("Library", ""), ("Artwork", "art/")):
        current = ' aria-current="page"' if active == label else ""
        nav_links.append(f'<a href="{base}{path}"{current}>{label}</a>')
    nav = "".join(nav_links)
    image_meta = (
        f'<meta property="og:image" content="{esc(image)}">' if image else ""
    )
    return f"""<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="description" content="{esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(description)}">
  {image_meta}
  <link rel="canonical" href="{esc(canonical)}">
  <link rel="icon" type="image/svg+xml" href="{base}favicon.svg">
  <link rel="stylesheet" href="{base}styles.css">
  <script>try{{document.documentElement.dataset.theme=localStorage.getItem('scm-theme')||'dark'}}catch(e){{}}</script>
  <script defer src="{base}app.js"></script>
  <title>{esc(title)} · Story Computing Machine</title>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="header-inner">
      <a class="wordmark" href="{base}" aria-label="Story Computing Machine home"><span class="wordmark-symbol">✦</span><span>STORY <em>COMPUTING</em> MACHINE</span></a>
      <nav aria-label="Main navigation">{nav}</nav>
      <button class="theme-button" id="theme-button" type="button" aria-label="Switch color theme">◐ <span>Theme</span></button>
    </div>
  </header>
  <main id="main">{body}</main>
  <footer class="site-footer"><span>Story Computing Machine</span><span>Shared-universe fiction and art</span><a href="https://github.com/BoundlessStudio/story-computing-machine">Story source ↗</a></footer>
</body>
</html>"""


def image_markup(item: dict, *, loading: str = "lazy") -> str:
    return (
        f'<img src="{esc(item["thumbnail"])}" alt="{esc(item["alt"])}" '
        f'loading="{loading}" decoding="async">'
    )


def story_card(story: dict, cover: str, base: str, *, featured: bool = False) -> str:
    description = story["prompt"].strip().replace("\n", " ")
    if len(description) > 185:
        description = description[:182].rsplit(" ", 1)[0] + "…"
    classes = "story-card story-card-featured" if featured else "story-card"
    search = (story["title"] + " " + story["prompt"]).casefold()
    return f"""<article class="{classes}" data-story-card data-title="{esc(story['title'].casefold())}" data-created="{esc(story['createdAt'])}" data-rating="{esc(story['rating'])}" data-search="{esc(search)}">
      <a class="story-cover" href="{base}stories/{esc(story['slug'])}/" aria-label="Read {esc(story['title'])}"><img src="{esc(cover)}" alt="Cover for {esc(story['title'])}" loading="{'eager' if featured else 'lazy'}" decoding="async"></a>
      <div class="story-card-copy"><div class="story-meta"><span>{esc(story['created'])}</span><span class="meta-dot">•</span><span>{esc(story['rating'])}</span></div>
      <h3><a href="{base}stories/{esc(story['slug'])}/">{esc(story['title'])}</a></h3><p>{esc(description)}</p>
      <a class="text-link" href="{base}stories/{esc(story['slug'])}/">Read the story <span aria-hidden="true">↗</span></a></div>
    </article>"""


def build_index(stories: list[dict], covers: dict[str, str], base: str, site_url: str) -> str:
    latest = stories[0]
    rows = []
    current_month = None
    for index, story in enumerate(stories):
        month = story["created"][:7]
        if month != current_month:
            current_month = month
            rows.append(f'<h3 class="index-month" data-index-month>{esc(month)}</h3>')
        excerpt = story["prompt"].strip().replace("\n", " ")
        if len(excerpt) > 210:
            excerpt = excerpt[:207].rsplit(" ", 1)[0] + "…"
        rows.append(
            f'<a class="index-entry" href="{base}stories/{esc(story["slug"])}/" '
            f'data-story-entry data-index="{index}" data-slug="{esc(story["slug"])}" '
            f'data-title="{esc(story["title"])}" data-created="{esc(story["created"])}" '
            f'data-rating="{esc(story["rating"])}" data-search="{esc((story["title"] + " " + story["prompt"]).casefold())}" '
            f'data-cover="{esc(covers[story["cover"]])}" data-excerpt="{esc(excerpt)}">'
            f'<span class="index-number">{index + 1:03d}</span><span class="index-title">{esc(story["title"])}</span>'
            f'<span class="index-rating">{esc(story["rating"])}</span></a>'
        )
    body = f"""<section class="atlas-intro wrap"><div><span class="eyebrow">The Story Computing Machine / Vol. 01</span><h1>Turn the index.<br><em>Find a world.</em></h1></div><div class="atlas-intro-side"><p>Every story has a place in the machine. Turn through the archive, pull a card, and see where it leads.</p><div class="atlas-intro-links"><a href="{base}art/">Explore the artwork <span aria-hidden="true">↗</span></a><span>{len(stories)} stories · One shared universe</span></div></div></section>
    <section class="atlas-layout" id="library" aria-label="Story index"><div class="atlas-rail"><div class="atlas-rail-head"><span class="eyebrow">Index / newest to oldest</span><div class="atlas-controls"><label class="atlas-search"><span class="sr-only">Search stories</span><span aria-hidden="true">⌕</span><input id="story-search" type="search" placeholder="Search titles and prompts" autocomplete="off"></label><label class="select-field">Audience <select id="rating-filter"><option value="all">All ratings</option><option value="PG">PG</option><option value="YA">YA</option><option value="R+">R+</option></select></label></div><div class="atlas-actions"><button id="random-story" class="button button-primary" type="button">✦ Pull a card</button><button id="view-toggle" class="button button-quiet" type="button" aria-pressed="false">Flat view</button></div><p class="results-label" id="story-results" role="status" aria-live="polite">{len(stories)} stories</p></div><div class="atlas-index" id="atlas-index" aria-label="Stories by date">{''.join(rows)}</div><p class="empty-state" id="story-empty" hidden>No stories match those filters.</p></div>
    <div class="atlas-stage" id="atlas-stage"><div class="atlas-stage-top"><span>THE INDEX ENGINE</span><span id="atlas-position">001 / {len(stories):03d}</span></div><div class="atlas-scene" id="atlas-scene" aria-hidden="true"><div class="atlas-no-webgl"><span class="engine-seal" aria-hidden="true">✦</span><p>The story index is ready to explore.</p></div></div><div class="atlas-instructions" id="atlas-instructions">Drag or scroll to turn the index <span aria-hidden="true">↕</span></div><div class="atlas-turn-controls" aria-label="Turn the story index"><button type="button" id="atlas-newer" aria-label="Newer story">↑</button><button type="button" id="atlas-older" aria-label="Older story">↓</button></div><div class="atlas-detail" id="atlas-detail" aria-live="polite"><img id="atlas-cover" src="{esc(covers[latest['cover']])}" alt="Cover for {esc(latest['title'])}" width="96" height="145"><div class="atlas-detail-copy"><span class="atlas-detail-kicker" id="atlas-detail-kicker">CARD 001 · {esc(latest['created'])} · {esc(latest['rating'])}</span><h2 id="atlas-detail-title">{esc(latest['title'])}</h2><p id="atlas-detail-excerpt">{esc(latest['prompt'].strip().replace(chr(10), ' ')[:210])}</p><div class="atlas-detail-links"><a class="button button-primary" id="atlas-read" href="{base}stories/{esc(latest['slug'])}/">Read the story ↗</a><a class="text-link" id="atlas-art" href="{base}art/?story={quote(latest['slug'])}">See its artwork</a></div></div></div><div class="atlas-stage-bottom"><span id="atlas-archive-code">SCM — ARCHIVE / 001</span><a href="{base}art/">Continue to the gallery ↓</a></div></div></section>
    <section class="atlas-after wrap"><span class="eyebrow">Beyond the index</span><h2>Follow the images.</h2><p>The gallery holds character studies, landscapes, interiors, covers, and illustrated scenes from across the collection.</p><a class="button button-quiet" href="{base}art/">Enter the artwork gallery ↗</a></section>"""
    return shell(
        title="Library", description="Explore shared-universe short stories and their artwork.",
        body=body, active="Library", base=base, site_url=site_url,
        image=covers[latest["cover"]],
    )


def prompt_markup(prompt: str) -> str:
    escaped = html.escape(prompt.strip())
    paragraphs = [f"<p>{part.replace(chr(10), '<br>')}</p>" for part in re.split(r"\n\s*\n", escaped)]
    return "".join(paragraphs)


def prose_markup(body: str, title: str) -> str:
    lines = body.lstrip().splitlines()
    if lines and lines[0].startswith("# ") and lines[0][2:].strip() == title:
        lines = lines[1:]
    return markdown.markdown("\n".join(lines), extensions=["extra", "sane_lists"])


def build_story(
    story: dict, all_stories: list[dict], covers: dict[str, str], art: list[dict],
    illustrations: list[dict], comic: dict | None, base: str, site_url: str,
) -> str:
    slug = story["slug"]
    index = all_stories.index(story)
    neighbors = []
    for label, neighbor in (("Previous", all_stories[index - 1] if index else None), ("Next", all_stories[index + 1] if index + 1 < len(all_stories) else None)):
        if neighbor:
            neighbors.append(f'<a href="{base}stories/{esc(neighbor["slug"])}/"><span>{label} story</span><strong>{esc(neighbor["title"])}</strong></a>')
    selected = art[:6]
    art_cards = "".join(
        f'<a class="related-art-card" href="{base}art/?story={quote(slug)}"><img src="{esc(item["thumbnail"])}" alt="{esc(item["alt"])}" loading="lazy"><span>{esc(item["title"])}</span></a>'
        for item in selected
    )
    illustrations_markup = ""
    if illustrations:
        preview = "".join(
            f'<a class="related-art-card" href="{base}art/?story={quote(slug)}&type=Illustrations"><img src="{esc(item["thumbnail"])}" alt="{esc(item["alt"])}" loading="lazy"><span>{esc(item["title"])}</span></a>'
            for item in illustrations[:4]
        )
        illustrations_markup = f'<section class="story-art"><div class="section-heading"><div><span class="eyebrow">Illustrated edition</span><h2>Scenes from this story</h2></div><a class="text-link" href="{base}art/?story={quote(slug)}&type=Illustrations">View all artwork ↗</a></div><div class="related-art-grid">{preview}</div></section>'
    comic_markup = (
        f'<a class="button button-quiet" href="{esc(comic["url"])}" target="_blank" rel="noopener">Download comic PDF ↗</a>'
        if comic else ""
    )
    body = f"""<div class="reader-wrap wrap"><a class="back-link" href="{base}?card={quote(slug)}">← Return to the index</a>
      <div class="reader-head"><div><span class="eyebrow">A story from the shared universe</span><h1>{esc(story['title'])}</h1><div class="story-meta"><span>{esc(story['created'])}</span><span class="meta-dot">•</span><span>{esc(story['rating'])}</span></div></div><img src="{esc(covers[story['cover']])}" alt="Cover for {esc(story['title'])}" class="reader-cover"></div>
      <div class="reader-layout"><div class="reader-main"><aside class="prompt-box"><h2>Writing prompt</h2>{prompt_markup(story['prompt'])}</aside><article class="prose">{prose_markup(story['body'], story['title'])}</article><div class="reader-end"><span class="end-mark" aria-hidden="true">✦</span><p>End of story</p>{comic_markup}</div><nav class="reader-neighbors" aria-label="More stories">{''.join(neighbors)}</nav></div>
      <aside class="reader-side"><span class="eyebrow">In this story</span><p>Explore visual references for the people and places in {esc(story['title'])}.</p><a class="text-link" href="{base}art/?story={quote(slug)}">View its artwork ↗</a></aside></div>
      {f'<section class="story-art"><div class="section-heading"><div><span class="eyebrow">Image gallery</span><h2>People and places</h2></div><a class="text-link" href="{base}art/?story={quote(slug)}">View all artwork ↗</a></div><div class="related-art-grid">{art_cards}</div></section>' if art_cards else ''}
      {illustrations_markup}
    </div>"""
    return shell(
        title=story["title"], description=story["prompt"].strip().replace("\n", " ")[:200],
        body=body, active="", base=base, site_url=site_url,
        image=covers[story["cover"]], page_path=f"stories/{slug}/",
    )


def build_art_page(art_count: int, story_count: int, base: str, site_url: str) -> str:
    body = f"""<section class="art-hero wrap"><a class="back-link" href="{base}">← Library</a><span class="eyebrow">The image gallery</span><h1>A world seen through art.</h1><p>Character studies, landscapes, interiors, covers, and illustrated scenes from across the story library.</p><div class="art-stat"><strong>{art_count:,}</strong> artworks <span aria-hidden="true">·</span> <strong>{story_count}</strong> stories</div></section>
      <section class="art-section wrap" data-art-json="{base}art.json"><div class="art-controls"><label class="search-field"><span class="sr-only">Search artwork</span><span aria-hidden="true">⌕</span><input id="art-search" type="search" placeholder="Search art or story titles" autocomplete="off"></label><label class="select-field">Collection <select id="art-type"><option value="all">All artwork</option><option value="Characters">Characters</option><option value="Landscapes">Landscapes</option><option value="Interiors">Interiors</option><option value="Covers">Covers</option><option value="Illustrations">Illustrations</option></select></label><label class="select-field">Story <select id="art-story"><option value="all">All stories</option></select></label></div><p class="results-label" id="art-results" role="status" aria-live="polite">Loading artwork…</p><div class="art-grid" id="art-grid"></div><p class="empty-state" id="art-empty" hidden>No artwork matches those filters.</p><button class="button button-quiet load-more" id="art-more" type="button" hidden>Load more artwork</button></section>
      <dialog class="art-dialog" id="art-dialog" aria-label="Artwork viewer"><button type="button" class="dialog-close" id="dialog-close" aria-label="Close artwork">×</button><div class="dialog-image-wrap"><img id="dialog-image" alt=""></div><div class="dialog-copy"><span class="eyebrow" id="dialog-type"></span><h2 id="dialog-title"></h2><p id="dialog-story"></p><a id="dialog-reader" class="text-link" href="#">Read the story ↗</a></div></dialog>"""
    return shell(
        title="Artwork", description="Browse character studies, landscapes, interiors, covers, and illustrated scenes from the story library.",
        body=body, active="Artwork", base=base, site_url=site_url, page_path="art/",
    )


def build(output: Path, base: str, site_url: str, media_url: str) -> None:
    if not base.startswith("/") or not base.endswith("/") or "//" in base:
        raise ValueError("Base path must start and end with / and contain no //")
    resolved_output = output.resolve()
    protected = (CONTENT, STATIC, ROOT / "scripts", ROOT / "tests", ROOT / ".git")
    if resolved_output == ROOT or resolved_output in ROOT.parents or any(
        resolved_output == path or path in resolved_output.parents for path in protected
    ):
        raise ValueError(f"Output overlaps website source: {resolved_output}")
    catalog = read_json("catalog.json")
    stories = catalog["stories"]
    if not stories:
        raise ValueError("The catalog has no stories")
    cover_hashes = read_json("covers.json")
    covers = {
        story["cover"]: asset_url(story["cover"], cover_hashes[story["cover"]], media_url)
        for story in stories
    }
    story_by_slug = {story["slug"]: story for story in stories}
    art: list[dict] = []
    art_by_story: dict[str, list[dict]] = defaultdict(list)
    for key, label in TYPES:
        for group in read_json(f"{key}.json")["stories"]:
            for item in group["images"]:
                entry = {
                    "id": f"{key}-{group['slug']}-{item['id']}",
                    "title": item["title"], "alt": item["alt"],
                    "story": group["title"], "slug": group["slug"], "type": label,
                    "full": asset_url(item["full"]["path"], item["full"]["sha256"], media_url),
                    "thumbnail": asset_url(item["thumbnail"]["path"], item["thumbnail"]["sha256"], media_url),
                    "reader": page_url(base, f"stories/{group['slug']}/"),
                }
                art.append(entry)
                art_by_story[group["slug"]].append(entry)
    for story in stories:
        entry = {
            "id": f"cover-{story['slug']}", "title": f"{story['title']} cover",
            "alt": f"Cover for {story['title']}", "story": story["title"],
            "slug": story["slug"], "type": "Covers", "full": covers[story["cover"]],
            "thumbnail": covers[story["cover"]],
            "reader": page_url(base, f"stories/{story['slug']}/"),
        }
        art.append(entry)
    illustrations_by_story: dict[str, list[dict]] = defaultdict(list)
    for edition in read_json("illustrated.json")["editions"]:
        slug = edition["source"]["slug"]
        if slug not in story_by_slug:
            raise ValueError(f"Illustrated edition references unpublished story: {slug}")
        for scene in edition["illustrations"]:
            title = scene["id"].replace("-", " ").lstrip("0123456789 ").title()
            entry = {
                "id": f"illustration-{slug}-{scene['id']}", "title": title,
                "alt": scene["alt"], "story": edition["title"], "slug": slug,
                "type": "Illustrations", "full": asset_url(scene["path"], scene["sha256"], media_url),
                "thumbnail": asset_url(scene["path"], scene["sha256"], media_url),
                "reader": page_url(base, f"stories/{slug}/"),
            }
            art.append(entry)
            illustrations_by_story[slug].append(entry)
    comics = {}
    for edition in read_json("graphic-novels.json")["editions"]:
        slug = edition["source"]["slug"]
        comics[slug] = {
            "url": asset_url(edition["pdf"]["path"], edition["pdf"]["sha256"], media_url),
            "pages": edition["pdf"]["pages"],
        }

    if output.exists():
        shutil.rmtree(output)
    (output / "art").mkdir(parents=True)
    (output / "stories").mkdir()
    shutil.copy2(STATIC / "styles.css", output / "styles.css")
    shutil.copy2(STATIC / "app.js", output / "app.js")
    shutil.copy2(STATIC / "engine.js", output / "engine.js")
    shutil.copy2(STATIC / "favicon.svg", output / "favicon.svg")
    (output / "index.html").write_text(build_index(stories, covers, base, site_url), encoding="utf-8")
    (output / "art" / "index.html").write_text(build_art_page(len(art), len(stories), base, site_url), encoding="utf-8")
    (output / "art.json").write_text(json.dumps(art, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for story in stories:
        destination = output / "stories" / story["slug"]
        destination.mkdir()
        (destination / "index.html").write_text(
            build_story(story, stories, covers, art_by_story[story["slug"]], illustrations_by_story[story["slug"]], comics.get(story["slug"]), base, site_url),
            encoding="utf-8",
        )
        # Preserve the former Pages reader URLs when a custom domain points here.
        reader_path = base + "stories/" + story["slug"] + "/"
        (output / "stories" / f"{story['slug']}.html").write_text(
            f'<!doctype html><html lang="en"><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0;url={esc(reader_path)}">'
            f'<link rel="canonical" href="{esc(site_url.rstrip("/") + reader_path)}">'
            f'<title>Redirecting to {esc(story["title"])}…</title>'
            f'<p><a href="{esc(reader_path)}">Read {esc(story["title"])}</a></p></html>',
            encoding="utf-8",
        )
    for old_path, category in (
        ("characters.html", "Characters"),
        ("landscapes.html", "Landscapes"),
        ("interiors.html", "Interiors"),
    ):
        destination = f"{base}art/?type={category}"
        (output / old_path).write_text(
            f'<!doctype html><html lang="en"><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0;url={esc(destination)}">'
            f'<p><a href="{esc(destination)}">Browse {esc(category.lower())}</a></p></html>',
            encoding="utf-8",
        )
    sitemap = "".join(
        f"<url><loc>{esc(site_url.rstrip('/') + base + path)}</loc></url>"
        for path in ["", "art/"] + [f"stories/{s['slug']}/" for s in stories]
    )
    (output / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sitemap}</urlset>', encoding="utf-8")
    (output / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {site_url.rstrip('/') + base}sitemap.xml\n", encoding="utf-8")
    (output / ".nojekyll").touch()
    print(f"Built {len(stories)} story pages and {len(art)} artwork entries in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    parser.add_argument("--base-path", default="/")
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    parser.add_argument("--media-url", default=DEFAULT_MEDIA_URL)
    args = parser.parse_args()
    build(args.output, args.base_path, args.site_url, args.media_url)
