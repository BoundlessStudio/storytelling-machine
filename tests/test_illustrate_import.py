from hashlib import sha256
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from scripts.illustrate_import import ensure_illustrations, reference_measurements, run_illustrator


class AcceptedArtRecoveryTests(unittest.TestCase):
    def test_brief_requests_a_review_only_for_an_already_illustrated_story(self):
        with tempfile.TemporaryDirectory() as scratch:
            job = Path(scratch)
            (job / "input/references").mkdir(parents=True)
            for name in ("story.md", "ratings.md"):
                (job / "input" / name).write_text("The room is empty.")
            room = "art/interiors/empty-room.webp"
            (job / "accepted" / room).parent.mkdir(parents=True)
            Image.new("RGB", (64, 32), "green").save(job / "accepted" / room)
            cover = job / "accepted/title-image.jpg"
            Image.new("RGB", (32, 64), "blue").save(cover)
            original = cover.read_bytes()

            def review(args, **kwargs):
                brief = kwargs["input"].decode()
                self.assertIn('"cover":null', brief)
                self.assertNotIn("This edition needs a cover", brief)
                inspected = [{"id": f"accepted-{i:03}", "visible": True, "observation": "Flat field.",
                              "use": "Checked the existing image."} for i in (1, 2)]
                (job / "report-output.json").write_text(json.dumps({
                    "inputReviews": inspected, "review": "Inspected the retained art.", "cover": None,
                    "characters": [], "no_characters": "Unoccupied room.",
                    "locations": [{"subject": "Room", "path": room, "generated": None}],
                }))
                return subprocess.CompletedProcess(args, 0)

            with patch("scripts.illustrate_import.shutil.which", return_value="codex"), patch(
                    "scripts.illustrate_import.subprocess.run", side_effect=review) as cli:
                run_illustrator(job, "empty-room", "a" * 40)
                cli.assert_called_once()
            self.assertEqual(cover.read_bytes(), original)

    def test_private_palette_facts_preserve_size_and_every_flat_colour(self):
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "palette.png"
            colors = [(41, 75, 117), (33, 38, 46), (162, 166, 173)]
            swatch = Image.new("RGB", (192, 64))
            for index, color in enumerate(colors):
                swatch.paste(color, (64 * index, 0, 64 * (index + 1), 64))
            swatch.save(path)
            facts = reference_measurements(path)
            self.assertEqual((facts["widthPx"], facts["heightPx"]), (192, 64))
            self.assertEqual({c["rgb"]: c["pixels"] for c in facts["flatColors"]},
                             {"#294b75": 4096, "#21262e": 4096, "#a2a6ad": 4096})

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
            prior = sorted(p for p in accepted.rglob("*") if p.is_file())
            ids = ["ref-001"] + [f"accepted-{i:03}" for i in range(1, len(prior) + 1)]
            inspected = [{"id": item, "visible": True, "observation": "The dominant region is a flat colour.",
                          "use": "I compared its value to the reading room."} for item in ids]
            if not (accepted / "title-image.jpg").exists():
                Image.new("RGB", (864, 1536), "blue").save(accepted / "title-image.jpg")
            (accepted / study).parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (96, 128), "gold").save(accepted / study)
            (accepted / "illustrations.json").write_text(json.dumps({
                "locations": [{"subject": "Reading room", "path": study}],
                "characters": [], "no_characters": "The story inhabits an empty room.",
                "inputReviews": inspected, "review": "Reviewed the cover and the room study.",
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
