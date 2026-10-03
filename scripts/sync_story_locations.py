"""Prepare a same-story location painting for every Long Horizon stop.

Reuse the prepared panorama art where possible, then make small local WebP
derivatives of location assets in the verified media index. Stories without
location art use the shared painted fallback until the source repo adds art.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path

from scripts.build import CONTENT, ROOT, validate_media_index
from scripts.sync_panorama import art_path_order, band_colour, fetch, place_title, to_webp


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, help="Local story-computing-machine checkout")
    args = parser.parse_args()

    stories = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]
    media_index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
    assets = validate_media_index(media_index)
    panorama = json.loads((CONTENT / "panorama.json").read_text(encoding="utf-8"))
    prepared = {stop["slug"]: stop["landscape"] for stop in panorama["stops"]}
    prepared_covers = {stop["slug"]: stop["cover"] for stop in panorama["stops"]} | panorama.get("covers", {})
    output = ROOT / "static" / "story-locations"
    output.mkdir(parents=True, exist_ok=True)
    cover_output = ROOT / "static" / "story-covers"
    cover_output.mkdir(parents=True, exist_ok=True)
    entries = {}
    covers = {}
    local_sources = {}
    for story in stories:
        slug = story["slug"]
        if slug in prepared_covers:
            covers[slug] = prepared_covers[slug]
        else:
            name = f"{slug}.webp"
            data, _ = to_webp(fetch(assets[f"stories/{slug}/title-image.jpg"], args.repository), 540, 70)
            (cover_output / name).write_bytes(data)
            covers[slug] = f"story-covers/{name}"
        if slug in prepared:
            entries[slug] = prepared[slug]
            continue
        prefixes = [f"stories/{slug}/art/{kind}/" for kind in ("landscapes", "interiors")]
        source = next((path for prefix in prefixes for path in sorted(assets, key=art_path_order)
                       if path.startswith(prefix) and assets[path]["contentType"].startswith("image/")), None)
        local_source = None
        if source is None and args.repository:
            for prefix in prefixes:
                directory = args.repository / prefix
                candidates = sorted((path for path in directory.glob("*")
                                     if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}),
                                    key=lambda path: art_path_order(path.as_posix()))
                if candidates:
                    local_source = candidates[0]
                    source = local_source.relative_to(args.repository).as_posix()
                    break
        if source is None:
            entries[slug] = {"src": "location-fallback.webp", "title": "A place beyond the page",
                             "sky": "#53617c", "ground": "#393835", "source": None}
            continue
        name = f"{slug}.webp"
        original = local_source.read_bytes() if local_source else fetch(assets[source], args.repository)
        if local_source:
            local_sources[source] = sha256(original).hexdigest()
        data, image = to_webp(original, 1400, 60)
        (output / name).write_bytes(data)
        entries[slug] = {"src": f"story-locations/{name}", "title": place_title(source),
                         "sky": band_colour(image, 0, .3), "ground": band_colour(image, .72, 1),
                         "source": source}

    manifest = {"schemaVersion": 1, "sourceCommit": media_index["sourceCommit"], "locations": entries,
                "covers": covers, "localSourceHashes": local_sources}
    (CONTENT / "story-locations.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} story locations: {sum(v['source'] is None for v in entries.values())} fallbacks")


if __name__ == "__main__":
    main()
