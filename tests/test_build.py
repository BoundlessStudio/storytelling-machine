from __future__ import annotations

import json
import html
import tempfile
import unittest
from pathlib import Path

from scripts.build import CONTENT, asset_url, build, prose_markup, prompt_markup


class SiteBuildTests(unittest.TestCase):
    def test_every_catalog_story_has_a_reader_and_art_has_a_reader(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "site"
            build(output, "/storytelling-machine/", "https://example.org", "https://art.example.org")
            catalog = json.loads((CONTENT / "catalog.json").read_text(encoding="utf-8"))
            artwork = json.loads((output / "art.json").read_text(encoding="utf-8"))
            self.assertEqual(len(catalog["stories"]), 195)
            self.assertGreaterEqual(len(artwork), 2000)
            for story in catalog["stories"]:
                page = output / "stories" / story["slug"] / "index.html"
                self.assertTrue(page.is_file(), story["slug"])
                text = page.read_text(encoding="utf-8")
                self.assertIn("Writing prompt", text)
                self.assertIn(html.escape(story["title"]), text)
            for item in artwork:
                self.assertTrue((output / item["reader"].removeprefix("/storytelling-machine/") / "index.html").is_file())
                self.assertTrue(item["full"].startswith("https://art.example.org/assets/"))
            self.assertIn("/storytelling-machine/styles.css", (output / "index.html").read_text(encoding="utf-8"))

    def test_untrusted_prompt_text_is_escaped(self) -> None:
        self.assertIn("&lt;script&gt;", prompt_markup("<script>"))
        self.assertNotIn("<script>", prompt_markup("<script>"))

    def test_prose_does_not_repeat_matching_title(self) -> None:
        self.assertEqual(prose_markup("# Title\n\nFirst paragraph.", "Title").strip(), "<p>First paragraph.</p>")

    def test_media_url_uses_content_hash_and_safe_name(self) -> None:
        digest = "a" * 64
        self.assertEqual(asset_url("covers/my cover.jpg", digest, "https://art.example.org"), f"https://art.example.org/assets/{digest}/my%20cover.jpg")
        with self.assertRaises(ValueError):
            asset_url("cover.jpg", "bad", "https://art.example.org")


if __name__ == "__main__":
    unittest.main()
