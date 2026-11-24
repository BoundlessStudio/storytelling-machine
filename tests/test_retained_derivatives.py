from contextlib import ExitStack
from hashlib import sha256
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from scripts import build, sync_panorama, sync_story_locations


class RetainedDerivativesTest(unittest.TestCase):
    def setUp(self):
        stack = self.enterContext(ExitStack())
        root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        self.site = root / "site"
        self.stage = root / "candidate"
        self.checkout = root / "writing"
        self.content = self.site / "content"
        self.static = self.site / "static"
        self.content.mkdir(parents=True)
        (self.stage / "content").mkdir(parents=True)
        for module in (build, sync_panorama, sync_story_locations):
            stack.enter_context(patch.object(module, "CONTENT", self.content))
            stack.enter_context(patch.object(module, "ROOT", self.site))
        stack.enter_context(patch.object(build, "STATIC", self.static))
        stack.enter_context(patch.object(sync_panorama, "ATLAS_COLS", 4))
        stack.enter_context(patch.object(sync_panorama, "ATLAS_ROWS", 3))
        stack.enter_context(patch.object(sync_panorama, "urlopen", side_effect=AssertionError("fetched an original")))

        slugs = ["new", "yard", "empty", "excluded", "pier"]
        stories = [{"slug": slug, "title": slug.title()} for slug in slugs]
        self.write(self.stage / "content/catalog.json", {"stories": stories})
        self.write(self.stage / "content/source.json", {"commit": "b" * 40,
                   "retainedStoryCommits": {slug: "a" * 40 for slug in slugs[1:]}})
        self.previous = {"covers": {}, "locations": {}}
        origin = "https://example.invalid"
        self.index = {"schemaVersion": 1, "baseUrl": origin, "sourceCommit": "a" * 40,
                      "indexUrl": origin + "/manifests/story-computing-machine-art-v1.json", "assets": []}

        def original(path, data=b"withdrawn"):
            digest = sha256(data).hexdigest()
            key = f"assets/{digest}/{Path(path).name}"
            self.index["assets"].append({"path": path, "sha256": digest, "key": key, "size": len(data),
                                        "contentType": "image/jpeg" if path.endswith(".jpg") else "image/webp",
                                        "url": origin + "/" + key})

        new_cover = "stories/new/title-image.jpg"
        original(new_cover, self.paint(self.checkout / new_cover, "red"))
        for slug in slugs[1:]:
            original(f"stories/{slug}/title-image.jpg")
            cover = f"panorama/{slug}-cover.webp" if slug == "pier" else f"story-covers/{slug}.webp"
            self.previous["covers"][slug] = cover
            self.paint(self.static / cover, "gold")
            if slug == "empty":
                self.previous["locations"][slug] = {"src": "location-fallback.webp", "source": None,
                                                    "title": "Open country", "sky": "#123456", "ground": "#654321"}
                continue
            source = f"stories/{slug}/art/landscapes/field.webp"
            original(source)
            location = "panorama/pier-land.webp" if slug == "pier" else f"story-locations/{slug}.webp"
            self.previous["locations"][slug] = {"src": location, "source": source, "title": "The Field",
                                                "width": 64, "height": 48, "sky": "#556677", "ground": "#010203"}
            self.paint(self.static / location, "green")
        study = {"src": "panorama/pier-study.webp", "source": "stories/pier/art/characters/clerk.webp",
                 "title": "The Clerk", "width": 64, "height": 48}
        original(study["source"])
        self.paint(self.static / study["src"], "white")
        self.write(self.content / "media-index.json", self.index)
        self.write(self.content / "art-exclusions.json", {"paths": [self.previous["locations"]["excluded"]["source"]]})
        self.write(self.content / "story-locations.json", self.previous)
        self.write(self.content / "panorama.json", {"stops": [{"slug": "pier", "study": study}]})

    @staticmethod
    def paint(path, colour):
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (64, 48), colour).save(path)
        return path.read_bytes()

    @staticmethod
    def write(path, value):
        path.write_text(json.dumps(value), encoding="utf-8")

    def prepare(self, pool):
        args = ["prepare", "--repository", str(self.checkout), "--output-root", str(self.stage)]
        with patch.object(sys, "argv", args + ["--pool", str(pool), "--newest", "0"]):
            sync_panorama.main()
        with patch.object(sys, "argv", args):
            sync_story_locations.main()
        content = self.stage / "content"
        return (json.loads((content / "panorama.json").read_text(encoding="utf-8")),
                json.loads((content / "story-locations.json").read_text(encoding="utf-8")))

    def test_pool_changes_reuse_existing_files_and_respect_exclusions(self):
        panorama, locations = self.prepare(pool=1)
        self.assertEqual([s["slug"] for s in panorama["stops"]], ["yard"])
        self.assertEqual(set(s for s, kind in panorama["atlas"]["tiles"] if kind == "cover"),
                         {"new", "yard", "empty", "excluded", "pier"})
        self.assertEqual(locations["covers"]["pier"], "story-covers/pier.webp")
        self.assertEqual(locations["locations"]["pier"]["src"], "story-locations/pier.webp")
        self.assertEqual(locations["locations"]["yard"]["src"], "panorama/yard-land.webp")
        for slug in ("pier", "yard"):
            for old, new in ((self.previous["covers"][slug], locations["covers"][slug]),
                             (self.previous["locations"][slug]["src"], locations["locations"][slug]["src"])):
                self.assertEqual((self.static / old).read_bytes(), (self.stage / "static" / new).read_bytes())
            self.assertEqual(locations["locations"][slug]["title"], "The Field")
            self.assertEqual(locations["locations"][slug]["sky"], "#556677")
        self.assertEqual(locations["locations"]["empty"], self.previous["locations"]["empty"])
        self.assertIsNone(locations["locations"]["excluded"]["source"])
        panorama, _ = self.prepare(pool=2)
        pier = next(s for s in panorama["stops"] if s["slug"] == "pier")
        self.assertEqual(pier["study"]["title"], "The Clerk")
        self.assertEqual((self.stage / "static" / pier["study"]["src"]).read_bytes(),
                         (self.static / "panorama/pier-study.webp").read_bytes())

    def test_missing_or_cross_story_derivative_fails_before_fetch(self):
        for relative in ("../outside.webp", "story-covers/yard.webp", "story-covers/pier.webp"):
            with self.subTest(relative=relative):
                self.previous["covers"]["pier"] = relative
                self.write(self.content / "story-locations.json", self.previous)
                with self.assertRaisesRegex(ValueError, "Missing or unsafe retained derivative"):
                    sync_panorama.preparation_assets(self.index, self.stage / "content")
