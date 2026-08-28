#!/usr/bin/env python3
"""Read data/srd.json through one no-follow, nonblocking regular-file descriptor.

The snapshot lives at a predictable user-writable path, so this helper:

- opens the path with O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC
- fstats that same descriptor and refuses anything that is not a regular file
- applies the byte ceiling to reads from that descriptor
- arms a short alarm so a FIFO or hung filesystem cannot stall the shell
"""

from __future__ import annotations

import os
import signal
import stat
import sys

MAX_MAX_BYTES = 8 * 1024 * 1024
TIMEOUT_SEC = 2


def _die(_signum=None, _frame=None) -> None:
    os._exit(1)


def _open_flags() -> int:
    flags = os.O_RDONLY
    flags |= getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    flags |= getattr(os, "O_NONBLOCK", 0)
    return flags


def _parse_max_bytes(raw: str) -> int:
    try:
        value = int(raw, 10)
    except ValueError:
        return -1
    if value < 1 or value > MAX_MAX_BYTES:
        return -1
    return value


def _safe_path(path: str) -> bool:
    if not path or path[0] != "/" or "\0" in path or len(path) > 4096:
        return False
    return True


def read_index(path: str, max_bytes: int) -> bytes | None:
    try:
        fd = os.open(path, _open_flags())
    except OSError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return None
        if info.st_size > max_bytes:
            return None
        chunks: list[bytes] = []
        got = 0
        limit = max_bytes + 1
        while got < limit:
            try:
                buf = os.read(fd, min(65536, limit - got))
            except BlockingIOError:
                return None
            if not buf:
                break
            chunks.append(buf)
            got += len(buf)
        data = b"".join(chunks)
        if len(data) > max_bytes:
            return None
        return data
    except OSError:
        return None
    finally:
        os.close(fd)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write("usage: read-index.py <path> <max_bytes>\n")
        return 2
    path = argv[1]
    max_bytes = _parse_max_bytes(argv[2])
    if not _safe_path(path) or max_bytes < 1:
        return 1

    signal.signal(signal.SIGALRM, _die)
    signal.alarm(TIMEOUT_SEC)
    data = read_index(path, max_bytes)
    if data is None:
        return 1
    sys.stdout.buffer.write(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
