"""Illustrate a reviewed import in a private job and accept its inspected artwork."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib

from PIL import Image, ImageOps


PROJECT = Path(__file__).resolve().parents[1]
SLUG = r"[a-z0-9]+(?:-[a-z0-9]+)*"
STUDY = re.compile(rf"art/(?:characters|landscapes|interiors)/{SLUG}\.webp")
MANIFEST = "illustrations.json"
COVER = "title-image.jpg"
ROLE = Path(".codex/agents/story-title-illustrator.toml")
SKILL = Path(".agents/skills/story-illustrate/SKILL.md")
RECEIPT_VERSION = 2


def checked_path(root: Path, relative: str | Path) -> Path:
    path = root / relative
    if path.resolve() != root.resolve() / relative or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Expected an ordinary path inside {root}: {relative}")
    return path


def source_bytes(repository: Path, commit: str, path: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(repository), "show", f"{commit}:{path}"])


def image_hash(path: Path, expected: str, size: tuple[int, int] | None = None) -> str:
    if path.stat().st_size > 25 * 1024 * 1024:
        raise ValueError(f"Image exceeds the site's 25 MiB asset size limit: {path.name}")
    with Image.open(path) as image:
        if image.format != expected or (size and image.size != size):
            raise ValueError(f"Expected {expected}{' at 864 x 1536' if size else ''}: {path}")
        image.verify()
    with Image.open(path) as image:
        image.load()
    return hashlib.sha256(path.read_bytes()).hexdigest()


def review_bundle(directory: Path) -> tuple[dict, dict[str, str]]:
    report = json.loads(checked_path(directory, MANIFEST).read_text(encoding="utf-8-sig"))
    if not isinstance(report, dict) or not isinstance(report.get("review"), str) or not report["review"].strip():
        raise ValueError("Missing visual review of the cover and studies")
    result = {"review": report["review"].strip()}
    hashes = {COVER: image_hash(checked_path(directory, COVER), "JPEG", (864, 1536))}
    for category, kinds in (("characters", "characters"), ("locations", "landscapes|interiors")):
        studies = report.get(category)
        if not isinstance(studies, list):
            raise ValueError(f"List the individual {category} in {MANIFEST}")
        result[category] = []
        if not studies:
            reason = report.get(f"no_{category}")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError(f"Explain why the story has no {category} requiring a study")
            result[f"no_{category}"] = reason.strip()
        subjects = set()
        for study in studies:
            if not isinstance(study, dict):
                raise ValueError(f"Expected a named {category} study")
            subject, path = study.get("subject"), study.get("path")
            if not isinstance(subject, str) or not subject.strip() or subject.strip().casefold() in subjects:
                raise ValueError(f"Missing or duplicate {category} subject: {subject}")
            if not isinstance(path, str) or not re.fullmatch(rf"art/(?:{kinds})/{SLUG}\.webp", path) or path in hashes:
                raise ValueError(f"Invalid or duplicate {category} study path: {path}")
            digest = image_hash(checked_path(directory, path), "WEBP")
            if digest in hashes.values():
                raise ValueError(f"A different subject needs its own study: {subject}")
            hashes[path] = digest
            subjects.add(subject.strip().casefold())
            result[category].append({"subject": subject.strip(), "path": path})
    return result, hashes


def stage_inputs(job: Path, repository: Path, commit: str, slug: str, source_paths: set[str],
                 references: tuple[str, ...]) -> set[str]:
    inputs = job / "input"
    inputs.mkdir()
    prefix = f"stories/{slug}/"
    prose = next((name for name in ("story.md", "05-story.md") if prefix + name in source_paths), None)
    if not prose or prefix + "ratings.md" not in source_paths:
        raise ValueError(f"Illustration requires reviewed prose and ratings.md for {slug} at {commit}")
    for output, name in (("story.md", prose), ("ratings.md", "ratings.md")):
        (inputs / output).write_bytes(source_bytes(repository, commit, prefix + name))
    (inputs / "references").mkdir()
    hashes = set()
    for name in references:
        path = prefix + "art/references/" + name
        if path not in source_paths:
            raise ValueError(f"Approved reference is missing from the pinned revision: {name}")
        data = source_bytes(repository, commit, path)
        local = inputs / "references" / name
        local.write_bytes(data)
        with Image.open(local) as image:
            image.verify()
        hashes.add(hashlib.sha256(data).hexdigest())
    return hashes


def session_result(log: Path) -> tuple[str | None, bool]:
    """Read the CLI's session identity and a provider rejection from its event stream."""
    thread_id, model_missing = None, False
    with log.open(encoding="utf-8", errors="replace") as stream:
        for line in stream:
            try:
                event = json.loads(line.removeprefix("ERROR: "))
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            kind = event.get("type")
            if kind == "thread.started":
                value = event.get("thread_id")
                if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9-]{36}", value):
                    thread_id = value
            if kind in {"error", "turn.failed"} and "model_not_found" in line:
                model_missing = True
    return thread_id, model_missing


def account_model(executable: str, job: Path, env: dict) -> str:
    result = subprocess.run([executable, "debug", "models"], cwd=job, env=env, check=True,
                            capture_output=True, encoding="utf-8")
    visible = [m for m in json.loads(result.stdout)["models"] if m.get("visibility") == "list"]
    if not visible:
        raise RuntimeError("The signed-in Codex account listed no available models")
    return min(visible, key=lambda m: m["priority"])["slug"]


def attachment_ids(originals: int, accepted: int) -> list[str]:
    return [f"{kind}-{number:03d}" for kind, count in (("ref", originals), ("accepted", accepted))
            for number in range(1, count + 1)]


def attachment_alias(job: Path, identity: str, source: Path) -> str:
    # The CLI splits -i on commas, including commas in parent directory names.
    directory = job / "images"
    directory.mkdir(exist_ok=True)
    with Image.open(source) as image:
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError(f"Illustration requires a single still image for {identity}")
        extensions = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}
        alias = directory / (identity + extensions.get(image.format, ".png"))
        if image.format in extensions:
            shutil.copyfile(source, alias)
        else:
            ImageOps.exif_transpose(image).convert("RGBA").save(alias, "PNG")
    return alias.relative_to(job).as_posix()


def reference_measurements(path: Path) -> dict:
    """Give the illustrator facts about the displayed pixels of a private original."""
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source)
        facts = {"widthPx": image.width, "heightPx": image.height}
        rgba = image.convert("RGBA")
        colors = rgba.getcolors(8)
        if colors and all(alpha == 255 for _, (_, _, _, alpha) in colors):
            facts["flatColors"] = [
                {"rgb": f"#{red:02x}{green:02x}{blue:02x}", "pixels": count}
                for count, (red, green, blue, _) in sorted(colors, reverse=True)
            ]
        return facts


def check_input_reviews(report: dict, expected: list[str]) -> None:
    reviews = report.get("inputReviews")
    if not isinstance(reviews, list) or len(reviews) != len(expected):
        raise ValueError("The illustrator must inspect every attached image")
    for identity, entry in zip(expected, reviews):
        if not isinstance(entry, dict) or entry.get("id") != identity or entry.get("visible") is not True:
            raise ValueError(f"The illustrator could not inspect attachment {identity}")
        for key in ("observation", "use"):
            detail = entry.get(key)
            if not isinstance(detail, str) or not detail.strip():
                raise ValueError(f"Missing visual {key} for attachment {identity}")


def collect_outputs(job: Path, report: dict, session_dir: Path | None, private_inputs: list[Path]) -> None:
    """Only freshly generated outputs from this CLI session may supply new public images."""
    accepted = job / "accepted"
    used = {hashlib.sha256(path.read_bytes()).hexdigest() for path in private_inputs}

    def install(relative: str, generated: str | None) -> None:
        target = checked_path(accepted, relative)
        if target.is_file():
            if generated is not None:
                raise ValueError(f"Asked to replace existing artwork: {relative}")
            return
        if not isinstance(generated, str) or not generated or session_dir is None:
            raise ValueError(f"Missing generated image from this session for {relative}")
        source = Path(generated).expanduser()
        if not source.is_absolute():
            if source.name != generated:
                raise ValueError(f"Expected a tool-generated filename for {relative}")
            source = session_dir / source
        if source.parent != session_dir or checked_path(session_dir, source.name) != source or not source.is_file():
            raise ValueError(f"Image was not generated in this illustration session: {source}")
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest in used:
            raise ValueError(f"Duplicate image or private reference supplied for {relative}")
        used.add(digest)
        with Image.open(source) as image:
            if image.format not in {"PNG", "JPEG", "WEBP"}:
                raise ValueError(f"Unsupported generated image format: {source.name}")
            image.verify()
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            pixels = ImageOps.exif_transpose(image).convert("RGB")
            if relative == COVER:
                if pixels.width >= pixels.height:
                    raise ValueError("The generated cover must be a portrait composition")
                ImageOps.fit(pixels, (864, 1536), Image.Resampling.LANCZOS).save(target, "JPEG", quality=92)
            else:
                pixels.save(target, "WEBP", quality=90, method=6)

    install(COVER, report["cover"])
    for category, kinds in (("characters", "characters"), ("locations", "landscapes|interiors")):
        for study in report[category]:
            relative = study["path"]
            if not isinstance(relative, str) or not re.fullmatch(rf"art/(?:{kinds})/{SLUG}\.webp", relative):
                raise ValueError(f"Invalid {category} study path: {relative}")
            install(relative, study["generated"])
    (accepted / MANIFEST).write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")


def run_illustrator(job: Path, slug: str, commit: str, *, restore_paths: tuple[str, ...] = ()) -> None:
    executable = shutil.which("codex")
    if not executable:
        raise RuntimeError("Illustration requires the signed-in Codex CLI with built-in image generation")
    instructions = tomllib.loads((PROJECT / ROLE).read_text(encoding="utf-8"))["developer_instructions"]
    skill = (PROJECT / SKILL).read_text(encoding="utf-8")
    inputs, accepted = job / "input", job / "accepted"
    private_inputs = sorted((inputs / "references").iterdir())
    existing = sorted(path for path in accepted.rglob("*") if path.is_file())
    identities = attachment_ids(len(private_inputs), len(existing))
    names = [p.name for p in private_inputs] + [p.relative_to(accepted).as_posix() for p in existing]
    attachments = [{"id": identity, "name": name} for identity, name in zip(identities, names)]
    aliases = [attachment_alias(job, identity, path)
               for identity, path in zip(identities, private_inputs + existing)]
    for entry, alias in zip(attachments, aliases[:len(private_inputs)]):
        entry["measured"] = reference_measurements(job / alias)
    has_cover = (accepted / COVER).is_file()
    cover_task = (
        "This edition ALREADY HAS its accepted title-image.jpg in the attachments. "
        'Inspect it in place and return "cover": null. Do not generate a replacement, '
        "alternate, or candidate cover. Generate only genuinely missing studies. "
        "If the studies are also complete, return the review without calling image generation."
        if has_cover else
        "This edition needs a cover. Generate it last using the relevant accepted and newly "
        "generated studies as image references. Make a portrait with the title and "
        "principal subjects inside the central 9:16 area for the final library crop."
    )
    brief = f"""You are the story_title_illustrator for {slug} at reviewed revision {commit}.
Inspect retained artwork and use built-in image generation only for missing artwork. All inputs are in
this message and its image attachments. Use this role and skill for visual decisions:

{instructions}

{skill}

For this import the caller handles every file operation. Do not open files, run a
shell, delegate, or publish. Complete the image work in this session. Read the prose
and rating below as source material. Inspect the attached inputs in order:
{json.dumps(attachments, ensure_ascii=False)}

Check every attachment visually before your first image generation call. ref- IDs
identify approved private originals. accepted- IDs identify finished public art to
preserve. If any image is missing, unreadable, or visible only as a filename,
stop now and return {{"error":"attachment unavailable","id":"..."}}. Never infer its
appearance from its name or the story. Approved originals include measured display
dimensions and, for small flat palettes, exact colors and pixel counts. Use those
facts when judging shape and color. Look at the pixels to establish their arrangement
and the other visual details. For every ID return a private inputReviews
entry in the displayed order: {{"id":"...","visible":true,"observation":"describe
specific visible forms, colors, spatial relations and any legible markings or text",
"use":"describe a concrete visual decision or consistency check this informs"}}.
Return inputReviews: [] when there were no attachments. Keep private names and
observations out of the general review and public subject names.

Inventory the principal characters and distinct important places. Generate each
missing character sheet and setting painting with the built-in image generation
tool. Inspect its returned images. {cover_task}
Previously reviewed images missing from this edition must be restored at these
exact output paths: {json.dumps(restore_paths)}.
Preserve each attached accepted image unchanged. Report a conflict if one cannot be
used with this edition. Never substitute a private reference for a generated study.

Your final message must be one JSON object without Markdown. Return only successful
work, with the actual absolute tool-returned image path (or the exact generated
filename within this session) for each new image. Use null for an attached accepted
image. For an empty category add no_characters or no_locations explaining why.
Use lower-case hyphenated ASCII filenames in the logical study paths. Inspect every
generated image, and record what you saw in the review. Use this shape:
{{"inputReviews":[...],"cover":{'null' if has_cover else '"<tool output path>"'},"characters":[{{"subject":"...","path":"art/characters/name.webp","generated":"<tool output path or null>"}}],"locations":[{{"subject":"...","path":"art/interiors/place.webp","generated":"<tool output path or null>"}}],"review":"..."}}
Exterior studies belong under art/landscapes/. If generation fails, return an
error object containing the reason. Never invent an image path.

Reviewed prose:
{(inputs / 'story.md').read_text(encoding='utf-8-sig')}

Reviewed rating:
{(inputs / 'ratings.md').read_text(encoding='utf-8-sig')}
"""
    env = os.environ.copy()
    env.pop("OPENAI_API_KEY", None)
    env.pop("CODEX_API_KEY", None)
    env.update({key: str(job) for key in ("TMPDIR", "TEMP", "TMP")})
    generated_root = (Path(env.get("CODEX_HOME") or Path.home() / ".codex") / "generated_images").resolve()
    older_sessions = {p.name for p in generated_root.iterdir()} if generated_root.is_dir() else set()
    output = job / "report-output.json"
    command = [executable, "exec", "--cd", str(job), "--sandbox", "read-only", "--ephemeral",
               "--disable", "multi_agent", "--disable", "shell_tool", "--json", "-o", str(output)]
    for alias in aliases:
        command.extend(["-i", alias])
    model = env.get("STORY_ILLUSTRATOR_MODEL")
    for attempt in range(2):
        log = job / ("illustrator.log" if attempt == 0 else "illustrator-retry.log")
        args = command + (["--model", model] if model else []) + ["--", "-"]
        with log.open("wb") as stream:
            result = subprocess.run(args, cwd=job, input=brief.encode("utf-8"), env=env,
                                    stdout=stream, stderr=subprocess.STDOUT)
        thread_id, model_missing = session_result(log)
        session_dir = None
        if thread_id and thread_id not in older_sessions:
            candidate = checked_path(generated_root, thread_id)
            if candidate.is_dir():
                session_dir = candidate
        if result.returncode == 0:
            report = json.loads(output.read_text(encoding="utf-8-sig"))
            if not isinstance(report, dict) or "error" in report:
                raise ValueError(f"Incomplete illustration for {slug}; see {output}")
            check_input_reviews(report, identities)
            collect_outputs(job, report, session_dir, private_inputs)
            return
        if model or attempt or not model_missing or (session_dir and any(session_dir.iterdir())):
            raise RuntimeError(f"Codex illustration failed for {slug} (exit {result.returncode}); see {log}")
        model = account_model(executable, job, env)
        print(f"Configured model unavailable; retrying illustration with account model {model}", flush=True)


def reference_digest(references: tuple[str, ...]) -> str:
    for name in references:
        if (not name or re.search(r'[<>:"/\\|?*\x00-\x1f]', name) or name.endswith((".", " "))
                or re.match(r"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", name, re.I)):
            raise ValueError(f"Expected a single reference filename: {name}")
    if len({name.casefold() for name in references}) != len(references):
        raise ValueError("Approved reference filenames must be distinct on this filesystem")
    return hashlib.sha256(json.dumps(references).encode("utf-8")).hexdigest()


def saved_references(prior: dict, candidates: list[str]) -> tuple[str, ...]:
    positions = prior["referencePositions"]
    count = prior.get("referenceCount")
    if (type(count) is not int or not isinstance(positions, list) or len(positions) != count
            or any(type(i) is not int or not 0 <= i < len(candidates) for i in positions)
            or positions != sorted(set(positions))):
        raise ValueError("Invalid saved reference selection. Supply the original --reference arguments.")
    return tuple(candidates[i] for i in positions)


def ensure_illustrations(root: Path, repository: Path, commit: str, slug: str, source_paths: set[str],
                         *, approved_references=()) -> None:
    """Generate missing artwork while the caller holds the site's import lock."""
    if not re.fullmatch(SLUG, slug) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", commit):
        raise ValueError("Illustration requires a valid story slug and full pinned commit")
    destination = checked_path(root, Path("static/story-art") / slug)
    receipt = checked_path(root, Path("static/story-art") / slug / MANIFEST)
    historical = f"stories/{slug}/{COVER}"
    if historical in source_paths and not receipt.is_file():
        index = json.loads((root / "content/media-index.json").read_text(encoding="utf-8"))
        digest = hashlib.sha256(source_bytes(repository, commit, historical)).hexdigest()
        if any(item["path"] == historical and item["sha256"] == digest for item in index["assets"]):
            return  # This exact historical cover is already available to the site.
    references = tuple(sorted(set(approved_references)))
    reference_set = reference_digest(references)
    # Positions are stable only within this commit's directory and keep private filenames out of the receipt.
    prefix = f"stories/{slug}/art/references/"
    names = (path[len(prefix):] for path in source_paths if path.startswith(prefix))
    candidates = sorted(name for name in names if "/" not in name)
    prior_bytes = receipt.read_bytes() if receipt.is_file() else None
    restore_paths = ()
    if prior_bytes is not None:
        prior = json.loads(prior_bytes)
        prior_hashes = prior["sha256"]
        reference_count = prior.get("referenceCount")
        verified = (prior.get("schemaVersion") == RECEIPT_VERSION and type(reference_count) is int
                    and reference_count >= 0)
        missing = []
        for relative, digest in prior_hashes.items():
            if relative != COVER and not STUDY.fullmatch(relative):
                raise ValueError(f"Unexpected asset path in {receipt}: {relative}")
            path = checked_path(destination, relative)
            if not path.exists():
                missing.append(relative)
            elif hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Accepted illustration changed since review: {path}")
        if prior.get("sourceCommit") == commit:
            same_references = len(references) == reference_count and reference_set == prior.get("referenceSet")
            if verified and not missing and (not references or same_references):
                _, hashes = review_bundle(destination)
                if hashes != prior_hashes:
                    raise ValueError(f"Accepted illustration changed since review for {slug}; review the changed work")
                return
            if missing or not verified:
                if not references and "referencePositions" in prior:
                    references = saved_references(prior, candidates)
                    reference_set = reference_digest(references)
                if reference_set != prior.get("referenceSet") or (verified and len(references) != reference_count):
                    raise ValueError(f"Reviewing {slug} requires the original edition's approved --reference arguments")
            restore_paths = tuple(sorted(missing))
    scratch = checked_path(root, "tmp")
    scratch.mkdir(exist_ok=True)
    job = Path(tempfile.mkdtemp(prefix=f"illustrate-{slug}-", dir=scratch))
    print(f"Illustrating {slug} in {job}", flush=True)
    originals = stage_inputs(job, repository, commit, slug, source_paths, references)
    accepted = job / "accepted"
    accepted.mkdir()
    existing = {}
    if destination.is_dir():
        for path in destination.rglob("*"):
            relative = path.relative_to(destination).as_posix()
            if relative != COVER and not STUDY.fullmatch(relative):
                continue
            if prior_bytes is not None and relative not in prior_hashes:
                continue
            checked_path(destination, relative)
            if path.is_file():
                existing[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
                (accepted / relative).parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, accepted / relative)
    run_illustrator(job, slug, commit, restore_paths=restore_paths)
    checked_path(job, "accepted")
    report, hashes = review_bundle(accepted)
    if not set(restore_paths).issubset(hashes):
        raise ValueError(f"Illustration did not restore the edition's missing artwork for {slug}; inspect {job}")
    if any(hashes.get(path) != digest for path, digest in existing.items()):
        raise ValueError(f"Illustration would change existing accepted art for {slug}; inspect {job}")
    if originals.intersection(hashes.values()):
        raise ValueError(f"Private reference copied as public artwork for {slug}")
    # The detailed observations and raw review stay in the private job. Store public subjects and edition evidence.
    report["review"] = "The illustrator inspected this edition's complete artwork."
    for category in ("characters", "locations"):
        if not report[category]:
            report[f"no_{category}"] = f"The illustrator found no {category} that required a separate study."
    selected = set(references)
    report.update(schemaVersion=RECEIPT_VERSION, sourceCommit=commit, referenceCount=len(references),
                  referencePositions=[i for i, name in enumerate(candidates) if name in selected],
                  referenceSet=reference_set, sha256=hashes)
    # Build a clean tree from the allowlisted images. Never copy arbitrary agent outputs.
    bundle = job / "validated"
    bundle.mkdir()
    for relative in hashes:
        (bundle / relative).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(accepted / relative, bundle / relative)
    (bundle / MANIFEST).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        bundle.rename(destination)
        return
    if (receipt.read_bytes() if receipt.is_file() else None) != prior_bytes:
        raise ValueError(f"Another illustrator updated {slug}; retry the import to check the accepted edition")
    for relative, digest in hashes.items():
        path = checked_path(destination, relative)
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Existing illustration conflicts with {job}: {path}")
    for relative in hashes:
        path = destination / relative
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(bundle / relative, path)
    os.replace(bundle / MANIFEST, receipt)
