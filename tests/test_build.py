from __future__ import annotations

import copy
from collections import Counter
from hashlib import sha256
import html
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from scripts.build import (CONTENT, ICON_VERSION, STATIC, asset_url, build, load_media_index, make_art,
                           prompt_markup, prose_markup, validate_media_index)
from scripts.sync_ratings import source_rating
from scripts.sync_panorama import choose_pool


class SiteBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
        cls.stories = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]

    def test_index_drives_every_cover_and_gallery_image(self) -> None:
        assets = validate_media_index(self.index)
        art, covers = make_art(self.index, self.stories, "/storytelling-machine/")
        self.assertEqual(len(assets), 2024)
        self.assertEqual(len(art), 1995)
        self.assertEqual(len(covers), len(self.stories))
        self.assertEqual(dict(Counter(item["type"] for item in art)), {
            "Covers": 230, "Characters": 799, "Locations": 966,
        })
        self.assertTrue(all(item["id"].startswith("stories/") for item in art))
        self.assertTrue(any(item["type"] == "Locations" and item["thumbnail"] != item["full"]
                            for item in art))
        self.assertEqual(covers["the-sun-in-the-crowd"], assets["stories/the-sun-in-the-crowd/title-image.jpg"]["url"])
        self.assertEqual(covers["the-closed-day"], assets["stories/the-closed-day/title-image.jpg"]["url"])
        self.assertEqual(covers["after-the-party"], assets["stories/after-the-party/title-image.jpg"]["url"])
        self.assertEqual(covers["spirit-heart"], assets["stories/spirit-heart/title-image.jpg"]["url"])
        self.assertEqual(covers["onyx-peace"], assets["stories/onyx-peace/title-image.jpg"]["url"])
        self.assertEqual(covers["the-fox-that-stood-up"], assets["stories/the-fox-that-stood-up/title-image.jpg"]["url"])
        for slug in ("the-statue-at-the-corner", "found-the-spares", "magical-girl-pr",
                     "the-second-door", "the-last-watch", "no-vacancy", "great-winter-contest",
                     "rgbknights", "an-opening", "the-return-tray", "the-last-passenger",
                     "shenanigans", "catch-me", "the-other-half", "feast-of-the-noble-blades",
                     "the-other-hand", "wrath-limit-break", "for-my-own-use", "one-good-scream"):
            self.assertEqual(covers[slug], assets[f"stories/{slug}/title-image.jpg"]["url"])
        for slug, filename in (("onyx-peace", "01-sheltered-cove.png"),
                               ("the-fox-that-stood-up", "01-night-market-lane.png")):
            source = f"stories/{slug}/art/landscapes/{filename}"
            self.assertTrue(any(item["id"] == source and item["type"] == "Locations" for item in art))
        self.assertTrue({item["full"] for item in art}.issubset(
            {item["url"] for item in assets.values() if item["contentType"].startswith("image/")}))
        self.assertEqual(len({item["id"] for item in art}), len(art))
        self.assertFalse(any(item["id"].endswith(("/auvet.webp", "/mial.webp")) for item in art))
        self.assertFalse(any("/references/" in item["id"] for item in art))
        self.assertFalse(any(item["id"] == "stories/a-crown-for-the-endless-fire/art/landscapes/03-black-bridge-across-the-gulf.png" for item in art))

    def test_gallery_shows_finished_locations_without_version_labels(self) -> None:
        art, _ = make_art(self.index, self.stories, "/")
        locations = [item for item in art if item["type"] == "Locations"]
        self.assertFalse(any(Path(item["id"]).stem.endswith("-original") for item in locations))
        self.assertFalse(any(item["title"].endswith((" Original", " Selected")) for item in locations))
        for slug, title, filename in (
            ("the-last-watch", "Rift Watch", "02-rift-watch-selected.png"),
            ("the-second-door", "Bellwether", "bellwether-selected.webp"),
            ("magical-girl-pr", "Bakery Square", "bakery-square-selected.webp"),
            ("the-other-half", "Food Court Open Curtain", "02-food-court-open-curtain.png"),
            ("great-winter-contest", "Seven Steps", "seven-steps.png"),
        ):
            with self.subTest(story=slug):
                images = [item for item in locations if item["slug"] == slug]
                self.assertEqual([item["title"] for item in images], [title])
                self.assertTrue(images[0]["id"].endswith("/" + filename))
                self.assertNotIn("Selected", images[0]["alt"])

    def test_build_keeps_readers_and_old_links(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "site"
            build(output, "/storytelling-machine/", "https://example.org", self.index)
            gallery = json.loads((output / "art.json").read_text(encoding="utf-8"))
            self.assertEqual(len(gallery), 1995)
            self.assertEqual(set(item["type"] for item in gallery), {
                "Covers", "Characters", "Locations",
            })
            for story in self.stories:
                page = output / "stories" / story["slug"] / "index.html"
                self.assertTrue(page.is_file(), story["slug"])
                text = page.read_text(encoding="utf-8")
                self.assertIn("Writing prompt", text)
                self.assertIn(html.escape(story["title"]), text)
                self.assertTrue((output / "stories" / f"{story['slug']}.html").is_file())
            homepage = (output / "index.html").read_text(encoding="utf-8")
            library = (output / "library" / "index.html").read_text(encoding="utf-8")
            css_version = sha256((STATIC / "styles.css").read_bytes()).hexdigest()[:12]
            js_version = sha256((STATIC / "app.js").read_bytes()).hexdigest()[:12]
            self.assertIn(f'styles.css?v={css_version}', homepage)
            self.assertIn(f'app.js?v={js_version}', homepage)
            self.assertIn('id="living-library"', homepage)
            self.assertIn('id="ll-canvas"', homepage)
            self.assertIn('id="ll-prompt"', homepage)
            self.assertIn('id="ll-references"', homepage)
            self.assertIn('class="ll-scroll-hint" id="ll-scroll-hint"', homepage)
            for removed_control in ('ll-controls', 'll-picker', 'll-prev', 'll-next', 'll-number', 'll-progress'):
                self.assertNotIn(removed_control, homepage)
            self.assertIn('class="ll-book-link" id="ll-read"', homepage)
            self.assertNotIn('class="ll-read"', homepage)
            self.assertNotIn('ll-prompt-scroll', homepage)
            self.assertIn('type="module" src="/storytelling-machine/living-library.js?v=', homepage)
            self.assertIn('href="/storytelling-machine/living-library.css?v=', homepage)
            self.assertIn('class="living-library-body is-library-loading"', homepage)
            self.assertNotIn('horizon.js', homepage)
            self.assertNotIn('book-scroll.js', homepage)
            self.assertNotIn('id="story-guide"', homepage)
            data = json.loads(html.unescape(homepage.split('id="living-library-data">', 1)[1].split('</script>', 1)[0]).replace('<\\/', '</'))
            self.assertEqual(data["total"], len(self.stories))
            self.assertEqual(len(data["stories"]), len(self.stories))
            location_manifest = json.loads((CONTENT / "story-locations.json").read_text(encoding="utf-8"))["locations"]
            atlas = json.loads((CONTENT / "panorama.json").read_text(encoding="utf-8"))["atlas"]
            self.assertEqual(len({book["slot"] for book in data["stories"]}), len(self.stories))
            for story in data["stories"]:
                self.assertTrue(story["cover"].startswith(("/storytelling-machine/panorama/", "/storytelling-machine/story-covers/")))
                self.assertTrue((output / story["cover"].removeprefix("/storytelling-machine/")).is_file())
                slug = story["slug"]
                self.assertEqual(atlas["tiles"][story["slot"]], [slug, "cover"])
                self.assertTrue(story["url"].startswith("/storytelling-machine/stories/"))
                self.assertEqual(story["art"], f"/storytelling-machine/art/?story={slug}")
                source = location_manifest[slug]["source"]
                available = sum(item["slug"] == slug and item["type"] != "Covers" and item["id"] != source
                                for item in gallery)
                self.assertEqual(len(story["references"]), min(6, 1 + available))
                self.assertTrue(all(ref["slug"] == slug for ref in story["references"]))
                self.assertEqual(len({ref["src"] for ref in story["references"]}), len(story["references"]))
                location = story["references"][0]
                self.assertTrue((output / location["src"].removeprefix("/storytelling-machine/")).is_file())
                if source is not None:
                    self.assertTrue(source.startswith(f"stories/{slug}/art/"), source)
            self.assertTrue((output / "panorama" / "atlas.webp").is_file())
            self.assertTrue((output / "vendor" / "three.module.min.js").is_file())
            self.assertEqual(library.count('data-story-card'), len(self.stories))
            self.assertIn('id="story-search"', library)
            self.assertIn('href="/storytelling-machine/library/"', library)
            guide_catalog = json.loads((output / "guide-catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(len(guide_catalog), len(self.stories))
            self.assertEqual(guide_catalog[0]["prompt"], self.stories[0]["prompt"])
            self.assertEqual([story["slug"] for story in guide_catalog[:19]], [
                "one-good-scream", "for-my-own-use",
                "wrath-limit-break",
                "the-other-hand", "feast-of-the-noble-blades", "the-other-half",
                "catch-me", "shenanigans",
                "the-last-passenger", "the-return-tray", "an-opening", "rgbknights",
                "great-winter-contest", "no-vacancy", "the-last-watch", "the-second-door",
                "magical-girl-pr", "found-the-spares", "the-statue-at-the-corner",
            ])
            self.assertEqual(guide_catalog[0]["rating"], "General")
            cover_feed = json.loads((output / "cover-feed.json").read_text(encoding="utf-8"))
            self.assertEqual(len(cover_feed), len(self.stories))
            self.assertEqual(cover_feed[0]["cover"], guide_catalog[0]["cover"])
            self.assertEqual(cover_feed[0]["prompt"], self.stories[0]["prompt"])
            self.assertEqual(cover_feed[0]["createdAt"], self.stories[0]["createdAt"])
            self.assertTrue((output / "living-library.js").is_file())
            self.assertTrue((output / "living-library.css").is_file())
            self.assertFalse((output / "horizon.js").exists())
            self.assertFalse((output / "skybox-twilight.webp").exists())
            self.assertIn('<option value="Mature">Mature</option>', library)
            self.assertIn('<meta name="twitter:card" content="summary_large_image">', homepage)
            self.assertIn('content="https://example.org/storytelling-machine/social-card.jpg"', homepage)
            self.assertIn('content="https://example.org/storytelling-machine/"', homepage)
            self.assertIn(f'href="/storytelling-machine/apple-touch-icon.png?v={ICON_VERSION}"', homepage)
            self.assertIn('Explore original fiction and artwork', library)
            self.assertIn('content="https://example.org/storytelling-machine/social-card.jpg"', library)
            self.assertTrue((output / "social-card.jpg").is_file())
            self.assertTrue((output / "favicon-32.png").is_file())
            self.assertTrue((output / "apple-touch-icon.png").is_file())
            self.assertNotIn("engine.js", homepage)
            self.assertFalse((output / "engine.js").exists())
            gallery_page = (output / "art" / "index.html").read_text(encoding="utf-8")
            self.assertIn('id="art-type"', gallery_page)
            self.assertIn('<option value="Locations">Locations</option>', gallery_page)
            self.assertEqual(gallery_page.count('<option value="Comics">'), 0)
            self.assertIn('id="art-sentinel"', gallery_page)
            self.assertIn('content="https://example.org/storytelling-machine/social-card.jpg"', gallery_page)
            story_page = (output / "stories" / self.stories[0]["slug"] / "index.html").read_text(encoding="utf-8")
            self.assertIn('<meta property="og:type" content="article">', story_page)
            self.assertIn('<meta name="twitter:image" content="https://art.rgbknights.com/', story_page)
            self.assertTrue((output / "characters.html").is_file())
            self.assertIn("type=Locations", (output / "landscapes.html").read_text(encoding="utf-8"))
            self.assertIn("type=Locations", (output / "interiors.html").read_text(encoding="utf-8"))
            artwork_story = (output / "stories" / "all-accounts-due" / "index.html").read_text(encoding="utf-8")
            self.assertIn("View 12 artwork items", artwork_story)
            self.assertNotIn("Download comic PDF", artwork_story)
            self.assertEqual(json.loads((output / "media-source.json").read_text(encoding="utf-8"))["sourceCommit"], self.index["sourceCommit"])

    def test_published_ratings_match_pinned_source_counts(self) -> None:
        source = json.loads((CONTENT / "ratings-source.json").read_text(encoding="utf-8"))
        self.assertEqual(len(self.stories), source["stories"])
        self.assertEqual(dict(Counter(story["rating"] for story in self.stories)), source["counts"])
        self.assertEqual(source["counts"], {"General": 132, "Teen": 83, "Mature": 9, "Explicit": 6})
        self.assertEqual(source["localOverrides"], {"onyx-peace": "General"})
        for story in self.stories[:5]:
            self.assertEqual(story["body"].splitlines().count(f"# {story['title']}"), 1)

    def test_pinned_cover_hashes_match_media_index(self) -> None:
        covers = json.loads((CONTENT / "covers.json").read_text(encoding="utf-8"))
        source = json.loads((CONTENT / "source.json").read_text(encoding="utf-8"))
        assets = validate_media_index(self.index)
        self.assertRegex(source["commit"], r"^[a-f0-9]{40}$")
        self.assertEqual(len(covers), len(self.stories))
        for story in self.stories:
            self.assertEqual(covers[story["cover"]],
                             assets[f"stories/{story['slug']}/title-image.jpg"]["sha256"])

    def test_source_rating_accepts_both_published_formats(self) -> None:
        with patch("scripts.sync_ratings.git_text", return_value="# Content rating\n\n- **Rating:** Mature\n"):
            self.assertEqual(source_rating(Path("."), "commit", "older-story"), "Mature")
        with patch("scripts.sync_ratings.git_text", return_value="# Rating\n\nGeneral\n"):
            self.assertEqual(source_rating(Path("."), "commit", "newer-story"), "General")

    def test_remote_404_uses_verified_snapshot(self) -> None:
        error = HTTPError("https://art.example.org/index.json", 404, "missing", {}, None)
        with patch("scripts.build.urlopen", side_effect=error):
            index, source = load_media_index("https://art.example.org/index.json")
        self.assertEqual(source, "snapshot")
        self.assertEqual(len(index["assets"]), 2024)

    def test_homepage_uses_selected_location_corrections(self) -> None:
        expected = {
            "one-good-scream": "landscapes/fairground-and-house-of-horrors.webp",
            "for-my-own-use": "interiors/neris-rented-room.webp",
            "wrath-limit-break": "landscapes/northern-bastion-pass.webp",
            "the-other-hand": "landscapes/island-city-selected.webp",
            "feast-of-the-noble-blades": "interiors/feast-hall-selected.png",
            "the-other-half": "interiors/02-food-court-open-curtain.png",
            "catch-me": "landscapes/cinema-street-selected.png",
            "shenanigans": "landscapes/02-reviewing-ring-selected.png",
            "the-last-passenger": "landscapes/the-crossing-selected.webp",
            "the-return-tray": "interiors/02-kitchen-cushion-exchange.png",
            "an-opening": "interiors/02-guild-hall-selected.png",
            "rgbknights": "interiors/knight-shift-selected.png",
            "great-winter-contest": "landscapes/seven-steps.png",
            "no-vacancy": "landscapes/02-bakers-lane-selected.png",
            "the-last-watch": "interiors/02-rift-watch-selected.png",
            "the-second-door": "interiors/bellwether-selected.webp",
            "magical-girl-pr": "landscapes/bakery-square-selected.webp",
            "found-the-spares": "interiors/front-room-selected.webp",
            "the-statue-at-the-corner": "landscapes/03-button-shop-roomy-selected.png",
            "the-weight-of-here": "landscapes/den-selected.webp",
            "the-unspent-star": "landscapes/01-ring-universe-selected.png",
            "right-of-way": "landscapes/ridge-over-town-selected.webp",
            "the-engine-under-the-sand": "landscapes/02-big-sleeper-basin-selected.png",
            "the-eyes-of-god": "landscapes/02-open-square-selected.png",
            "the-bait-remembers": "interiors/02-post-office-selected.png",
            "what-counts-as-morning": "interiors/02-station-selected.png",
            "where-the-gods-left-their-doors": "interiors/02-hearth-nine-hall-selected.png",
        }
        locations = json.loads((CONTENT / "story-locations.json").read_text(encoding="utf-8"))["locations"]
        pool = choose_pool(self.stories, validate_media_index(self.index), 40, 6)
        landscapes = {entry["story"]["slug"]: entry["landscape"] for entry in pool}
        for slug, path in expected.items():
            source = f"stories/{slug}/art/{path}"
            self.assertEqual(locations[slug]["source"], source)
            if slug in landscapes:
                self.assertEqual(landscapes[slug], source)

    def test_pool_prefers_final_painting_without_selected_suffix(self) -> None:
        stories = [{"slug": "snow-race"}]
        paths = ["stories/snow-race/art/landscapes/seven-steps-original.png",
                 "stories/snow-race/art/landscapes/seven-steps.png"]
        assets = {path: {"contentType": "image/png"} for path in paths}
        pool = choose_pool(stories, assets, 1, 1)
        self.assertEqual(pool[0]["landscape"], paths[1])

    def test_public_index_is_used_when_available(self) -> None:
        payload = json.dumps(self.index).encode("utf-8")
        with patch("scripts.build.urlopen", return_value=io.BytesIO(payload)):
            index, source = load_media_index("https://art.example.org/index.json")
        self.assertEqual(source, "public")
        self.assertEqual(index["sourceCommit"], self.index["sourceCommit"])

    def test_tampered_media_url_is_rejected(self) -> None:
        index = copy.deepcopy(self.index)
        index["assets"][0]["url"] = "https://elsewhere.example/cover.png"
        with self.assertRaisesRegex(ValueError, "Invalid R2 URL"):
            validate_media_index(index)

    def test_untrusted_prompt_text_is_escaped(self) -> None:
        self.assertIn("&lt;script&gt;", prompt_markup("<script>"))
        self.assertNotIn("<script>", prompt_markup("<script>"))

    def test_prose_does_not_repeat_matching_title(self) -> None:
        self.assertEqual(prose_markup("# Title\n\nFirst paragraph.", "Title").strip(), "<p>First paragraph.</p>")

    def test_old_thumbnail_url_is_content_addressed(self) -> None:
        digest = "a" * 64
        self.assertEqual(asset_url("covers/my cover.jpg", digest, "https://art.example.org"),
                         f"https://art.example.org/assets/{digest}/my%20cover.jpg")


if __name__ == "__main__":
    unittest.main()
