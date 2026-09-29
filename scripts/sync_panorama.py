"""Prepare the art for the Long Horizon home page.

The home page walks a single painted horizon made from the collection's
landscape paintings. Each stop pairs a story cover with a landscape and, when
one exists, a character study from the same story. The originals on R2 are
large PNGs, so this script selects a pool of stories, downloads their art from
the verified media index, and writes small WebP derivatives to
``static/panorama`` with a manifest in ``content/panorama.json``.

Run it after importing new stories:

    python scripts/sync_panorama.py            # uses the checked-in media index
    python scripts/sync_panorama.py --pool 40 --newest 6
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import io
import json
from pathlib import Path, PurePosixPath
import re
from urllib.request import Request, urlopen

from PIL import Image, ImageOps, ImageStat

try:
    from scripts.build import CONTENT, ROOT, friendly_name, validate_media_index
except ModuleNotFoundError:  # executed as a file
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.build import CONTENT, ROOT, friendly_name, validate_media_index

OUTPUT = ROOT / "static" / "panorama"
CACHE = ROOT / ".cache" / "panorama-originals"
LANDSCAPE_WIDTH, COVER_WIDTH, STUDY_WIDTH = 1400, 540, 520
ATLAS_COLS, ATLAS_ROWS, TILE_W, TILE_H = 25, 14, 80, 142


def fetch(item: dict, repository: Path | None) -> bytes:
    """Return verified bytes for a media-index entry (local source, cache, then R2)."""
    candidates = []
    if repository:
        candidates.append(repository / item["path"])
    cached = CACHE / item["sha256"]
    candidates.append(cached)
    for path in candidates:
        if path.is_file():
            data = path.read_bytes()
            if sha256(data).hexdigest() == item["sha256"]:
                return data
    request = Request(item["url"], headers={"User-Agent": "StorytellingMachine-Panorama/1.0"})
    with urlopen(request, timeout=60) as response:
        data = response.read()
    if sha256(data).hexdigest() != item["sha256"]:
        raise ValueError(f"Hash mismatch for {item['path']}")
    CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(data)
    return data


def place_title(path: str) -> str:
    """Readable painting title; restores obvious possessives lost in file names."""
    title = friendly_name(path)
    title = re.sub(r"\b([A-Z][a-z]*[^aeiou\s])ys\b", r"\1y's", title)
    title = re.sub(r"\b([A-Z][a-z]*(?:ch|sh|x))s\b", r"\1's", title)
    small = {"a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to", "under", "over", "beneath", "beyond", "above", "between", "before", "after", "into", "with"}
    words = title.split()
    return " ".join(word if index == 0 or word.lower() not in small else word.lower()
                    for index, word in enumerate(words))


def to_webp(data: bytes, width: int, quality: int) -> tuple[bytes, Image.Image]:
    image = Image.open(io.BytesIO(data))
    if image.mode in ("RGBA", "LA", "P"):
        background = Image.new("RGB", image.size, (238, 230, 214))
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.split()[-1])
        image = background
    image = image.convert("RGB")
    if image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, "WEBP", quality=quality, method=6)
    return buffer.getvalue(), image


def band_colour(image: Image.Image, top: float, bottom: float) -> str:
    band = image.crop((0, int(image.height * top), image.width, int(image.height * bottom)))
    r, g, b = (round(value) for value in ImageStat.Stat(band).mean[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def build_atlas(stories: list[dict], assets: dict[str, dict], extras: list[tuple[str, str, Image.Image]],
                repository: Path | None) -> dict:
    """Pack every cover (plus pool sketches and landscape slices) into one mosaic texture."""
    atlas = Image.new("RGB", (ATLAS_COLS * TILE_W, ATLAS_ROWS * TILE_H), (20, 16, 12))
    tiles = []

    def place(image: Image.Image, slug: str, kind: str) -> None:
        index = len(tiles)
        if index >= ATLAS_COLS * ATLAS_ROWS:
            return
        tile = ImageOps.fit(image.convert("RGB"), (TILE_W, TILE_H), Image.LANCZOS, centering=(.5, .42))
        atlas.paste(tile, ((index % ATLAS_COLS) * TILE_W, (index // ATLAS_COLS) * TILE_H))
        tiles.append([slug, kind])

    for story in stories:
        data = fetch(assets[f"stories/{story['slug']}/title-image.jpg"], repository)
        place(Image.open(io.BytesIO(data)), story["slug"], "cover")
    for slug, kind, image in extras:
        place(image, slug, kind)
    buffer = io.BytesIO()
    atlas.save(buffer, "WEBP", quality=72, method=6)
    (OUTPUT / "atlas.webp").write_bytes(buffer.getvalue())
    return {"src": "panorama/atlas.webp", "cols": ATLAS_COLS, "rows": ATLAS_ROWS,
            "width": atlas.width, "height": atlas.height, "tiles": tiles}


def choose_pool(stories: list[dict], assets: dict[str, dict], pool: int, newest: int) -> list[dict]:
    def art(slug: str, kind: str) -> list[str]:
        prefix = f"stories/{slug}/art/{kind}/"
        return sorted(path for path, item in assets.items()
                      if path.startswith(prefix) and path.count("/") == 4
                      and item["contentType"].startswith("image/"))

    eligible = [story for story in stories if art(story["slug"], "landscapes")]
    chosen = eligible[:newest]
    rest = eligible[newest:]
    remaining = max(0, pool - len(chosen))
    if rest and remaining:
        step = len(rest) / remaining
        chosen += [rest[int(index * step)] for index in range(min(remaining, len(rest)))]
    result = []
    for story in chosen:
        landscapes = art(story["slug"], "landscapes")
        studies = [path for path in art(story["slug"], "characters")]
        png_studies = [path for path in studies if not path.endswith(".webp")] or studies
        result.append({"story": story, "landscape": landscapes[0],
                       "study": png_studies[0] if png_studies else None})
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pool", type=int, default=40, help="Stories to prepare (default 40)")
    parser.add_argument("--newest", type=int, default=6, help="Newest stories always included (default 6)")
    parser.add_argument("--repository", type=Path, help="Optional local story-computing-machine checkout")
    args = parser.parse_args()

    index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
    assets = validate_media_index(index)
    stories = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]
    selection = choose_pool(stories, assets, args.pool, args.newest)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    keep, entries, total, extras = {"atlas.webp"}, [], 0, []
    for position, chosen in enumerate(selection, 1):
        story = chosen["story"]
        slug = story["slug"]
        cover_item = assets[f"stories/{slug}/title-image.jpg"]
        land_item = assets[chosen["landscape"]]
        cover_bytes, _ = to_webp(fetch(cover_item, args.repository), COVER_WIDTH, 70)
        land_bytes, land_image = to_webp(fetch(land_item, args.repository), LANDSCAPE_WIDTH, 60)
        files = {"cover": (f"{slug}-cover.webp", cover_bytes), "landscape": (f"{slug}-land.webp", land_bytes)}
        entry = {
            "slug": slug,
            "cover": f"panorama/{slug}-cover.webp",
            "landscape": {
                "src": f"panorama/{slug}-land.webp",
                "title": place_title(chosen["landscape"]),
                "width": land_image.width, "height": land_image.height,
                "sky": band_colour(land_image, 0, .3),
                "ground": band_colour(land_image, .72, 1),
                "source": chosen["landscape"],
            },
        }
        if chosen["study"]:
            study_bytes, study_image = to_webp(fetch(assets[chosen["study"]], args.repository), STUDY_WIDTH, 66)
            extras.append((slug, "study", study_image))
            files["study"] = (f"{slug}-study.webp", study_bytes)
            entry["study"] = {"src": f"panorama/{slug}-study.webp", "title": friendly_name(chosen["study"]),
                              "width": study_image.width, "height": study_image.height,
                              "source": chosen["study"]}
        extras.append((slug, "place", land_image.crop((land_image.width // 3, 0, land_image.width * 2 // 3, land_image.height))))
        for name, data in files.values():
            (OUTPUT / name).write_bytes(data)
            keep.add(name)
            total += len(data)
        entries.append(entry)
        print(f"{position:>2}. {story['title']} — {entry['landscape']['title']}")
    pooled = {entry["slug"] for entry in entries}
    extra_covers = {}
    for story in stories[:args.newest + 4]:
        if story["slug"] in pooled:
            continue
        name = f"{story['slug']}-cover.webp"
        data, _ = to_webp(fetch(assets[f"stories/{story['slug']}/title-image.jpg"], args.repository), COVER_WIDTH, 70)
        (OUTPUT / name).write_bytes(data)
        keep.add(name)
        total += len(data)
        extra_covers[story["slug"]] = f"panorama/{name}"
    atlas = build_atlas(stories, assets, extras, args.repository)
    for stale in OUTPUT.glob("*.webp"):
        if stale.name not in keep:
            stale.unlink()
    (CONTENT / "panorama.json").write_text(json.dumps({
        "schemaVersion": 1, "sourceCommit": index["sourceCommit"], "atlas": atlas, "covers": extra_covers, "stops": entries,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} stops ({total / 1e6:.1f} MB) in {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
