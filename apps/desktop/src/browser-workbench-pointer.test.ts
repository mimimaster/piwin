import { describe, expect, it } from 'vitest';
import {
  coalesceMouseMoves,
  contentRectFromImage,
  displayRectFromViewport,
  viewportFromDisplay,
} from './browser-workbench-pointer';

describe('viewportFromDisplay', () => {
  it('scales display px into CSS viewport px', () => {
    expect(
      viewportFromDisplay({
        displayX: 50,
        displayY: 25,
        displayWidth: 100,
        displayHeight: 50,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });

  it('returns null when the displayed box has no size', () => {
    expect(
      viewportFromDisplay({
        displayX: 10,
        displayY: 10,
        displayWidth: 0,
        displayHeight: 10,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toBeNull();
  });

  it('maps a high-DPI-style 2× display box onto the CSS viewport', () => {
    expect(
      viewportFromDisplay({
        displayX: 256,
        displayY: 160,
        displayWidth: 2560,
        displayHeight: 1600,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 128, y: 80 });
  });

  it('maps encoding-shrunk frames using CSS viewport, not JPEG px', () => {
    // JPEG may be 640×400 while the page CSS viewport stays 1280×800.
    expect(
      viewportFromDisplay({
        displayX: 320,
        displayY: 200,
        displayWidth: 640,
        displayHeight: 400,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });

  it('does not map a click in the vertical letterbox bar', () => {
    // 1280×800 page in a 400×800 img: content is 400×250, y-offset 275.
    expect(
      viewportFromDisplay({
        displayX: 200,
        displayY: 10,
        displayWidth: 400,
        displayHeight: 800,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toBeNull();
  });

  it('maps a click inside the letterboxed content', () => {
    expect(
      viewportFromDisplay({
        displayX: 200,
        displayY: 400,
        displayWidth: 400,
        displayHeight: 800,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });

  it('does not map a click in the horizontal letterbox bar', () => {
    // 1280×800 page in a 1280×400 img: content is 640×400, x-offset 320.
    expect(
      viewportFromDisplay({
        displayX: 10,
        displayY: 200,
        displayWidth: 1280,
        displayHeight: 400,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toBeNull();
  });

  it('maps a click inside horizontally letterboxed content', () => {
    expect(
      viewportFromDisplay({
        displayX: 640,
        displayY: 200,
        displayWidth: 1280,
        displayHeight: 400,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });

  it('maps against the last frame viewport while the panel is mid-resize', () => {
    expect(
      viewportFromDisplay({
        displayX: 200,
        displayY: 400,
        displayWidth: 400,
        displayHeight: 800,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 640, y: 400 });
  });
});

describe('contentRectFromImage', () => {
  it('centers a 16:10 page inside a tall element', () => {
    expect(
      contentRectFromImage({
        elementWidth: 400,
        elementHeight: 800,
        intrinsicWidth: 1280,
        intrinsicHeight: 800,
      }),
    ).toEqual({ x: 0, y: 275, width: 400, height: 250 });
  });
});

describe('displayRectFromViewport', () => {
  it('places a pick highlight inside the contained content box', () => {
    expect(
      displayRectFromViewport({
        viewportX: 128,
        viewportY: 80,
        viewportBoxWidth: 40,
        viewportBoxHeight: 20,
        displayWidth: 400,
        displayHeight: 800,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({ x: 40, y: 300, width: 12.5, height: 6.25 });
  });
});

describe('coalesceMouseMoves', () => {
  it('keeps only the last of consecutive moves', () => {
    expect(
      coalesceMouseMoves([
        { type: 'mouse', action: 'move', x: 1, y: 1 },
        { type: 'mouse', action: 'move', x: 2, y: 2 },
        { type: 'mouse', action: 'down', x: 2, y: 2 },
        { type: 'mouse', action: 'move', x: 3, y: 3 },
      ]),
    ).toEqual([
      { type: 'mouse', action: 'move', x: 2, y: 2 },
      { type: 'mouse', action: 'down', x: 2, y: 2 },
      { type: 'mouse', action: 'move', x: 3, y: 3 },
    ]);
  });
});
