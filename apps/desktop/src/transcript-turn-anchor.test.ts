// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  computeTurnAnchorScrollTop,
  computeTurnAnchorSpacerHeight,
  TranscriptTurnAnchorController,
} from './transcript-turn-anchor.js';

describe('computeTurnAnchorScrollTop', () => {
  it('places the prompt at the stable viewport offset', () => {
    expect(
      computeTurnAnchorScrollTop({
        currentScrollTop: 500,
        containerTop: 80,
        targetTop: 340,
      }),
    ).toBe(732);
  });

  it('never produces a negative scroll offset', () => {
    expect(
      computeTurnAnchorScrollTop({
        currentScrollTop: 0,
        containerTop: 100,
        targetTop: 110,
      }),
    ).toBe(0);
  });
});

describe('computeTurnAnchorSpacerHeight', () => {
  it('adds only the missing tail space needed by a long-history prompt', () => {
    expect(
      computeTurnAnchorSpacerHeight({
        currentSpacerHeight: 240,
        desiredScrollTop: 1_100,
        maximumScrollTop: 700,
      }),
    ).toBe(641);
  });

  it('keeps the existing reserve when the anchor is already reachable', () => {
    expect(
      computeTurnAnchorSpacerHeight({
        currentSpacerHeight: 240,
        desiredScrollTop: 600,
        maximumScrollTop: 700,
      }),
    ).toBe(240);
  });
});

describe('TranscriptTurnAnchorController', () => {
  it('resets the retained spacer before anchoring a consecutive turn', () => {
    const container = document.createElement('div');
    const spacer = document.createElement('div');
    spacer.className = 'transcript-turn-anchor-spacer';
    spacer.style.height = '1400px';
    container.appendChild(spacer);
    const controller = new TranscriptTurnAnchorController({
      getContainer: () => container,
      beginProgrammaticScroll: vi.fn(),
      updateMetrics: vi.fn(),
      recordGeometry: vi.fn(),
      onRelease: vi.fn(),
    });

    expect(controller.setMessageId('next-prompt')).toBe(true);
    expect(spacer.style.height).toBe('');
  });
});
