from __future__ import annotations

import copy
from hashlib import sha256
import html
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from scripts.build import (CONTENT, STATIC, asset_url, build, load_media_index, make_art,
                           prompt_markup, prose_markup, validate_media_index)


class SiteBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.index = json.loads((CONTENT / "media-index.json").read_text(encoding="utf-8"))
        cls.stories = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))["stories"]

    def test_index_drives_every_cover_and_gallery_image(self) -> None:
        assets = validate_media_index(self.index)
        art, covers, comics = make_art(self.index, self.stories, "/storytelling-machine/")
        self.assertEqual(len(assets), 2154)
        self.assertEqual(len(art), 2148)
        self.assertEqual(len(covers), len(self.stories))
        self.assertEqual(len(comics), 2)
        self.assertEqual(covers["the-sun-in-the-crowd"], assets["stories/the-sun-in-the-crowd/title-image.jpg"]["url"])
        self.assertTrue({item["full"] for item in art}.issubset(
            {item["url"] for item in assets.values() if item["contentType"].startswith("image/")}))
        self.assertEqual(len({item["id"] for item in art}), len(art))
        self.assertFalse(any(item["id"].endswith(("/auvet.webp", "/mial.webp")) for item in art))
        self.assertFalse(any("/references/" in item["id"] for item in art))
        self.assertFalse(any(item["id"] == "stories/a-crown-for-the-endless-fire/art/landscapes/03-black-bridge-across-the-gulf.png" for item in art))
        self.assertTrue(any(item["id"] == "stories/a-crown-for-the-endless-fire/art/landscapes/selected/03-black-bridge-across-the-gulf.png" for item in art))

    def test_build_keeps_readers_and_old_links(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "site"
            build(output, "/storytelling-machine/", "https://example.org", self.index)
            gallery = json.loads((output / "art.json").read_text(encoding="utf-8"))
            self.assertEqual(len(gallery), 2148)
            for story in self.stories:
                page = output / "stories" / story["slug"] / "index.html"
                self.assertTrue(page.is_file(), story["slug"])
                text = page.read_text(encoding="utf-8")
                self.assertIn("Writing prompt", text)
                self.assertIn(html.escape(story["title"]), text)
                self.assertTrue((output / "stories" / f"{story['slug']}.html").is_file())
            homepage = (output / "index.html").read_text(encoding="utf-8")
            css_version = sha256((STATIC / "styles.css").read_bytes()).hexdigest()[:12]
            self.assertIn(f'styles.css?v={css_version}', homepage)
            self.assertEqual(homepage.count('data-story-card'), len(self.stories))
            self.assertIn('id="story-search"', homepage)
            self.assertNotIn("engine.js", homepage)
            self.assertFalse((output / "engine.js").exists())
            self.assertIn('id="art-type"', (output / "art" / "index.html").read_text(encoding="utf-8"))
            self.assertTrue((output / "characters.html").is_file())
            self.assertEqual(json.loads((output / "media-source.json").read_text(encoding="utf-8"))["sourceCommit"], self.index["sourceCommit"])

    def test_remote_404_uses_verified_snapshot(self) -> None:
        error = HTTPError("https://art.example.org/index.json", 404, "missing", {}, None)
        with patch("scripts.build.urlopen", side_effect=error):
            index, source = load_media_index("https://art.example.org/index.json")
        self.assertEqual(source, "snapshot")
        self.assertEqual(len(index["assets"]), 2154)

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
