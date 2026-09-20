#!/usr/bin/env python3
"""Render the piwin NSIS installer art (sidebar + header bitmaps).

The previous bitmaps carried CJK copy rendered with a Latin-only face, so every
Chinese glyph came out as a tofu box. This generator renders from the real
Inkstone dark palette (`packages/theme/bundled/piwin-inkstone-ink/theme.json`)
with a CJK-capable face and then self-checks the rasterised text for tofu.

Usage: python3 scripts/dev/gen-nsis-art.py [--check-only]
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[2]
ICONS_DIR = REPO_ROOT / "apps" / "desktop" / "src-tauri" / "icons"
SIDEBAR_PATH = ICONS_DIR / "nsis-sidebar.bmp"
HEADER_PATH = ICONS_DIR / "nsis-header.bmp"
ICON_SOURCE = ICONS_DIR / "icon-source-1024.png"

# Inkstone · 墨 (packages/theme/bundled/piwin-inkstone-ink/theme.json)
VOID = (0x0B, 0x0A, 0x09)
SURFACE1 = (0x14, 0x12, 0x10)
SURFACE2 = (0x19, 0x17, 0x14)
SURFACE3 = (0x20, 0x1D, 0x19)
TEXT1 = (0xEB, 0xE5, 0xDA)
TEXT2 = (0xA5, 0x9D, 0x92)
TEXT3 = (0x8B, 0x83, 0x78)
TEXT4 = (0x6A, 0x62, 0x59)
IRIS = (0xE2, 0x5A, 0x3D)
LINE2 = (0x26, 0x23, 0x1F)

# MUI draws the welcome bitmap 1:1, so these are fixed canvas sizes.
SIDEBAR_SIZE = (164, 314)
HEADER_SIZE = (150, 57)

CJK_FONT_CANDIDATES = (
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/System/Library/Fonts/STHeiti Medium.ttc", 1),
    ("/Library/Fonts/Arial Unicode.ttf", 0),
)

COPY = {
    "wordmark": "piwin",
    "tagline": "私有 AI 智能体工作台",
    "body1": "私有智能体工作台",
    "body2": "本地运行 · 数据不出机",
    "bottom": "DESKTOP SHELL",
}


CJK_COVERAGE = "私有智能体工作台本地运行数据不出机安装"


def load_cjk_font(size: int) -> ImageFont.FreeTypeFont:
    """First installed face that actually has the glyphs we need."""
    probe = "".join(CJK_COVERAGE)
    for path, index in CJK_FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
        if all(font.getmask(char).getbbox() is not None for char in probe):
            return font
    raise SystemExit("no CJK-capable font found; refusing to bake tofu into the art")


def text_wh(font: ImageFont.FreeTypeFont, text: str) -> tuple[int, int]:
    left, top, right, bottom = font.getbbox(text)
    return right - left, bottom - top


def fit_font(text: str, max_width: int, start: int, floor: int = 8) -> ImageFont.FreeTypeFont:
    for size in range(start, floor - 1, -1):
        font = load_cjk_font(size)
        if text_wh(font, text)[0] <= max_width:
            return font
    raise SystemExit(f"cannot fit {text!r} into {max_width}px")


def draw_centered(draw: ImageDraw.ImageDraw, text: str, font, canvas_w: int, y: int, fill) -> None:
    width, _ = text_wh(font, text)
    draw.text(((canvas_w - width) // 2, y), text, font=font, fill=fill)


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    strip = Image.new("RGB", (1, height))
    pixels = strip.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        pixels[0, y] = tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3))
    return strip.resize((width, height), Image.NEAREST)


def paste_logo(canvas: Image.Image, box: int, box_xy: tuple[int, int]) -> None:
    logo = Image.open(ICON_SOURCE).convert("RGBA").resize((box, box), Image.LANCZOS)
    canvas.paste(logo, box_xy, logo)


def render_sidebar() -> Image.Image:
    width, height = SIDEBAR_SIZE
    pad = 16
    canvas = vertical_gradient(SIDEBAR_SIZE, VOID, SURFACE1)
    draw = ImageDraw.Draw(canvas)

    paste_logo(canvas, 62, ((width - 62) // 2, 40))

    wordmark_font = fit_font(COPY["wordmark"], width - 2 * pad, 30)
    wordmark_w, wordmark_h = text_wh(wordmark_font, COPY["wordmark"])
    draw.text(((width - wordmark_w) // 2, 118), COPY["wordmark"], font=wordmark_font, fill=TEXT1)

    # Vermillion rule under the wordmark: the one warm accent on the panel.
    rule_w, rule_h = 30, 3
    rule_y = 118 + wordmark_h + 14
    draw.rounded_rectangle(
        ((width - rule_w) // 2, rule_y, (width + rule_w) // 2, rule_y + rule_h),
        radius=1,
        fill=IRIS,
    )

    body1_font = fit_font(COPY["body1"], width - 2 * pad, 14)
    draw_centered(draw, COPY["body1"], body1_font, width, rule_y + rule_h + 20, TEXT1)

    body2_font = fit_font(COPY["body2"], width - 2 * pad, 13)
    draw_centered(draw, COPY["body2"], body2_font, width, rule_y + rule_h + 44, TEXT2)

    # Bottom plate
    plate_top = height - 74
    draw.rounded_rectangle((12, plate_top, width - 12, height - 20), radius=8, fill=SURFACE2)
    plate_label = letterspace(COPY["bottom"], 2)
    plate_font = fit_font(plate_label, width - 24 - 24, 11, floor=6)
    label_w, label_h = text_wh(plate_font, plate_label)
    draw.text(
        ((width - label_w) // 2, plate_top + (54 - label_h) // 2 + 2),
        plate_label,
        font=plate_font,
        fill=TEXT3,
    )

    draw.line((16, plate_top - 16, width - 16, plate_top - 16), fill=LINE2, width=1)
    return canvas


def render_header() -> Image.Image:
    width, height = HEADER_SIZE
    canvas = Image.new("RGB", HEADER_SIZE, SURFACE1)
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((10, 13, 12, height - 13), radius=1, fill=IRIS)

    wordmark_font = fit_font(COPY["wordmark"], width - 40, 20)
    _, wordmark_h = text_wh(wordmark_font, COPY["wordmark"])
    draw.text((20, 10), COPY["wordmark"], font=wordmark_font, fill=TEXT1)

    tagline_font = fit_font(COPY["tagline"], width - 30, 11, floor=7)
    draw.text((20, 10 + wordmark_h + 5), COPY["tagline"], font=tagline_font, fill=TEXT2)
    return canvas


def letterspace(text: str, gap: int) -> str:
    return (" " * gap).join(text)


# --- self-check -------------------------------------------------------------


@dataclass
class TofuReport:
    distinct: int
    glyphs: int
    bands: list[tuple[int, int, int, int]]  # y0, y1, glyphs, distinct

    @property
    def ok(self) -> bool:
        """A row is tofu when most of its glyphs share one identical raster."""
        for _y0, _y1, glyphs, distinct in self.bands:
            if glyphs >= 3 and distinct < (glyphs + 1) // 2:
                return False
        return True


def cjk_bands(image: Image.Image, rows: tuple[tuple[int, int], ...]) -> TofuReport:
    """Count distinct glyph rasters per text row.

    Tofu (missing glyph) renders the same hollow box for every character, so a
    row of N Chinese glyphs collapses to 1-2 distinct rasters. Real text gives
    roughly N distinct rasters.
    """
    gray = image.convert("L")
    pixels = gray.load()
    width, height = gray.size

    def ink(x: int, y: int) -> bool:
        return pixels[x, y] > 70

    total_glyphs = 0
    all_hashes: set[str] = set()
    band_info: list[tuple[int, int, int, int]] = []
    for y0, y1 in rows:
        columns = [any(ink(x, y) for y in range(y0, min(y1, height))) for x in range(width)]
        segments: list[tuple[int, int]] = []
        start = None
        for x, filled in enumerate(columns):
            if filled and start is None:
                start = x
            elif not filled and start is not None:
                segments.append((start, x - 1))
                start = None
        if start is not None:
            segments.append((start, width - 1))

        row_hashes = set()
        for a, b in segments:
            raster = bytes(
                1 if ink(x, y) else 0
                for y in range(y0, min(y1, height))
                for x in range(a, b + 1)
            )
            row_hashes.add(hashlib.md5(raster).hexdigest())
        total_glyphs += len(segments)
        all_hashes |= row_hashes
        band_info.append((y0, y1, len(segments), len(row_hashes)))

    return TofuReport(distinct=len(all_hashes), glyphs=total_glyphs, bands=band_info)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true", help="verify existing bitmaps, do not write")
    args = parser.parse_args()

    sidebar = render_sidebar()
    header = render_header()

    assert sidebar.size == SIDEBAR_SIZE, sidebar.size
    assert header.size == HEADER_SIZE, header.size
    assert sidebar.mode == "RGB" and header.mode == "RGB"

    if not args.check_only:
        sidebar.save(SIDEBAR_PATH)
        header.save(HEADER_PATH)

    # Text rows of the sidebar, measured on the rendered output.
    report = cjk_bands(
        sidebar,
        ((170, 190), (194, 214), (SIDEBAR_SIZE[1] - 60, SIDEBAR_SIZE[1] - 30)),
    )
    print(f"sidebar {sidebar.size} rows={report.bands} distinct={report.distinct} glyphs={report.glyphs}")
    header_report = cjk_bands(header, ((30, 50),))
    print(f"header  {header.size} rows={header_report.bands} distinct={header_report.distinct} glyphs={header_report.glyphs}")

    if not report.ok or not header_report.ok:
        print("FAIL: text rasterised as tofu (missing glyphs)", file=sys.stderr)
        return 1

    if not args.check_only:
        print(f"wrote {SIDEBAR_PATH}")
        print(f"wrote {HEADER_PATH}")
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
