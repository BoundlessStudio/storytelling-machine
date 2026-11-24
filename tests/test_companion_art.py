"""Exercise the prose-to-publication handoff with a site-owned cover."""

from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit
from uuid import uuid4

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://legacy.example"


def save_image(path, colour, size=(64, 96)):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, colour).save(path)
    return path.read_bytes()


def run(cwd, *args, env=None, success=True):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, errors="replace")
    if (result.returncode == 0) != success:
        raise AssertionError(f"{args} failed:\n{result.stdout}\n{result.stderr}")
    return result


def install_codex_double(directory):
    """Run a stand-in for the external image generator through the real importer CLI."""
    directory.mkdir()
    test = str(Path(__file__).resolve())
    if os.name == "nt":
        (directory / "codex.cmd").write_text(f'@"{sys.executable}" -B "{test}" --fake-codex %*\n')
    else:
        shim = directory / "codex"
        shim.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -B {shlex.quote(test)} --fake-codex \"$@\"\n")
        shim.chmod(0o755)
    env = {**os.environ, "PATH": str(directory) + os.pathsep + os.environ["PATH"],
           "CODEX_HOME": str(directory / "test-codex-home"),
           "ILLUSTRATION_TEST_LOG": str(directory / "calls.jsonl")}
    if Path(shutil.which("codex", path=env["PATH"]) or "").parent != directory:
        raise AssertionError("The test Codex executable must be first on PATH")
    return env


def fake_codex():
    request = sys.stdin.read()
    title = re.search(r"^title: (?:new-story|late-story)$", request, re.MULTILINE)
    images = [Path(sys.argv[i + 1]) for i, flag in enumerate(sys.argv) if flag in ("-i", "--image")]
    references = {p.name: sha256(p.read_bytes()).hexdigest() for p in images}
    attachments = json.loads(request.split("Inspect the attached inputs in order:\n", 1)[1].splitlines()[0])
    retained = {item["name"] for item in attachments if item["id"].startswith("accepted-")}
    observations = [{"id": path.stem, "visible": "ILLUSTRATION_TEST_HIDDEN_INPUT" not in os.environ,
                     "observation": "The private square is uniformly dark.",
                     "use": "I used the square to check the clerk's coat."} for path in images]
    log = Path(os.environ["ILLUSTRATION_TEST_LOG"])
    # A successful process exit with an incomplete declared output must still fail the import.
    incomplete = "ILLUSTRATION_TEST_PARTIAL" in os.environ and log.exists()
    thread_id = str(uuid4())
    print(json.dumps({"type": "thread.started", "thread_id": thread_id}), flush=True)
    generated = Path(os.environ["CODEX_HOME"]) / "generated_images" / thread_id
    cover = "title-image.jpg"
    room = "art/interiors/reading-room.webp"
    clerk = "art/characters/clerk.webp"
    outputs = {}
    for name, colour in ((cover, "blue"), (room, "gold"), (clerk, "white")):
        if name in retained:
            outputs[name] = None
        else:
            path = generated / ("ig_" + uuid4().hex + ".png")
            if name != clerk or not incomplete:
                save_image(path, colour, (864, 1536) if name == cover else (64, 96))
            outputs[name] = str(path)
    with log.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"story": title.group(), "rating": "Teen" if "Teen" in request else "",
                                 "references": references, "request": request,
                                 "requestedImages": [name for name, path in outputs.items() if path],
                                 "sandbox": sys.argv[sys.argv.index("--sandbox") + 1]}) + "\n")
    report = Path(sys.argv[sys.argv.index("-o") + 1])
    report.write_text(json.dumps({
        "cover": outputs[cover], "characters": [{"subject": "Clerk", "path": clerk, "generated": outputs[clerk]}],
        "locations": [{"subject": "Reading room", "path": room, "generated": outputs[room]}],
        "inputReviews": observations, "review": "Fixture reviewed all declared assets.",
    }))


class CompanionArtTests(unittest.TestCase):
    def test_import_generates_images_prepares_publication_and_resumes_after_incomplete_art(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary) / "site"
            source = Path(temporary) / "writing"
            source.mkdir()
            content = site / "content"
            static = site / "static"
            content.mkdir(parents=True)
            (static / "vendor").mkdir(parents=True)
            shutil.copytree(ROOT / "scripts", site / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
            for directory in (".agents", ".codex"):
                shutil.copytree(ROOT / directory, site / directory)
            for path in (ROOT / "static").iterdir():
                if path.is_file():
                    shutil.copy2(path, static / path.name)

            run(source, "git", "init", "-q")
            slugs = ["new-story", "late-story", "reillustrated", "historical"]
            legacy = {}
            for slug in slugs:
                package = source / "stories" / slug
                package.mkdir(parents=True)
                (package / ("05-story.md" if slug == "historical" else "story.md")).write_text(
                    f"---\ntitle: {slug}\ncreated: 2026-03-15\ncanon: false\n---\nReviewed {slug} prose.\n")
                if slug == "historical":
                    (package / "00-prompt.md").write_text("# Prompt\n\n[WP] The rain has an opinion.\n")
                    (package / "story.json").write_text('{"canon": true}')
                elif slug == "reillustrated":
                    (package / "prompt.md").write_text("# Prompt\n\nPrivate editorial instructions.\n")
                (package / "ratings.md").write_text("# Rating\n\n- **Rating:** Teen\n")
                if slug in ("reillustrated", "historical"):
                    legacy[slug] = save_image(package / "title-image.jpg", "red")
            source_ref = source / "stories/new-story/art/references/private, approved.png"
            approved_bytes = save_image(source_ref, "black")
            save_image(source_ref.with_name("unapproved.png"), "yellow")
            run(source, "git", "add", "stories")
            run(source, "git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
                "-c", "commit.gpgsign=false", "-c", "core.hooksPath=.git/no-hooks", "commit", "-qm", "Prose")
            save_image(source_ref, "pink")  # A working-copy edit after the reviewed Git revision.
            save_image(source / "stories/historical/art/interiors/private-draft.png", "magenta")

            assets = []
            for slug, data in legacy.items():
                digest = sha256(data).hexdigest()
                key = f"assets/{digest}/title-image.jpg"
                assets.append({"path": f"stories/{slug}/title-image.jpg", "sha256": digest,
                               "size": len(data), "key": key, "contentType": "image/jpeg",
                               "url": f"{ORIGIN}/{key}"})
            index = {"schemaVersion": 1, "sourceCommit": "1" * 40, "assets": assets, "baseUrl": ORIGIN,
                     "indexUrl": f"{ORIGIN}/manifests/story-computing-machine-art-v1.json"}
            inputs = {"media-index": index, "catalog": {"stories": []}, "rating-overrides": {},
                      "art-exclusions": {"paths": []}}
            for group in ("characters", "landscapes", "interiors"):
                inputs[group] = {"stories": []}
            for filename, value in inputs.items():
                (content / f"{filename}.json").write_text(json.dumps(value), encoding="utf-8")

            originals = static / "story-art"
            revised = save_image(originals / "reillustrated/title-image.jpg", "green")
            save_image(originals / "reillustrated/art/references/private.png", "black")
            save_image(originals / "reillustrated/drafts/rejected.jpg", "black")
            save_image(originals / "unpublished/title-image.jpg", "black")
            python = (sys.executable, "-B", "-m")
            import_command = [sys.executable, "-B", "scripts/sync_ratings.py", "--repository", str(source),
                              "--revision", "HEAD"]
            importer = [*import_command, "--reference", "new-story/private, approved.png"]
            for slug in slugs:
                importer.extend(("--add-story", slug))
            env = install_codex_double(site / "bin")
            before = {p.name: p.read_bytes() for p in content.iterdir()}
            self.assertFalse((originals / "new-story").exists())
            self.assertFalse((originals / "late-story").exists())
            hidden = env | {"ILLUSTRATION_TEST_HIDDEN_INPUT": "1",
                            "ILLUSTRATION_TEST_LOG": str(site / "bin" / "hidden.jsonl")}
            run(site, *importer, env=hidden, success=False)
            self.assertFalse((originals / "new-story").exists())
            self.assertFalse((originals / "late-story").exists())
            self.assertEqual(before, {p.name: p.read_bytes() for p in content.iterdir()})
            run(site, *importer, env=env | {"ILLUSTRATION_TEST_PARTIAL": "1"}, success=False)
            self.assertEqual(before, {p.name: p.read_bytes() for p in content.iterdir()})
            log = Path(env["ILLUSTRATION_TEST_LOG"])
            first_attempt = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(len(first_attempt), 2)

            run(site, *importer, env=env)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(len(calls), 3)
            self.assertEqual(calls[-1]["story"], first_attempt[-1]["story"])
            for call in calls:
                self.assertIn("Teen", call["rating"])
                self.assertIn("story_title_illustrator", call["request"])
                self.assertEqual(call["sandbox"], "read-only")
                if "title: new-story" in call["story"]:
                    self.assertEqual(call["references"], {"ref-001.png": sha256(approved_bytes).hexdigest()})
                else:
                    self.assertIn("title: late-story", call["story"])
                    self.assertEqual(call["references"], {})
            catalog = json.loads((content / "catalog.json").read_text(encoding="utf-8"))
            self.assertTrue(next(story["canon"] for story in catalog["stories"] if story["slug"] == "historical"))
            self.assertEqual({story["slug"]: story["prompt"] for story in catalog["stories"]},
                             {"new-story": "", "late-story": "", "reillustrated": "",
                              "historical": "The rain has an opinion."})
            covers = json.loads((content / "covers.json").read_text())
            new = (originals / "new-story/title-image.jpg").read_bytes()
            receipt = json.loads((originals / "new-story/illustrations.json").read_text())
            self.assertEqual(receipt["referenceCount"], 1)
            self.assertNotIn("inputReviews", receipt)
            self.assertNotIn("private, approved", json.dumps(receipt))
            late = (originals / "late-story/title-image.jpg").read_bytes()
            room = (originals / "new-story/art/interiors/reading-room.webp").read_bytes()
            for slug, data in zip(slugs, [new, late, revised, legacy["historical"]]):
                self.assertEqual(covers[f"covers/{slug}.jpg"], sha256(data).hexdigest())

            output = site / "_site"
            base = "/library-preview/"
            build = [*python, "scripts.build", "--offline", "--base-path", base,
                     "--site-url", "https://site.example", "--output", str(output)]
            run(site, *build)

            def published_files():
                return {path.relative_to(site): sha256(path.read_bytes()).hexdigest()
                        for directory in (content, static, output) for path in directory.rglob("*") if path.is_file()}

            first_publication = published_files()
            illustrator_log = log.read_bytes()
            run(site, *importer, env=env)
            run(site, *build)
            self.assertEqual(log.read_bytes(), illustrator_log)
            self.assertEqual(published_files(), first_publication)

            retry = [*import_command, "--add-story", "new-story"]
            run(site, *retry, "--include-prompt", env=env)
            self.assertEqual(log.read_bytes(), illustrator_log)
            self.assertEqual(published_files(), first_publication)
            missing = "art/characters/clerk.webp"
            (originals / "new-story" / missing).unlink()
            refused = run(site, *retry, env=env, success=False)
            self.assertIn("--reference", refused.stderr)
            self.assertEqual(log.read_bytes(), illustrator_log)
            run(site, *retry, "--reference", "new-story/private, approved.png", env=env)
            repaired = [json.loads(line) for line in log.read_text().splitlines()[len(calls):]]
            self.assertEqual([call["requestedImages"] for call in repaired], [[missing]])
            private = {name: digest for name, digest in repaired[0]["references"].items() if name.startswith("ref-")}
            self.assertEqual(private, {"ref-001.png": sha256(approved_bytes).hexdigest()})
            self.assertEqual(published_files(), first_publication)

            gallery = json.loads((output / "art.json").read_text(encoding="utf-8"))
            urls = {item["id"]: item["full"] for item in gallery}
            for name, data in (("new-story/title-image.jpg", new), ("reillustrated/title-image.jpg", revised),
                               ("new-story/art/interiors/reading-room.webp", room)):
                url = urls[f"stories/{name}"]
                self.assertTrue(url.startswith(base + "story-art/"), url)
                self.assertEqual((output / urlsplit(url).path.removeprefix(base)).read_bytes(), data)
            self.assertEqual(urls["stories/historical/title-image.jpg"], assets[-1]["url"])
            self.assertEqual(len(gallery), 8)
            exposed = sorted(path.relative_to(output / "story-art").as_posix()
                             for path in (output / "story-art").rglob("*") if path.is_file())
            expected = ["reillustrated/title-image.jpg"]
            for slug in ("new-story", "late-story"):
                expected.extend(f"{slug}/{name}" for name in ("title-image.jpg", "art/characters/clerk.webp",
                                                              "art/interiors/reading-room.webp"))
            self.assertEqual(exposed, sorted(expected))
            reader = (output / "stories/new-story/index.html").read_text(encoding="utf-8")
            self.assertIn("Reviewed new-story prose.", reader)
            self.assertIn("Teen", reader)
            self.assertNotIn("<h2>Writing prompt</h2>", reader)
            library = (output / "library/index.html").read_text(encoding="utf-8")
            self.assertIn("Reviewed reillustrated prose.", library)
            self.assertIn("The rain has an opinion.", library)
            for path in output.rglob("*"):
                if path.suffix in {".json", ".html"}:
                    self.assertNotIn("Private editorial instructions", path.read_text(encoding="utf-8"), str(path))
            self.assertIn('property="og:image" content="https://site.example' +
                          urls["stories/new-story/title-image.jpg"] + '"', reader)

            atlas = json.loads((content / "panorama.json").read_text())["atlas"]
            self.assertEqual({slug for slug, kind in atlas["tiles"] if kind == "cover"}, set(slugs))
            locations = json.loads((content / "story-locations.json").read_text())
            self.assertIsNone(locations["locations"]["historical"]["source"])
            self.assertEqual(locations["locations"]["new-story"]["source"],
                             "stories/new-story/art/interiors/reading-room.webp")
            with Image.open(output / locations["covers"]["new-story"]) as cover:
                r, g, b = cover.convert("RGB").getpixel((5, 5))
                self.assertGreater(b, max(r, g) + 100)

            package = source / "stories/new-story"
            with (package / "story.md").open("a", encoding="utf-8") as prose:
                prose.write("\nA revised ending.\n")
            (package / "prompt.md").write_text("# Prompt\n\nPrivate editorial request.\n", encoding="utf-8")
            run(source, "git", "add", "stories/new-story/story.md", "stories/new-story/prompt.md")
            run(source, "git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
                "-c", "commit.gpgsign=false", "-c", "core.hooksPath=.git/no-hooks", "commit", "-qm", "Revise prose")
            run(site, *retry, "--include-prompt", "--reference", "new-story/private, approved.png", env=env)
            updated = json.loads((content / "catalog.json").read_text(encoding="utf-8"))["stories"]
            self.assertEqual([s["slug"] for s in updated], [s["slug"] for s in catalog["stories"]])
            story = next(s for s in updated if s["slug"] == "new-story")
            self.assertIn("A revised ending.", story["body"])
            self.assertEqual(story["prompt"], "")
            revision_calls = [json.loads(line) for line in log.read_text().splitlines()[len(calls) + len(repaired):]]
            self.assertEqual([call["requestedImages"] for call in revision_calls], [[]])
            self.assertEqual(revision_calls[0]["references"]["ref-001.png"], sha256(approved_bytes).hexdigest())


if __name__ == "__main__" and sys.argv[1:2] == ["--fake-codex"]:
    fake_codex()
