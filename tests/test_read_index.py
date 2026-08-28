#!/usr/bin/env python3
"""Regression tests for the no-follow, nonblocking srd.json reader."""

from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "read-index.py"
PYTHON = "/usr/bin/python3"


def load_reader():
    spec = importlib.util.spec_from_file_location("read_index", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


reader = load_reader()


def run_reader(path: str, max_bytes: int = 64, timeout: float = 2.0) -> subprocess.CompletedProcess:
    return subprocess.run(
        [PYTHON, "-I", "-B", "--", str(SCRIPT), path, str(max_bytes)],
        capture_output=True,
        timeout=timeout,
    )


class ReadIndexTests(unittest.TestCase):
    def test_open_flags_require_nofollow_and_nonblock(self):
        flags = reader._open_flags()
        self.assertTrue(flags & os.O_NOFOLLOW)
        self.assertTrue(flags & os.O_NONBLOCK)

    def test_reads_regular_file_bytes_from_same_descriptor(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "srd.json"
            payload = b'{"entries":[]}'
            path.write_bytes(payload)
            proc = run_reader(str(path), max_bytes=64)
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, payload)

    def test_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "real.json"
            link = Path(tmp) / "srd.json"
            target.write_bytes(b'{"entries":[]}')
            link.symlink_to(target)
            proc = run_reader(str(link), max_bytes=64)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, b"")

    def test_rejects_fifo_without_blocking(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "srd.json"
            os.mkfifo(path)
            self.assertTrue(stat.S_ISFIFO(path.stat().st_mode))
            started = time.monotonic()
            proc = run_reader(str(path), max_bytes=64, timeout=2.0)
            elapsed = time.monotonic() - started
            self.assertLess(elapsed, 1.0)
            self.assertNotEqual(proc.returncode, 0)
            self.assertEqual(proc.stdout, b"")

    def test_rejects_oversized_regular_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "srd.json"
            path.write_bytes(b"x" * 65)
            proc = run_reader(str(path), max_bytes=64)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, b"")

    def test_rejects_relative_path(self):
        proc = run_reader("data/srd.json", max_bytes=64)
        self.assertNotEqual(proc.returncode, 0)

    def test_reads_checked_in_snapshot(self):
        path = ROOT / "data" / "srd.json"
        proc = run_reader(str(path), max_bytes=4 * 1024 * 1024)
        self.assertEqual(proc.returncode, 0)
        self.assertTrue(proc.stdout.startswith(b"{"))
        self.assertLessEqual(len(proc.stdout), 4 * 1024 * 1024)
        self.assertIn(b'"entries"', proc.stdout)


if __name__ == "__main__":
    unittest.main()
