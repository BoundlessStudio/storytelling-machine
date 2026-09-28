"""Build the story library and gallery from prose snapshots and the R2 art index."""

from __future__ import annotations

import argparse
from collections import defaultdict
from hashlib import sha256
import html
import json
from pathlib import Path, PurePosixPath
import re
import shutil
from urllib.error import URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

import markdown


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "content"
STATIC = ROOT / "static"
CSS_VERSION = sha256((STATIC / "styles.css").read_bytes()).hexdigest()[:12]
ICON_VERSION = sha256((STATIC / "favicon.svg").read_bytes()).hexdigest()[:12]
JS_VERSION = sha256((STATIC / "app.js").read_bytes()).hexdigest()[:12]
COVER_JS_VERSION = sha256((STATIC / "book-scroll.js").read_bytes()).hexdigest()[:12]
BACK_COVER_VERSION = sha256((STATIC / "book-back-cover-9x16.png").read_bytes()).hexdigest()[:12]
SOURCE_REPO = "https://github.com/BoundlessStudio/story-computing-machine"
DEFAULT_SITE_URL = "https://stories.rgbknights.com"
DEFAULT_INDEX_URL = "https://art.rgbknights.com/manifests/story-computing-machine-art-v1.json"
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
COLLECTIONS = {"characters": "Characters", "landscapes": "Landscapes", "interiors": "Interiors"}
ART_TYPES = ("Covers", "Characters", "Landscapes & interiors", "Illustrations", "Comics")


def read_json(name: str) -> dict:
    return json.loads((CONTENT / name).read_text(encoding="utf-8"))


def asset_url(path: str, digest: str, media_url: str) -> str:
    """Build URLs for matching optimized thumbnails from the former gallery."""
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError(f"Invalid media hash for {path}")
    name = PurePosixPath(path).name
    if name in {"", ".", ".."} or "/" in name:
        raise ValueError(f"Invalid media name for {path}")
    return f"{media_url.rstrip('/')}/assets/{digest}/{quote(name)}"


def validate_media_index(index: dict) -> dict[str, dict]:
    if (not isinstance(index, dict) or index.get("schemaVersion") != 1
            or not re.fullmatch(r"[a-f0-9]{40}", str(index.get("sourceCommit", "")))
            or not isinstance(index.get("assets"), list) or not index["assets"]):
        raise ValueError("Invalid R2 media index")
    origin = index.get("baseUrl")
    if not isinstance(origin, str):
        raise ValueError("Invalid R2 media origin")
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise ValueError("Invalid R2 media origin")
    origin = origin.rstrip("/")
    if index.get("indexUrl") != origin + "/manifests/story-computing-machine-art-v1.json":
        raise ValueError("Invalid R2 index URL")
    assets = {}
    for item in index["assets"]:
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "size", "key", "contentType", "url"}:
            raise ValueError("Invalid R2 media entry")
        path, digest = item["path"], item["sha256"]
        if (not isinstance(path, str) or not path or "\\" in path or ":" in path
                or any(part in {"", ".", ".."} for part in path.split("/"))
                or path in assets or not isinstance(digest, str)
                or not re.fullmatch(r"[a-f0-9]{64}", digest)
                or type(item["size"]) is not int or item["size"] <= 0):
            raise ValueError(f"Invalid or duplicate R2 source path: {path}")
        key = f"assets/{digest}/{PurePosixPath(path).name}"
        if (item["key"] != key or item["url"] != origin + "/" + quote(key, safe="/")
                or item["contentType"] not in IMAGE_TYPES | {"application/pdf"}):
            raise ValueError(f"Invalid R2 URL or content type: {path}")
        assets[path] = item
    return assets


def load_media_index(url: str = DEFAULT_INDEX_URL, *, offline: bool = False) -> tuple[dict, str]:
    if not offline:
        try:
            request = Request(url, headers={"User-Agent": "StorytellingMachine-SiteBuilder/1.0"})
            with urlopen(request, timeout=20) as response:
                index = json.load(response)
            validate_media_index(index)
            print(f"Using public R2 index: {url}")
            return index, "public"
        except (URLError, OSError) as error:
            print(f"Public R2 index unavailable ({error}); using the checked-in snapshot")
    index = read_json("media-index.json")
    validate_media_index(index)
    return index, "snapshot"


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def shell(title: str, description: str, body: str, active: str, base: str,
          site_url: str, page_path: str = "", image: str | None = None,
          immersive: bool = False) -> str:
    canonical = site_url.rstrip("/") + base + page_path
    page_title = f"{title} · Story Computing Machine"
    preview_image = image or site_url.rstrip("/") + base + "social-card.jpg"
    preview_alt = (f"Cover art for {title}" if image else
                   "An open book unfolding into worlds from the Story Computing Machine")
    page_type = "article" if page_path.startswith("stories/") else "website"
    nav = "".join(
        f'<a href="{base}{path}"{current}>{label}</a>'
        for label, path, current in (
            (label, path, ' aria-current="page"' if active == label else "")
            for label, path in (("Library", "library/"), ("Gallery", "art/"))
        )
    )
    header_class = 'site-header immersive-header' if immersive else 'site-header'
    header = (f'<header class="{header_class}"><a class="site-mark" href="{base}" '
              f'aria-label="Story Computing Machine home"><img class="brand-icon" '
              f'src="{base}favicon.svg?v={ICON_VERSION}" alt="">'
              '<span class="site-mark-long">Story Computing Machine</span>'
              '<span class="site-mark-short">Story Machine</span></a>'
              f'<nav aria-label="Main navigation">{nav}</nav></header>')
    if immersive:
        footer = ""
        body_class = ' class="immersive-body"'
    else:
        footer = f'<footer class="site-footer"><div class="wrap"><span>Story Computing Machine</span><a href="{SOURCE_REPO}">Story source ↗</a></div></footer>'
        body_class = ""
    return f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{esc(description)}">
<meta property="og:type" content="{page_type}"><meta property="og:site_name" content="Story Computing Machine">
<meta property="og:url" content="{esc(canonical)}"><meta property="og:title" content="{esc(page_title)}">
<meta property="og:description" content="{esc(description)}"><meta property="og:image" content="{esc(preview_image)}">
<meta property="og:image:alt" content="{esc(preview_alt)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{esc(page_title)}">
<meta name="twitter:description" content="{esc(description)}"><meta name="twitter:image" content="{esc(preview_image)}">
<meta name="twitter:image:alt" content="{esc(preview_alt)}">
<link rel="canonical" href="{esc(canonical)}"><link rel="icon" type="image/svg+xml" href="{base}favicon.svg?v={ICON_VERSION}">
<link rel="icon" type="image/png" sizes="32x32" href="{base}favicon-32.png?v={ICON_VERSION}">
<link rel="apple-touch-icon" sizes="180x180" href="{base}apple-touch-icon.png?v={ICON_VERSION}">
<link rel="stylesheet" href="{base}styles.css?v={CSS_VERSION}"><script defer src="{base}app.js?v={JS_VERSION}"></script>
<title>{esc(page_title)}</title></head><body{body_class}>
<a class="skip-link" href="#main">Skip to content</a>
{header}
<main id="main">{body}</main>
{footer}
</body></html>"""


def friendly_name(path: str) -> str:
    stem = PurePosixPath(path).stem
    return re.sub(r"^\d+[\s_-]*", "", stem).replace("-", " ").replace("_", " ").strip().title()


def old_art_metadata(media_origin: str) -> dict[tuple[str, str, str], dict]:
    """Use small WebP thumbnails only where the source image hash still matches."""
    result = {}
    for key, label in COLLECTIONS.items():
        for group in read_json(f"{key}.json")["stories"]:
            for item in group["images"]:
                result[(group["slug"], label, item["sourceSha256"])] = {
                    "title": item["title"], "alt": item["alt"],
                    "thumbnail": asset_url(item["thumbnail"]["path"], item["thumbnail"]["sha256"], media_origin),
                }
    return result


def make_art(index: dict, stories: list[dict], base: str) -> tuple[list[dict], dict[str, str], dict[str, str]]:
    assets = validate_media_index(index)
    story_by_slug = {story["slug"]: story for story in stories}
    order = {story["slug"]: position for position, story in enumerate(stories)}
    edition_sources = {
        edition["slug"]: edition["source"]["slug"]
        for collection in ("illustrated.json", "graphic-novels.json")
        for edition in read_json(collection)["editions"]
    }
    scene_meta = {scene["path"]: scene for edition in read_json("illustrated.json")["editions"] for scene in edition["illustrations"]}
    old_meta = old_art_metadata(index["baseUrl"])
    gallery, covers, comics = [], {}, {}
    alternate_thumbnails = {
        str(PurePosixPath(path).with_suffix(".png")): item["url"]
        for path, item in assets.items()
        if path.endswith(".webp") and "/art/characters/" in path
        and str(PurePosixPath(path).with_suffix(".png")) in assets
    }
    for path, item in assets.items():
        if path.endswith(".webp") and str(PurePosixPath(path).with_suffix(".png")) in alternate_thumbnails:
            continue
        parts = path.split("/")
        slug = kind = source_kind = None
        if len(parts) == 3 and parts[0] == "stories" and parts[2] == "title-image.jpg":
            slug, kind, source_kind = parts[1], "Covers", "Covers"
            covers[slug] = item["url"]
        elif len(parts) in {5, 6} and parts[0] == "stories" and parts[2] == "art":
            slug, source_kind = parts[1], COLLECTIONS.get(parts[3])
            kind = "Landscapes & interiors" if source_kind in {"Landscapes", "Interiors"} else source_kind
            if len(parts) == 6 and parts[4] != "selected":
                kind = None
        elif len(parts) == 3 and parts[0] == "illustrated" and parts[2] == "cover.jpg":
            slug, kind, source_kind = edition_sources.get(parts[1], parts[1]), "Covers", "Edition covers"
        elif len(parts) == 4 and parts[0] == "illustrated" and parts[2] == "illustrations":
            slug, kind, source_kind = edition_sources.get(parts[1], parts[1]), "Illustrations", "Illustrations"
        elif len(parts) == 3 and parts[0] == "graphic-novels" and parts[2] == "cover.png":
            slug, kind, source_kind = edition_sources.get(parts[1], parts[1]), "Comics", "Comic covers"
        elif len(parts) == 4 and parts[0] == "graphic-novels" and parts[2] == "pages":
            slug, kind, source_kind = edition_sources.get(parts[1], parts[1]), "Comics", "Comic pages"
        elif len(parts) == 3 and parts[0] == "graphic-novels" and parts[2] == "edition.pdf":
            comics[edition_sources.get(parts[1], parts[1])] = item["url"]
        if not kind or item["contentType"] not in IMAGE_TYPES:
            continue
        story_title = story_by_slug[slug]["title"] if slug in story_by_slug else friendly_name(slug)
        title = (f"{story_title} cover" if source_kind == "Covers" else
                 f"{story_title} illustrated cover" if source_kind == "Edition covers" else
                 f"{story_title} comic cover" if source_kind == "Comic covers" else friendly_name(path))
        previous = old_meta.get((slug, source_kind, item["sha256"]))
        if previous:
            title = previous["title"]
        scene = scene_meta.get(path)
        alt = (scene["alt"] if scene and scene["sha256"] == item["sha256"] else
               previous["alt"] if previous else f"{title} — artwork for {story_title}")
        reader = (base + "stories/" + quote(slug) + "/" if slug in story_by_slug else
                  SOURCE_REPO + "/tree/main/stories/" + quote(slug))
        gallery.append({"id": path, "title": title, "alt": alt, "story": story_title,
                        "slug": slug, "type": kind, "full": item["url"],
                        "thumbnail": previous["thumbnail"] if previous else alternate_thumbnails.get(path, item["url"]),
                        "reader": reader})
    missing = [story["slug"] for story in stories if story["slug"] not in covers]
    if missing:
        raise ValueError("Published stories lack R2 covers: " + ", ".join(missing))
    gallery.sort(key=lambda art: (order.get(art["slug"], len(order)), ART_TYPES.index(art["type"]), art["title"]))
    return gallery, covers, comics


def story_card(story: dict, cover: str, base: str) -> str:
    excerpt = " ".join(story["prompt"].split())
    if len(excerpt) > 160:
        excerpt = excerpt[:157].rsplit(" ", 1)[0] + "…"
    search = (story["title"] + " " + story["prompt"]).casefold()
    url = base + "stories/" + quote(story["slug"]) + "/"
    return f"""<article class="story-card" data-story-card data-search="{esc(search)}" data-rating="{esc(story['rating'])}">
<a class="story-cover" href="{url}"><img src="{esc(cover)}" alt="Cover for {esc(story['title'])}" loading="lazy" decoding="async"></a>
<div class="card-copy"><p class="eyebrow">{esc(story['created'])} · {esc(story['rating'])}</p><h2><a href="{url}">{esc(story['title'])}</a></h2><p>{esc(excerpt)}</p></div></article>"""


def build_index(stories: list[dict], covers: dict[str, str], base: str, site_url: str) -> str:
    cards = "".join(story_card(story, covers[story["slug"]], base) for story in stories)
    body = f"""<section class="page-intro wrap"><p class="eyebrow">Shared-universe fiction</p><h1>Story library</h1><p>Browse the collection, find a story, and stay a while.</p><div class="intro-links"><span>{len(stories)} stories</span><a href="{base}art/">Explore the gallery ↗</a></div></section>
<section class="wrap listing" aria-label="Stories"><div class="controls"><label class="search-field">Search stories<input id="story-search" type="search" placeholder="Title or writing prompt" autocomplete="off"></label><label>Audience<select id="rating-filter"><option value="all">All ratings</option><option value="General">General</option><option value="Teen">Teen</option><option value="Mature">Mature</option><option value="Explicit">Explicit</option></select></label></div><p class="results" id="story-results" role="status" aria-live="polite">{len(stories)} stories</p><div class="story-grid" id="story-grid">{cards}</div><p class="empty" id="story-empty" hidden>No stories match those filters.</p></section>"""
    return shell("Library", "Explore original fiction and artwork across a shared universe of magic, mystery, and imagined worlds.", body,
                 "Library", base, site_url, "library/")


def build_scroll_home(base: str, site_url: str, stories: list[dict], covers: dict[str, str]) -> str:
    front = f'<img class="book-cover-art" src="{base}book-cover-9x16.png" alt="" fetchpriority="high">'
    back = f'<img class="book-cover-art" src="{base}book-back-cover-9x16.png?v={BACK_COVER_VERSION}" alt="">'
    body = f"""<section class="scroll-home" data-cover-feed="{base}cover-feed.json" aria-label="Story cover book">
<div class="scroll-viewport"><div class="scroll-ambient" aria-hidden="true"><img id="scroll-ambient-image" alt=""></div>
<div class="scroll-scene" id="scroll-scene" role="group" aria-label="Story cover book">
<div class="scroll-book" id="scroll-book" aria-hidden="true"><div class="scroll-page scroll-left" id="scroll-left"></div><div class="scroll-page scroll-right" id="scroll-right"></div><div class="scroll-leaf scroll-opening" id="scroll-opening"><div class="scroll-face scroll-front">{front}</div><div class="scroll-face scroll-back" id="scroll-opening-back"></div></div><div class="scroll-leaf scroll-turn" id="scroll-turn" hidden><div class="scroll-face scroll-front" id="scroll-turn-front"></div></div><div class="scroll-leaf scroll-ending" id="scroll-ending" hidden><div class="scroll-face scroll-front" id="scroll-ending-front"></div><div class="scroll-face scroll-back">{back}</div></div></div>
</div>
<div class="scroll-intro" id="scroll-intro"><p class="scroll-intro-kicker">Story Computing Machine</p><h1>A world in every page.</h1></div>
<section class="scroll-end" id="about" aria-labelledby="about-heading" hidden><p class="scroll-end-kicker">About the project</p><h2 id="about-heading">Stories begin with a prompt.<br><em>Then they become part of a shared story world.</em></h2><p class="scroll-end-lede">Story Computing Machine is a growing collection of original fiction and artwork. Each writing prompt becomes a story woven into a shared world.</p><p class="scroll-end-meta"><strong>{len(stories)}</strong> stories</p><div class="scroll-end-links"><a href="{base}library/">Enter the library ↗</a><a href="{base}art/">Explore the artwork ↗</a></div><p class="scroll-end-source">Curious how it is made? <a href="{SOURCE_REPO}">Explore the story source ↗</a></p></section>
<div class="scroll-bottom" id="scroll-details" hidden><div class="scroll-actions"><a id="scroll-read" href="{base}library/" hidden>Read the story <span aria-hidden="true">↗</span></a></div></div>
</div></section>
<script defer src="{base}book-scroll.js?v={COVER_JS_VERSION}"></script>"""
    return shell("Discover", "Open a book of original story covers and explore the Story Computing Machine project.", body,
                 "Discover", base, site_url, immersive=True)


def prompt_markup(prompt: str) -> str:
    escaped = html.escape(prompt.strip())
    return "".join(f"<p>{part.replace(chr(10), '<br>')}</p>" for part in re.split(r"\n\s*\n", escaped))


def prose_markup(body: str, title: str) -> str:
    lines = body.lstrip().splitlines()
    if lines and lines[0].startswith("# ") and lines[0][2:].strip() == title:
        lines = lines[1:]
    return markdown.markdown("\n".join(lines), extensions=["extra", "sane_lists"])


def build_story(story: dict, stories: list[dict], covers: dict[str, str], art: list[dict],
                comic: str | None, base: str, site_url: str) -> str:
    slug = story["slug"]
    position = stories.index(story)
    neighbors = []
    for label, neighbor in (("Previous", stories[position - 1] if position else None),
                            ("Next", stories[position + 1] if position + 1 < len(stories) else None)):
        if neighbor:
            neighbors.append(f'<a href="{base}stories/{quote(neighbor["slug"])}/"><span>{label} story</span><strong>{esc(neighbor["title"])}</strong></a>')
    art_link = f'<a href="{base}art/?story={quote(slug)}">View {len(art)} artwork items ↗</a>' if art else ""
    comic_link = f'<a href="{esc(comic)}" target="_blank" rel="noopener">Download comic PDF ↗</a>' if comic else ""
    body = f"""<div class="reader wrap"><p><a class="back-link" href="{base}library/">← Library</a></p><header class="reader-header"><div><p class="eyebrow">{esc(story['created'])} · {esc(story['rating'])}</p><h1>{esc(story['title'])}</h1><div class="reader-links">{art_link}{comic_link}</div></div><img src="{esc(covers[slug])}" alt="Cover for {esc(story['title'])}"></header><div class="reader-content"><aside class="prompt"><h2>Writing prompt</h2>{prompt_markup(story['prompt'])}</aside><article class="prose">{prose_markup(story['body'], story['title'])}</article></div><nav class="reader-neighbors" aria-label="More stories">{''.join(neighbors)}</nav></div>"""
    return shell(story["title"], " ".join(story["prompt"].split())[:200], body,
                 "Library", base, site_url, f"stories/{slug}/", covers[slug])


def build_art_page(count: int, base: str, site_url: str) -> str:
    options = "".join(f'<option value="{esc(kind)}">{esc(kind)}</option>' for kind in ART_TYPES)
    body = f"""<section class="page-intro wrap"><p class="eyebrow">From the story collection</p><h1>Artwork gallery</h1><p>Covers, character studies, places, illustrations, and comics.</p><div class="intro-links"><span>{count:,} images</span><a href="{base}library/">Browse the library ↗</a></div></section>
<section class="wrap listing" data-art-json="{base}art.json"><div class="controls"><label class="search-field">Search artwork<input id="art-search" type="search" placeholder="Artwork or story title" autocomplete="off"></label><label>Collection<select id="art-type"><option value="all">All artwork</option>{options}</select></label><label>Story<select id="art-story"><option value="all">All stories</option></select></label></div><p class="results" id="art-results" role="status" aria-live="polite">Loading artwork…</p><div class="art-grid" id="art-grid"></div><p class="empty" id="art-empty" hidden>No artwork matches those filters.</p><div class="art-sentinel" id="art-sentinel" aria-hidden="true" hidden></div><button class="button" id="art-more" type="button" hidden>Load more images</button></section>
<dialog class="art-dialog" id="art-dialog" aria-label="Artwork viewer"><button class="dialog-close" id="dialog-close" type="button" aria-label="Close artwork">×</button><img id="dialog-image" alt=""><div class="dialog-copy"><p class="eyebrow" id="dialog-type"></p><h2 id="dialog-title"></h2><p id="dialog-story"></p><div class="reader-links"><a id="dialog-reader" href="#">Read the story ↗</a><a id="dialog-original" href="#" target="_blank" rel="noopener">Open original ↗</a></div></div></dialog>"""
    return shell("Gallery", "Explore covers, character studies, landscapes, illustrations, and comic art from the Story Computing Machine.", body,
                 "Gallery", base, site_url, "art/")


def redirect_page(destination: str, title: str) -> str:
    return (f'<!doctype html><html lang="en"><meta charset="utf-8">'
            f'<meta http-equiv="refresh" content="0;url={esc(destination)}">'
            f'<title>Redirecting to {esc(title)}</title>'
            f'<p><a href="{esc(destination)}">Continue to {esc(title)}</a></p></html>')


def build(output: Path, base: str, site_url: str, media_index: dict | None = None,
          *, index_url: str = DEFAULT_INDEX_URL, offline: bool = False) -> None:
    if not base.startswith("/") or not base.endswith("/") or "//" in base:
        raise ValueError("Base path must start and end with / and contain no //")
    resolved_output = output.resolve()
    protected = (CONTENT, STATIC, ROOT / "scripts", ROOT / "tests", ROOT / ".git")
    if resolved_output == ROOT or resolved_output in ROOT.parents or any(
        resolved_output == path or path in resolved_output.parents for path in protected
    ):
        raise ValueError(f"Output overlaps website source: {resolved_output}")
    if media_index is None:
        media_index, source = load_media_index(index_url, offline=offline)
    else:
        source = "provided"
    stories = read_json("catalog.json")["stories"]
    if not stories:
        raise ValueError("The story catalog is empty")
    art, covers, comics = make_art(media_index, stories, base)
    art_by_story = defaultdict(list)
    for item in art:
        if item["id"] != f"stories/{item['slug']}/title-image.jpg":
            art_by_story[item["slug"]].append(item)
    if output.exists():
        shutil.rmtree(output)
    (output / "art").mkdir(parents=True)
    (output / "library").mkdir()
    (output / "stories").mkdir()
    for filename in ("styles.css", "app.js", "book-scroll.js", "book-cover-9x16.png", "book-back-cover-9x16.png", "favicon.svg", "favicon-32.png",
                     "apple-touch-icon.png", "social-card.jpg"):
        shutil.copy2(STATIC / filename, output / filename)
    (output / "index.html").write_text(
        build_scroll_home(base, site_url, stories, covers), encoding="utf-8")
    (output / "cover-feed.json").write_text(json.dumps([
        {"title": story["title"], "rating": story["rating"], "prompt": story["prompt"],
         "cover": covers[story["slug"]], "url": base + "stories/" + quote(story["slug"]) + "/"}
        for story in stories
    ], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (output / "library" / "index.html").write_text(
        build_index(stories, covers, base, site_url), encoding="utf-8")
    (output / "guide-catalog.json").write_text(json.dumps([
        {"slug": story["slug"], "title": story["title"], "rating": story["rating"],
         "canon": story["canon"], "prompt": story["prompt"], "body": story["body"],
         "cover": covers[story["slug"]], "url": base + "stories/" + quote(story["slug"]) + "/"}
        for story in stories
    ], ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (output / "art" / "index.html").write_text(build_art_page(len(art), base, site_url), encoding="utf-8")
    (output / "art.json").write_text(json.dumps(art, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (output / "media-source.json").write_text(json.dumps({
        "source": source, "sourceCommit": media_index["sourceCommit"],
        "indexUrl": media_index["indexUrl"], "assets": len(media_index["assets"]),
    }, separators=(",", ":")), encoding="utf-8")
    for story in stories:
        slug = story["slug"]
        destination = output / "stories" / slug
        destination.mkdir()
        (destination / "index.html").write_text(
            build_story(story, stories, covers, art_by_story[slug], comics.get(slug), base, site_url),
            encoding="utf-8",
        )
        (output / "stories" / f"{slug}.html").write_text(
            redirect_page(base + f"stories/{quote(slug)}/", story["title"]), encoding="utf-8",
        )
    for old_path, category in (("characters.html", "Characters"),
                               ("landscapes.html", "Landscapes & interiors"),
                               ("interiors.html", "Landscapes & interiors")):
        (output / old_path).write_text(
            redirect_page(base + f"art/?type={quote(category)}", category), encoding="utf-8",
        )
    sitemap = "".join(
        f"<url><loc>{esc(site_url.rstrip('/') + base + path)}</loc></url>"
        for path in ["", "library/", "art/"] + [f"stories/{s['slug']}/" for s in stories]
    )
    (output / "sitemap.xml").write_text(
        f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sitemap}</urlset>',
        encoding="utf-8",
    )
    (output / "robots.txt").write_text(
        f"User-agent: *\nAllow: /\nSitemap: {site_url.rstrip('/') + base}sitemap.xml\n", encoding="utf-8",
    )
    (output / ".nojekyll").touch()
    print(f"Built {len(stories)} story readers and {len(art)} gallery images from {source} media index")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "_site")
    parser.add_argument("--base-path", default="/")
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    parser.add_argument("--media-index-url", default=DEFAULT_INDEX_URL)
    parser.add_argument("--offline", action="store_true", help="Use the checked-in index snapshot")
    args = parser.parse_args()
    build(args.output, args.base_path, args.site_url, index_url=args.media_index_url, offline=args.offline)
