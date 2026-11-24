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

from scripts.build import CONTENT, ROOT, excluded_art_paths
from scripts.sync_panorama import art_path_order, band_colour, place_title, preparation_assets, prepare_image, to_webp


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, help="Local story-computing-machine checkout")
    parser.add_argument("--output-root", type=Path, default=ROOT,
                        help="Read the candidate catalog and panorama and write derivatives under this directory")
    args = parser.parse_args()

    content = args.output_root / "content"
    stories = json.loads((content / "catalog.json").read_text(encoding="utf-8"))["stories"]
    media_index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
    assets, retained = preparation_assets(media_index, content)
    excluded = excluded_art_paths()
    panorama = json.loads((content / "panorama.json").read_text(encoding="utf-8"))
    prepared = {stop["slug"]: stop["landscape"] for stop in panorama["stops"]
                if stop["landscape"].get("source") not in excluded}
    prepared_covers = {stop["slug"]: stop["cover"] for stop in panorama["stops"]} | panorama.get("covers", {})
    output = args.output_root / "static" / "story-locations"
    output.mkdir(parents=True, exist_ok=True)
    cover_output = args.output_root / "static" / "story-covers"
    cover_output.mkdir(parents=True, exist_ok=True)
    entries = {}
    covers = {}
    local_sources = {}
    previous = CONTENT / "story-locations.json"
    last = json.loads(previous.read_text(encoding="utf-8")) if previous.is_file() else {}
    approved_hashes = last.get("localSourceHashes", {})
    for story in stories:
        slug = story["slug"]
        if slug in prepared_covers:
            covers[slug] = prepared_covers[slug]
        else:
            name = f"{slug}.webp"
            data, _ = prepare_image(assets[f"stories/{slug}/title-image.jpg"], args.repository, 540, 70)
            (cover_output / name).write_bytes(data)
            covers[slug] = f"story-covers/{name}"
        if slug in prepared:
            entries[slug] = prepared[slug]
            source = prepared[slug]["source"]
            if slug in retained and source in approved_hashes:
                local_sources[source] = approved_hashes[source]
            continue
        prefixes = [f"stories/{slug}/art/{kind}/" for kind in ("landscapes", "interiors")]
        source = next((path for prefix in prefixes for path in sorted(assets, key=art_path_order)
                       if path.startswith(prefix) and assets[path]["contentType"].startswith("image/")), None)
        local_original = None
        if source is None and args.repository and slug not in retained:
            # Only a previously pinned historical painting may come from the writing checkout.
            for candidate in sorted(approved_hashes, key=art_path_order):
                if candidate in excluded or candidate.count("/") != 4 or not candidate.startswith(tuple(prefixes)):
                    continue
                path = args.repository / candidate
                if path.is_file() and path.resolve().is_relative_to(args.repository.resolve()):
                    data = path.read_bytes()
                    if sha256(data).hexdigest() == approved_hashes[candidate]:
                        local_original, source = data, candidate
                        local_sources[source] = approved_hashes[source]
                        break
        if source is None:
            if slug in retained and last["locations"][slug]["source"] is None:
                entries[slug] = last["locations"][slug]
            else:
                entries[slug] = {"src": "location-fallback.webp", "title": "A place beyond the page",
                                 "sky": "#53617c", "ground": "#393835", "source": None}
            continue
        name = f"{slug}.webp"
        if local_original is not None:
            data, image = to_webp(local_original, 1400, 60)
        else:
            data, image = prepare_image(assets[source], args.repository, 1400, 60)
        if slug in retained and source in approved_hashes:
            local_sources[source] = approved_hashes[source]
        (output / name).write_bytes(data)
        entries[slug] = {"src": f"story-locations/{name}", "title": place_title(source),
                         "sky": band_colour(image, 0, .3), "ground": band_colour(image, .72, 1),
                         "source": source, **assets.get(source, {}).get("metadata", {})}

    manifest = {"schemaVersion": 1, "sourceCommit": media_index["sourceCommit"], "locations": entries,
                "covers": covers, "localSourceHashes": local_sources}
    (content / "story-locations.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Prepared {len(entries)} story locations: {sum(v['source'] is None for v in entries.values())} fallbacks")


if __name__ == "__main__":
    main()
