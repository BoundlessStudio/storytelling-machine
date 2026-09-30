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


class SiteBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
        cls.stories = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]

    def test_index_drives_every_cover_and_gallery_image(self) -> None:
        assets = validate_media_index(self.index)
        art, covers = make_art(self.index, self.stories, "/storytelling-machine/")
        self.assertEqual(len(assets), 1919)
        self.assertEqual(len(art), 1915)
        self.assertEqual(len(covers), len(self.stories))
        self.assertEqual(dict(Counter(item["type"] for item in art)), {
            "Covers": 207, "Characters": 765, "Locations": 943,
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

    def test_build_keeps_readers_and_old_links(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "site"
            build(output, "/storytelling-machine/", "https://example.org", self.index)
            gallery = json.loads((output / "art.json").read_text(encoding="utf-8"))
            self.assertEqual(len(gallery), 1915)
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
            self.assertIn('id="horizon"', homepage)
            self.assertIn('id="hz-canvas"', homepage)
            self.assertIn('id="about"', homepage)
            self.assertIn('id="hz-stops"', homepage)
            self.assertIn('type="module" src="/storytelling-machine/horizon.js?v=', homepage)
            self.assertIn('href="/storytelling-machine/horizon.css?v=', homepage)
            self.assertIn('class="horizon-body"', homepage)
            self.assertNotIn('book-scroll.js', homepage)
            self.assertNotIn('id="story-guide"', homepage)
            data = json.loads(html.unescape(homepage.split('id="horizon-data">', 1)[1].split('</script>', 1)[0]).replace('<\\/', '</'))
            self.assertEqual(data["total"], len(self.stories))
            self.assertGreaterEqual(len(data["pool"]), 14)
            self.assertEqual(len(data["titles"]), len(self.stories))
            self.assertTrue(all(stop["url"].startswith("/storytelling-machine/stories/") for stop in data["pool"]))
            for stop in data["pool"]:
                self.assertNotIn("study", stop)
                for path in (stop["cover"], stop["land"]["src"]):
                    self.assertTrue((output / path.removeprefix("/storytelling-machine/")).is_file(), path)
            self.assertEqual(len(data["stories"]), len(self.stories))
            self.assertEqual(len(data["locations"]), len(self.stories))
            location_manifest = json.loads((CONTENT / "story-locations.json").read_text(encoding="utf-8"))["locations"]
            for story in data["stories"]:
                self.assertTrue(story["cover"].startswith(("/storytelling-machine/panorama/", "/storytelling-machine/story-covers/")))
                self.assertTrue((output / story["cover"].removeprefix("/storytelling-machine/")).is_file())
                slug = story["slug"]
                location = data["locations"][slug]
                self.assertTrue((output / location["src"].removeprefix("/storytelling-machine/")).is_file())
                source = location_manifest[slug]["source"]
                if source is not None:
                    self.assertTrue(source.startswith(f"stories/{slug}/art/"), source)
            self.assertEqual(sum(kind == "cover" for _, kind in data["atlas"]["tiles"]), len(self.stories))
            self.assertTrue((output / "panorama" / "atlas.webp").is_file())
            self.assertTrue((output / "vendor" / "three.module.min.js").is_file())
            self.assertEqual(library.count('data-story-card'), len(self.stories))
            self.assertIn('id="story-search"', library)
            self.assertIn('href="/storytelling-machine/library/"', library)
            guide_catalog = json.loads((output / "guide-catalog.json").read_text(encoding="utf-8"))
            self.assertEqual(len(guide_catalog), len(self.stories))
            self.assertEqual(guide_catalog[0]["prompt"], self.stories[0]["prompt"])
            self.assertEqual([story["slug"] for story in guide_catalog[:7]], [
                "faith-and-demon", "the-bait-remembers", "the-eyes-of-god",
                "what-counts-as-morning", "spells-from-every-block",
                "the-cat-who-kept-up", "where-the-gods-left-their-doors",
            ])
            self.assertEqual(guide_catalog[0]["rating"], "General")
            cover_feed = json.loads((output / "cover-feed.json").read_text(encoding="utf-8"))
            self.assertEqual(len(cover_feed), len(self.stories))
            self.assertEqual(cover_feed[0]["cover"], guide_catalog[0]["cover"])
            self.assertEqual(cover_feed[0]["prompt"], self.stories[0]["prompt"])
            self.assertEqual(cover_feed[0]["createdAt"], self.stories[0]["createdAt"])
            self.assertTrue((output / "horizon.js").is_file())
            self.assertTrue((output / "horizon.css").is_file())
            self.assertTrue((output / "open-book-pages-wide.webp").is_file())
            self.assertTrue((output / "open-book-pages-tall.webp").is_file())
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
        self.assertEqual(source["counts"], {"General": 114, "Teen": 79, "Mature": 9, "Explicit": 5})
        self.assertEqual(source["localOverrides"], {"onyx-peace": "General"})
        for story in self.stories[:2]:
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
        self.assertEqual(len(index["assets"]), 1919)

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
