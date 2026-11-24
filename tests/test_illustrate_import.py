from hashlib import sha256
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from scripts.illustrate_import import ensure_illustrations


class AcceptedArtRecoveryTests(unittest.TestCase):
    def test_missing_study_is_replaced_and_modified_art_is_preserved_for_review(self):
        slug = "reading-room"
        commit = "a" * 40
        reference = "Room.png"
        paths = {f"stories/{slug}/story.md", f"stories/{slug}/ratings.md",
                 f"stories/{slug}/art/references/{reference}"}
        study = "art/interiors/room.webp"
        pixels = io.BytesIO()
        Image.new("RGB", (64, 32), "black").save(pixels, "PNG")

        def read_source(repository, commit, path):
            return pixels.getvalue() if path.endswith(reference) else b"A room after closing."

        def render(job, slug, commit):
            accepted = job / "accepted"
            if not (accepted / "title-image.jpg").exists():
                Image.new("RGB", (864, 1536), "blue").save(accepted / "title-image.jpg")
            (accepted / study).parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (96, 128), "gold").save(accepted / study)
            (accepted / "illustrations.json").write_text(json.dumps({
                "locations": [{"subject": "Reading room", "path": study}],
                "characters": [], "no_characters": "The story inhabits an empty room.",
                "review": "Reviewed the cover and the room study.",
            }))

        with tempfile.TemporaryDirectory() as scratch, patch(
            "scripts.illustrate_import.source_bytes", side_effect=read_source
        ), patch("scripts.illustrate_import.run_illustrator", side_effect=render) as illustrator:
            root = Path(scratch)
            work = root / "static" / "story-art" / slug
            args = (root, root / "source", commit, slug, paths)
            ensure_illustrations(*args, approved_references=[reference])
            receipt = json.loads((work / "illustrations.json").read_text())
            cover = (work / "title-image.jpg").read_bytes()

            (work / study).unlink()
            with self.assertRaises(ValueError):
                ensure_illustrations(*args)
            self.assertEqual(illustrator.call_count, 1)
            ensure_illustrations(*args, approved_references=[reference])
            self.assertEqual((work / "title-image.jpg").read_bytes(), cover)
            self.assertEqual(sha256((work / study).read_bytes()).hexdigest(), receipt["sha256"][study])
            self.assertEqual(illustrator.call_count, 2)

            Image.new("RGB", (864, 1536), "red").save(work / "title-image.jpg")
            changed_cover = (work / "title-image.jpg").read_bytes()
            (work / study).unlink()
            with self.assertRaises(ValueError):
                ensure_illustrations(*args, approved_references=[reference])
            self.assertEqual((work / "title-image.jpg").read_bytes(), changed_cover)
            self.assertEqual(illustrator.call_count, 2)
