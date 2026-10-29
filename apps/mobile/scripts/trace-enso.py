"""Trace the brush enso out of the app icon into one SVG path (launch splash).

Dev-only. Needs: pip install potracer pillow numpy
Usage: python3 apps/mobile/scripts/trace-enso.py > /tmp/enso.txt
Prints the path `d` in the icon's 1024x1024 space (the orange dot is drawn
separately by the splash, so it is excluded here).
"""
import sys
import numpy as np
from PIL import Image
import potrace

SRC = 'apps/desktop/src-tauri/icons/icon-source-1024.png'
img = np.asarray(Image.open(SRC).convert('RGB')).astype(np.int32)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
lum = (r * 299 + g * 587 + b * 114) // 1000
orange = (r - b) > 60
mask = (lum > 140) & ~orange
# Drop the rounded-rect icon edge highlights: keep the ring disc only.
yy, xx = np.mgrid[0:1024, 0:1024]
mask &= np.hypot(xx - 512, yy - 505) < 430
# potracer traces the False pixels, so hand it the complement.
bmp = potrace.Bitmap(~mask)
plist = bmp.trace(turdsize=6, alphamax=1.0, opticurve=True, opttolerance=0.4)

def f(v):
    return f'{v:.1f}'.rstrip('0').rstrip('.')

parts = []
for curve in plist:
    parts.append(f'M{f(curve.start_point.x)} {f(curve.start_point.y)}')
    for seg in curve.segments:
        if seg.is_corner:
            parts.append(f'L{f(seg.c.x)} {f(seg.c.y)}L{f(seg.end_point.x)} {f(seg.end_point.y)}')
        else:
            parts.append(
                f'C{f(seg.c1.x)} {f(seg.c1.y)} {f(seg.c2.x)} {f(seg.c2.y)} {f(seg.end_point.x)} {f(seg.end_point.y)}'
            )
    parts.append('Z')
d = ''.join(parts)
ring = np.hypot(xx - 512, yy - 505)[mask]
print(f'curves={len(plist)} chars={len(d)} r_min={ring.min():.0f} r_p5={np.percentile(ring,5):.0f} r_p50={np.percentile(ring,50):.0f} r_p95={np.percentile(ring,95):.0f} r_max={ring.max():.0f}', file=sys.stderr)
print(d)
