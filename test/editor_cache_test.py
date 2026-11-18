import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


REPOSITORY = Path(__file__).resolve().parents[1]


@unittest.skipUnless(sys.platform.startswith("linux"), "The test editor uses the Linux runner")
class EditorCacheTest(unittest.TestCase):
    def test_cold_repair_offline_reuse_and_rejected_download(self):
        playground = os.environ.get("ESKA_TEST_ROOT", REPOSITORY.parent / "eska-playground")
        with tempfile.TemporaryDirectory(prefix="explorer-editor-cache-", dir=playground) as directory:
            root = Path(directory)
            installer = root / "install-editor.sh"
            shutil.copyfile(REPOSITORY / "scripts/install-editor.sh", installer)
            payload = root / "code"
            payload.write_text("pinned editor")
            upstream = root / "upstream.tar.gz"
            with tarfile.open(upstream, "w:gz") as package:
                package.add(payload, arcname="VSCode-linux-x64/bin/code")
            pinned = upstream.read_bytes()
            (root / "test-editor.sha256").write_text(hashlib.sha256(pinned).hexdigest() + "\n")

            # Replace the two runner services while exercising the real checksum and tar tools.
            (root / "curl").write_text('#!/bin/bash\ncp -- "$UPSTREAM" "${!#}"\n')
            (root / "sudo").write_text("#!/bin/sh\nexit 0\n")
            for command in ("curl", "sudo"):
                (root / command).chmod(0o755)
            env = {
                **os.environ,
                "PATH": f"{root}{os.pathsep}{os.environ['PATH']}",
                "RUNNER_TEMP": str(root),
                "GITHUB_ENV": str(root / "env"),
                "UPSTREAM": str(upstream),
            }

            def install():
                return subprocess.run(["bash", str(installer)], env=env, capture_output=True, text=True)

            editor = root / "eska-test-editor"
            archive = editor / "editor.tar.gz"
            installed = editor / "VSCode-linux-x64/bin/code"
            self.assertEqual(install().returncode, 0)
            self.assertEqual(archive.read_bytes(), pinned)

            # A damaged cache entry may point outside the runner's editor directory.
            sentinel = root / "unrelated-file"
            sentinel.write_bytes(b"unchanged")
            archive.unlink()
            archive.symlink_to(sentinel)
            self.assertEqual(install().returncode, 0)
            self.assertFalse(archive.is_symlink())
            self.assertEqual(sentinel.read_bytes(), b"unchanged")
            self.assertEqual(archive.read_bytes(), pinned)

            upstream.unlink()
            installed.unlink()
            self.assertEqual(install().returncode, 0)
            self.assertEqual(installed.read_text(), "pinned editor")

            installed.unlink()
            archive.write_bytes(b"damaged cache")
            payload.write_text("different editor")
            with tarfile.open(upstream, "w:gz") as package:
                package.add(payload, arcname="VSCode-linux-x64/bin/code")
            rejected = install()
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("checksum mismatch", rejected.stderr)
            self.assertFalse(installed.exists())
            self.assertEqual(archive.read_bytes(), b"damaged cache")
