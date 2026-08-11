// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PetSummary } from '@piwin/contracts';
import { PetThumbnail } from './PetThumbnail.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createPet(
  overrides: Partial<PetSummary> = {},
): Pick<PetSummary, 'id' | 'spritesheetAbsolutePath' | 'manifest'> {
  return {
    id: 'architect-alpaca',
    spritesheetAbsolutePath: '/tmp/architect-alpaca/spritesheet.webp',
    manifest: {
      id: 'architect-alpaca',
      displayName: 'Architect Alpaca',
      spritesheetPath: 'spritesheet.webp',
    },
    ...overrides,
  };
}

describe('PetThumbnail', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('clips the real pet atlas instead of rendering a placeholder emoji', () => {
    act(() => {
      root.render(<PetThumbnail pet={createPet()} />);
    });

    const thumbnail = container.querySelector('[data-testid="pet-thumbnail-architect-alpaca"]');
    const image = thumbnail?.querySelector('img');
    expect(thumbnail).not.toBeNull();
    expect(image?.getAttribute('src')).toBe('file:///tmp/architect-alpaca/spritesheet.webp');
    expect(image?.style.width).toMatch(/px$/);
    expect(image?.style.height).toMatch(/px$/);
  });

  it('keeps a readable fallback when no spritesheet path is available', () => {
    const pet = createPet({ id: 'unknown-pet', spritesheetAbsolutePath: '' });
    delete pet.manifest;
    act(() => {
      root.render(<PetThumbnail pet={pet} />);
    });

    expect(container.querySelector('.pet-thumbnail-fallback')?.textContent).toBe('🐾');
  });
});
