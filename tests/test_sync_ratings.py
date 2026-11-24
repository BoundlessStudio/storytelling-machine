from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.import_snapshot import install_snapshot
from scripts.sync_ratings import refresh_story, sync, writing_prompt


class SourceSyncTests(unittest.TestCase):
    def test_legacy_writing_prompts_keep_their_published_text(self) -> None:
        for prompt in ('[WP] A familiar finds his witch.', '> [WP] “A familiar finds his witch.”'):
            with self.subTest(prompt=prompt):
                self.assertEqual(writing_prompt(f"# Prompt\n\n{prompt}\n", "familiar"),
                                 "A familiar finds his witch.")

    def test_request_sections_preserve_paragraphs_and_exclude_package_notes(self) -> None:
        prompt = "A witch finds her familiar.\n\nHe has one final assignment."
        for heading in ("Prompt", "Request", "User request", "Original request"):
            for section_level in ("#", "##"):
                with self.subTest(heading=heading, section_level=section_level):
                    source = (f"# {heading}\n\n{prompt}\n\n{section_level} Supplied reference\n\n"
                              f"Image #1.\n\n{section_level} Later user direction\n\n[WP] Revise the art.\n")
                    self.assertEqual(writing_prompt(source, "familiar"), prompt)

    def test_nested_request_excludes_preamble_and_later_directions(self) -> None:
        prompt = "Six cybernetic sorcerers appear above the capital.\n\nThey are Administrators."
        source = ("Distinguish instructions from the user's request.\n\n"
                  f"## My request:\n{prompt}\n\n## Supplied reference images\nImage #1.\n\n"
                  "## Later user direction\n[WP] Revise the cover.\n")
        for heading in ("# Original request\n\n", ""):
            with self.subTest(heading=heading):
                self.assertEqual(writing_prompt(heading + source, "the-administrators"), prompt)

    def test_unheaded_request_stops_before_reference_inventory(self) -> None:
        prompt = "Three agents infiltrate Fashion Week.\n\nThey have twelve minutes."
        source = (f"{prompt}\n\n## Supplied reference images\n\n- Runway.png\n\n"
                  "## Later user direction\n\n[WP] Revise the cover.\n")
        self.assertEqual(writing_prompt(source, "fashion-week"), prompt)

    def test_only_the_opening_request_can_supply_a_tag(self) -> None:
        for source in ("# Content notes\n\n[WP] Private note.",
                       "Unrecognized preamble.\n\n## Later direction\n\n[WP] Private note.",
                       "Unrecognized preamble.\n\n[WP] Private note."):
            with self.subTest(source=source):
                self.assertEqual(writing_prompt(source, "familiar", tagged_only=True), "")
                with self.assertRaisesRegex(ValueError, "Missing writing prompt for familiar"):
                    writing_prompt(source, "familiar")

    def test_tagged_openings_and_historical_prompt_contracts(self) -> None:
        contract = "# Prompt contract\n\n> Status: reviewed.\n\n## Verbatim writing prompt\n\n"
        for line, auto_prompt in (("> [WP] An old request.", "An old request."),
                                  (r"> \[WP\] An old request.", ""),
                                  ("> **[WP] An old request.**", "")):
            for opening in ("", contract):
                with self.subTest(line=line, opening=opening):
                    source = f"{opening}{line}\n\n## Later direction\n\n[WP] Private note."
                    self.assertEqual(writing_prompt(source, "familiar", tagged_only=True), auto_prompt)
                    self.assertEqual(writing_prompt(source, "familiar"), "An old request.")

    def test_prompt_tags_and_dialogue_quotes_import_without_losing_text(self) -> None:
        cases = {
            '[SP] The woods are scary at night...': 'The woods are scary at night...',
            'WP] “We can handle this like civilized folk.”': 'We can handle this like civilized folk.',
            '[WP] "Dude, are you hurt?" you ask.': '"Dude, are you hurt?" you ask.',
            '[WP] Say the words “Not today.”': 'Say the words “Not today.”',
            '[WP] You say, "We carved sentience into a grain of sand."':
                'You say, "We carved sentience into a grain of sand."',
            '[WP] "Hey, what is all that weird stuff in your fridge?" "Standing theory is that it opens up to and gets stocked from alternate realities."':
                '"Hey, what is all that weird stuff in your fridge?" "Standing theory is that it opens up to and gets stocked from alternate realities."',
            '[WP] “I need a new body.” “Is there some problem or defect with your body?”':
                '“I need a new body.” “Is there some problem or defect with your body?”',
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(writing_prompt(f"# Prompt\n\n{source}\n", "familiar"), expected)

    def test_missing_or_empty_request_sections_are_rejected(self) -> None:
        for source in ("", "# Prompt\n\n## Supplied reference\nImage #1.\n",
                       "# Content notes\n\nNo prompt supplied.\n"):
            with self.subTest(source=source):
                with self.assertRaisesRegex(ValueError, "Missing writing prompt for familiar"):
                    writing_prompt(source, "familiar")

    def test_explicit_import_rejects_invalid_or_repeated_flags(self) -> None:
        cases = (
            (["Bad Slug"], [], "Invalid --add-story slug"),
            (["current", "current"], [], "Duplicate --add-story slug"),
            (["current"], ["current/ref.png", "current/ref.png"], "Duplicate --reference filename"),
            (["current"], ["other/ref.png"], "Expected --reference SLUG/FILENAME"),
            (["current"], ["current/missing.png"], "Approved reference is missing"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "content").mkdir()
            catalog = root / "content/catalog.json"
            published = '{"stories":[{"slug":"current"}]}'
            catalog.write_text(published, encoding="utf-8")
            for slugs, references, message in cases:
                with self.subTest(slugs=slugs, references=references):
                    with (
                        patch("scripts.sync_ratings.ROOT", root),
                        patch("scripts.sync_ratings.subprocess.check_output",
                              side_effect=["a" * 40, "stories/current/art/references/ref.png\0"]),
                        self.assertRaisesRegex(ValueError, message),
                    ):
                        sync(Path("source"), "HEAD", slugs, references=references)
                    self.assertEqual(catalog.read_text(encoding="utf-8"), published)

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
                return "\0".join(files) + "\0"
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


class PublishedImportTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.content = self.root / "content"
        self.content.mkdir()
        self.published = {
            "slug": "archived", "title": "Archived", "body": "# Archived\n\nPublished prose.",
            "created": "2025-01-15", "createdAt": "2025-01-15T15:00:00Z", "edited": "2025-04-08",
            "rating": "Mature", "canon": True, "status": "reviewed", "prompt": "An old request.",
            "cover": "covers/archived.jpg",
        }
        self.digest = sha256(b"published cover").hexdigest()
        self.indexed_cover = {"path": "stories/archived/title-image.jpg", "sha256": self.digest}
        self.write("catalog", {"stories": [self.published]})
        self.write("source", {"commit": "a" * 40})
        self.write("covers", {"covers/archived.jpg": self.digest})
        self.write("media-index", {"assets": [self.indexed_cover]})
        self.write("art-exclusions", {"paths": []})
        self.write("rating-overrides", {})
        self.files = {
            "stories/current/story.md": b"---\ntitle: Current\ncreated: 2026-01-15\n---\nCurrent prose.\n",
            "stories/current/ratings.md": b"# Rating\n\nTeen\n",
            "stories/current/title-image.jpg": b"current cover",
        }
        self.enterContext(patch("scripts.sync_ratings.ROOT", self.root))
        self.git_commands = self.enterContext(patch("scripts.sync_ratings.subprocess.check_output", side_effect=self.git))
        self.illustrate = self.enterContext(patch("scripts.sync_ratings.ensure_illustrations"))
        self.enterContext(patch("scripts.sync_ratings.install_snapshot", side_effect=self.install))

    def write(self, name, document):
        (self.content / f"{name}.json").write_text(json.dumps(document), encoding="utf-8")

    def read(self, name):
        return json.loads((self.content / f"{name}.json").read_text(encoding="utf-8"))

    def git(self, args, **kwargs):
        command = args[3]
        if command == "rev-parse":
            return args[4].removesuffix("^{commit}") + "\n"
        if command == "ls-tree":
            return "\0".join(self.files) + "\0"
        if command == "show":
            return self.files[args[4].split(":", 1)[1]]
        if command == "log":
            return "2026-01-15\n"
        self.fail(f"Unexpected git command: {args}")

    def install(self, root, repository, documents, *, prepare_art):
        install_snapshot(root, repository, documents, prepare_art=False)

    def test_first_current_import_reads_the_original_request_only_on_opt_in(self) -> None:
        for name in ("prompt.md", "00-prompt.md"):
            path = f"stories/current/{name}"
            self.files[path] = b"# Prompt\n\n[WP] Opening request.\n\n## Later direction\n\n[WP] Private note.\n"
            for opt_in, expected in ((False, ""), (True, "Opening request.")):
                with self.subTest(name=name, opt_in=opt_in):
                    self.write("catalog", {"stories": [self.published]})
                    self.git_commands.reset_mock()
                    commit = "b" * 40
                    sync(Path("source"), commit, ["current"], include_prompt=opt_in)
                    story = self.read("catalog")["stories"][0]
                    self.assertEqual(story["prompt"], expected)
                    reads = [call.args[0][-1] for call in self.git_commands.call_args_list if call.args[0][3] == "show"]
                    self.assertEqual(reads.count(f"{commit}:{path}"), int(opt_in))
            del self.files[path]

    def test_explicit_import_retains_edition_until_its_source_returns(self) -> None:
        for revision in ("b" * 40, "c" * 40):
            sync(Path("source"), revision, ["current"])
            stories = self.read("catalog")["stories"]
            self.assertEqual([story["slug"] for story in stories], ["current", "archived"])
            self.assertEqual(stories[1], self.published)
            self.assertEqual(self.read("covers")["covers/archived.jpg"], self.digest)
            for document in ("source", "ratings-source"):
                manifest = self.read(document)
                self.assertEqual(manifest["commit"], revision)
                self.assertEqual(manifest["retainedStoryCommits"], {"archived": "a" * 40})
            self.assertEqual(self.read("ratings-source")["counts"], {"Teen": 1, "Mature": 1})
            self.assertEqual(self.illustrate.call_args.args[3], "current")

        self.files.update({
            "stories/archived/05-story.md": b"---\ntitle: Returned\n---\nRevised upstream prose.\n",
            "stories/archived/ratings.md": b"# Rating\n\nGeneral\n",
            "stories/archived/title-image.jpg": b"returned cover",
        })
        sync(Path("source"), "d" * 40, ["current"])
        restored = self.read("catalog")["stories"][1]
        self.assertEqual(restored["body"], "# Returned\n\nRevised upstream prose.")
        self.assertEqual(restored["rating"], "General")
        self.assertEqual(self.read("covers")["covers/archived.jpg"], sha256(b"returned cover").hexdigest())
        for document in ("source", "ratings-source"):
            self.assertNotIn("retainedStoryCommits", self.read(document))

    def test_site_owned_cover_is_verified_before_indexed_art(self) -> None:
        cover = self.root / "static/story-art/archived/title-image.jpg"
        cover.parent.mkdir(parents=True)
        cover.write_bytes(b"published cover")
        (self.content / "media-index.json").unlink()
        sync(Path("source"), "b" * 40, ["current"])
        self.assertEqual(self.read("covers")["covers/archived.jpg"], self.digest)
        self.write("media-index", {"assets": [self.indexed_cover]})
        cover.write_bytes(b"changed local cover")
        with self.assertRaisesRegex(ValueError, "Cannot verify approved cover digest for archived"):
            sync(Path("source"), "c" * 40, ["current"])
        self.assertEqual(self.read("source")["commit"], "b" * 40)

    def test_archived_edition_survives_an_index_refresh_and_rejects_a_damaged_texture(self) -> None:
        relative = "panorama/archived-cover.webp"
        texture = self.root / "static" / relative
        texture.parent.mkdir(parents=True)
        texture.write_bytes(b"published derivative")
        self.write("story-locations", {"covers": {"archived": relative}})
        self.write("art-exclusions", {"paths": [], "archivedEditions": {"archived": {
            "withdrawnOriginals": {"title-image.jpg": self.digest},
            "preparedCoverSha256": sha256(texture.read_bytes()).hexdigest()}}})
        self.write("media-index", {"assets": []})
        sync(Path("source"), "b" * 40, ["current"])
        self.assertEqual(self.read("covers")["covers/archived.jpg"], self.digest)
        self.assertEqual(self.read("catalog")["stories"][1], self.published)
        texture.write_bytes(b"changed derivative")
        with self.assertRaisesRegex(ValueError, "Cannot verify archived reader cover"):
            sync(Path("source"), "c" * 40, ["current"])
        self.assertEqual(self.read("source")["commit"], "b" * 40)

    def test_missing_selected_partial_and_bulk_packages_remain_errors(self) -> None:
        for selected, missing in (([], "archived"), (["archived"], "archived"), (["unknown"], "unknown")):
            with self.subTest(selected=selected), self.assertRaisesRegex(ValueError, f"Missing source prose for {missing}"):
                sync(Path("source"), "b" * 40, selected)
        self.files["stories/archived/ratings.md"] = b"# Rating\n\nTeen\n"
        with self.assertRaisesRegex(ValueError, "Missing source prose for archived"):
            sync(Path("source"), "b" * 40, ["current"])
        self.assertEqual(self.read("catalog"), {"stories": [self.published]})
        self.assertEqual(self.read("source"), {"commit": "a" * 40})
        self.illustrate.assert_not_called()

    def test_retention_requires_approved_digest_and_matching_edition_cover(self) -> None:
        for covers, assets, reason in (
            ({}, [self.indexed_cover], "Missing or invalid"),
            ({"covers/archived.jpg": "bad"}, [self.indexed_cover], "Missing or invalid"),
            ({"covers/archived.jpg": self.digest}, [], "Cannot verify"),
            ({"covers/archived.jpg": self.digest}, [dict(self.indexed_cover, sha256="f" * 64)], "Cannot verify"),
            ({"covers/archived.jpg": self.digest}, [dict(self.indexed_cover, path="stories/other/title-image.jpg")],
             "Cannot verify"),
        ):
            with self.subTest(covers=covers, assets=assets):
                self.write("covers", covers)
                self.write("media-index", {"assets": assets})
                with self.assertRaisesRegex(ValueError, f"{reason} approved cover digest for archived"):
                    sync(Path("source"), "b" * 40, ["current"])
                self.assertEqual(self.read("catalog"), {"stories": [self.published]})
                self.illustrate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
