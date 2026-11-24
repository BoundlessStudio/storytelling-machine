from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.import_snapshot import install_snapshot


class SnapshotInterruptionTests(unittest.TestCase):
    def test_interrupt_after_either_rename_restores_prior_snapshot(self):
        for interrupt_after in ("save", "install"):
            with self.subTest(interrupt_after=interrupt_after), tempfile.TemporaryDirectory() as scratch:
                root = Path(scratch)
                (root / "tmp").mkdir()
                content = root / "content"
                content.mkdir()
                catalog = content / "catalog.json"
                catalog.write_text("old catalog")
                covers = content / "covers.json"
                covers.write_text("old covers")
                documents = {"covers.json": "new covers", "extra.json": "new document", "catalog.json": "new catalog"}
                replace = Path.replace
                fired = False

                def interrupted(source, destination):
                    nonlocal fired
                    result = replace(source, destination)
                    selected = source == catalog if interrupt_after == "save" else destination == catalog
                    if selected and not fired:
                        fired = True
                        raise KeyboardInterrupt()
                    return result

                with patch.object(Path, "replace", interrupted), self.assertRaises(KeyboardInterrupt):
                    install_snapshot(root, root, documents, prepare_art=False)
                self.assertEqual(catalog.read_text(), "old catalog")
                self.assertEqual(covers.read_text(), "old covers")
                self.assertFalse((content / "extra.json").exists())
                self.assertEqual(list((root / "tmp").iterdir()), [])
                install_snapshot(root, root, documents, prepare_art=False)
                self.assertEqual(catalog.read_text(), "new catalog")

    def test_failed_restoration_retains_original_and_reports_recovery_directory(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / "tmp").mkdir()
            content = root / "content"
            content.mkdir()
            covers, catalog = content / "covers.json", content / "catalog.json"
            covers.write_text("old covers")
            catalog.write_text("old catalog")
            replace = Path.replace

            def fails_on_catalog(source, destination):
                if destination == catalog:
                    raise PermissionError("catalog busy")
                return replace(source, destination)

            with patch.object(Path, "replace", fails_on_catalog), self.assertRaises(RuntimeError) as problem:
                install_snapshot(root, root, {"covers.json": "new covers", "catalog.json": "new catalog"},
                                 prepare_art=False)
            stage, = (root / "tmp").glob("library-import-*")
            self.assertIn(str(stage), str(problem.exception))
            self.assertEqual((stage / "previous/content/catalog.json").read_text(), "old catalog")
            self.assertEqual((stage / "content/catalog.json").read_text(), "new catalog")
            self.assertEqual(covers.read_text(), "old covers")
