#!/usr/bin/env python3
"""Read and write the small, user-writable D&D pins state without unbounded reads."""

from __future__ import annotations

import os
import secrets
import signal
import stat
import sys

MAX_MAX_BYTES = 64 * 1024
TIMEOUT_SEC = 2


def _die(_signum=None, _frame=None) -> None:
    os._exit(1)


def _safe_path(path: str) -> bool:
    return bool(path and path[0] == "/" and "\0" not in path and len(path) <= 4096)


def _max_bytes(raw: str) -> int:
    try:
        value = int(raw, 10)
    except ValueError:
        return -1
    return value if 1 <= value <= MAX_MAX_BYTES else -1


def read_state(path: str, limit: int) -> bytes | None:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_NONBLOCK"):
        return None
    flags = os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW
    flags |= getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags)
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            return None
        chunks: list[bytes] = []
        remaining = limit + 1
        while remaining:
            try:
                chunk = os.read(fd, min(4096, remaining))
            except BlockingIOError:
                return None
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        return data if len(data) <= limit else None
    except OSError:
        return None
    finally:
        os.close(fd)


def write_state(path: str, limit: int) -> bool:
    data = sys.stdin.buffer.read(limit + 1)
    if len(data) > limit:
        return False
    directory = os.path.dirname(path)
    base = os.path.basename(path)
    if not directory or not base:
        return False
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
    except OSError:
        return False
    temp_path = os.path.join(directory, "." + base + "." + secrets.token_hex(8) + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    fd = -1
    try:
        fd = os.open(temp_path, flags, 0o600)
        with os.fdopen(fd, "wb") as stream:
            fd = -1
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
        return True
    except OSError:
        return False
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        except OSError:
            pass


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] not in {"read", "write"}:
        return 2
    mode, path, raw_limit = argv[1:]
    limit = _max_bytes(raw_limit)
    if not _safe_path(path) or limit < 1:
        return 1
    signal.signal(signal.SIGALRM, _die)
    signal.alarm(TIMEOUT_SEC)
    if mode == "read":
        data = read_state(path, limit)
        if data is None:
            return 1
        sys.stdout.buffer.write(data)
        return 0
    return 0 if write_state(path, limit) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
