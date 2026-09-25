#!/usr/bin/env python3
"""Build the Windows executable/installer ICO with size-specific artwork.

Usage: python3 scripts/dev/gen-windows-icon.py [--check-only]
Requires the workspace Tauri CLI and Pillow (also used by gen-nsis-art.py).
"""

from __future__ import annotations

import argparse
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DESKTOP_DIR = REPO_ROOT / "apps" / "desktop"
ICONS_DIR = DESKTOP_DIR / "src-tauri" / "icons"
ICON_PATH = ICONS_DIR / "icon.ico"
SMALL_SIZES = (16, 20, 24, 30, 32, 36, 40, 48)
LARGE_SIZES = (60, 64, 72, 80, 96, 128, 256)
ALL_SIZES = SMALL_SIZES + LARGE_SIZES
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def render_sizes(source: Path, sizes: tuple[int, ...], output: Path) -> None:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise SystemExit("pnpm not found")
    subprocess.run(
        [
            pnpm,
            "--dir",
            str(DESKTOP_DIR),
            "exec",
            "tauri",
            "icon",
            str(source),
            "--output",
            str(output),
            "--png",
            ",".join(map(str, sizes)),
        ],
        cwd=REPO_ROOT,
        check=True,
    )


def pack_icon(small_dir: Path, large_dir: Path, intermediate: Path) -> bytes:
    frames: list[Image.Image] = []
    for size in ALL_SIZES:
        rendered = (small_dir if size in SMALL_SIZES else large_dir) / f"{size}x{size}.png"
        with Image.open(rendered) as image:
            if image.size != (size, size):
                raise ValueError(f"unexpected icon size: {rendered} {image.size}")
            frames.append(image.convert("RGBA"))

    # Use uncompressed DIB frames below 256 px and compress only the largest
    # frame, following Microsoft's desktop icon format guidance.
    frames[-1].save(
        intermediate,
        format="ICO",
        sizes=[(size, size) for size in ALL_SIZES],
        append_images=frames[:-1],
        bitmap_format="bmp",
    )
    encoded = intermediate.read_bytes()
    count = struct.unpack_from("<H", encoded, 4)[0]
    if count != len(ALL_SIZES):
        raise ValueError(f"expected {len(ALL_SIZES)} icon frames, got {count}")

    entries: list[tuple[int, bytes, bytes]] = []
    for index in range(count):
        entry = encoded[6 + 16 * index : 22 + 16 * index]
        size = entry[0] or 256
        length, offset = struct.unpack_from("<II", entry, 8)
        payload = encoded[offset : offset + length]
        if size == 256:
            payload = (large_dir / "256x256.png").read_bytes()
        entries.append((size, entry, payload))
    if tuple(size for size, _, _ in entries) != tuple(sorted(ALL_SIZES)):
        raise ValueError("ICO frame order or sizes are incorrect")

    header = bytearray(struct.pack("<HHH", 0, 1, count))
    payload_offset = 6 + 16 * count
    for _, entry, payload in entries:
        header.extend(entry[:8])
        header.extend(struct.pack("<II", len(payload), payload_offset))
        payload_offset += len(payload)
    return bytes(header) + b"".join(payload for _, _, payload in entries)


def verify_icon(path: Path) -> None:
    encoded = path.read_bytes()
    with Image.open(path) as icon:
        sizes = {width for width, height in icon.info["sizes"] if width == height}
        if sizes != set(ALL_SIZES):
            raise ValueError(f"incorrect ICO sizes: {sorted(sizes)}")
        for size in ALL_SIZES:
            frame = icon.ico.getimage((size, size)).convert("RGBA")
            alpha = frame.getchannel("A")
            if alpha.getpixel((size // 2, 0)) < 128 or alpha.getpixel((0, 0)) >= 128:
                raise ValueError(f"incorrect alpha edge in {size}px frame")
    for index, size in enumerate(ALL_SIZES):
        entry = encoded[6 + 16 * index : 22 + 16 * index]
        length, offset = struct.unpack_from("<II", entry, 8)
        is_png = encoded[offset : offset + min(length, 8)] == PNG_SIGNATURE
        if is_png != (size == 256):
            raise ValueError(f"incorrect frame encoding at {size}px")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="piwin-windows-icon-") as directory:
        temporary = Path(directory)
        small_dir = temporary / "small"
        large_dir = temporary / "large"
        render_sizes(ICONS_DIR / "icon-windows-small.svg", SMALL_SIZES, small_dir)
        render_sizes(ICONS_DIR / "icon-source-1024.png", LARGE_SIZES, large_dir)
        expected = pack_icon(small_dir, large_dir, temporary / "intermediate.ico")
        if args.check_only:
            if ICON_PATH.read_bytes() != expected:
                raise SystemExit("icon.ico is out of date; run gen-windows-icon.py")
        else:
            ICON_PATH.write_bytes(expected)
    verify_icon(ICON_PATH)
    print(f"OK: {ICON_PATH} ({len(ALL_SIZES)} frames: {', '.join(map(str, ALL_SIZES))} px)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
