from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.sync_ratings import refresh_story, sync


class SourceSyncTests(unittest.TestCase):
    def test_sync_refreshes_existing_current_and_historical_prose(self) -> None:
        commit = "a" * 40
        originals = [{
            "slug": slug, "title": title, "body": "Outdated prose", "canon": True,
            "created": "2026-08-01", "createdAt": "2026-08-01T12:00:00-04:00",
            "edited": "2026-08-01", "rating": "General", "status": "reviewed",
            "prompt": "The original prompt.", "cover": f"covers/{slug}.jpg",
        } for slug, title in [("current", "Current"), ("historical", "Historical")]]
        files = {
            "stories/current/story.md": b'---\ntitle: Current\ncanon: false\n---\n# Current\n\nRevised current prose.\n',
            "stories/historical/05-story.md": b'---\ntitle: Historical\ncanon: true\n---\n# The Authored Heading\n\nRevised historical prose.\n',
            "stories/historical/story.json": b'{"canon": false}',
            "stories/current/ratings.md": b'# Rating\n\nTeen\n',
            "stories/historical/ratings.md": b'# Rating\n\nGeneral\n',
            "stories/current/title-image.jpg": b'current cover',
            "stories/historical/title-image.jpg": b'historical cover',
        }

        def git_output(args: list[str], **kwargs):
            command = args[3]
            if command == "rev-parse":
                return commit + "\n"
            if command == "ls-tree":
                return "\n".join(files) + "\n"
            if command == "show":
                return files[args[4].split(":", 1)[1]]
            if command == "log":
                return "2026-10-13\n"
            self.fail(f"Unexpected git command: {args}")

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            content = root / "content"
            content.mkdir()
            (content / "catalog.json").write_text(json.dumps({"stories": originals}), encoding="utf-8")
            (content / "rating-overrides.json").write_text("{}", encoding="utf-8")
            with patch("scripts.sync_ratings.ROOT", root), patch(
                "scripts.sync_ratings.subprocess.check_output", side_effect=git_output
            ):
                sync(Path("source"), commit)
            stories = json.loads((content / "catalog.json").read_text(encoding="utf-8"))["stories"]
            self.assertEqual([s["slug"] for s in stories], ["current", "historical"])
            self.assertEqual(stories[0]["body"], "# Current\n\nRevised current prose.")
            self.assertEqual(stories[1]["body"], "# The Authored Heading\n\nRevised historical prose.")
            self.assertEqual(stories[0]["rating"], "Teen")
            for story, original in zip(stories, originals):
                self.assertFalse(story["canon"])
                self.assertEqual(story["edited"], "2026-10-13")
                for key in ("created", "createdAt", "prompt", "status"):
                    self.assertEqual(story[key], original[key])
            covers = json.loads((content / "covers.json").read_text(encoding="utf-8"))
            self.assertEqual(covers["covers/current.jpg"], sha256(b"current cover").hexdigest())
            self.assertEqual(json.loads((content / "source.json").read_text())["commit"], commit)

    def test_missing_source_prose_cannot_silently_keep_a_stale_copy(self) -> None:
        with self.assertRaisesRegex(ValueError, "Missing source prose"):
            refresh_story(Path("source"), "commit", {"slug": "missing"}, set())

    def test_empty_source_prose_is_rejected(self) -> None:
        with patch("scripts.sync_ratings.git_text", return_value="---\ntitle: Empty\n---\n\n"):
            with self.assertRaisesRegex(ValueError, "Missing story prose"):
                refresh_story(Path("source"), "commit", {"slug": "empty"}, {"stories/empty/story.md"})


if __name__ == "__main__":
    unittest.main()
