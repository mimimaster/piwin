import { describe, expect, it } from 'vitest';

import type { ThemeDeckTokens, ThemeManifest } from '@piwin/contracts';

import { contrastRatio } from './color.js';
import { deriveDeckTokens } from './deck-derive.js';
import { PIWIN_APPEARANCE_BONE, PIWIN_APPEARANCE_OBSIDIAN } from './deck-palette.js';

/** Strip the authored ramp so the manifest looks like an installed theme. */
function withoutDeck(manifest: ThemeManifest): ThemeManifest {
  const { deck: _deck, ...rest } = manifest;
  return rest;
}

/** Perceptual distance is irrelevant here; we only care about channel drift. */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function maxChannelDelta(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
}

describe('deriveDeckTokens', () => {
  for (const authored of [PIWIN_APPEARANCE_OBSIDIAN, PIWIN_APPEARANCE_BONE]) {
    const deck = authored.deck;
    if (!deck) throw new Error(`${authored.id} must author a deck ramp`);

    describe(authored.id, () => {
      const derived = deriveDeckTokens(withoutDeck(authored));

      // The three surface slots the twelve-token contract can carry must survive
      // the round trip untouched. Anything else means the projection in
      // deck-palette.ts and the derivation here disagree about what `bg` means,
      // which silently shifts every layer of the UI by one step.
      it('recovers the anchored surfaces exactly', () => {
        expect(derived.void).toBe(deck.void);
        expect(derived.surface1).toBe(deck.surface1);
        expect(derived.surface3).toBe(deck.surface3);
      });

      // surface2 and surface4 have no slot, so they are reconstructed by
      // interpolation and only need to land close enough to be invisible.
      it('reconstructs the unanchored surfaces within a hair', () => {
        expect(maxChannelDelta(derived.surface2, deck.surface2)).toBeLessThanOrEqual(4);
        expect(maxChannelDelta(derived.surface4, deck.surface4)).toBeLessThanOrEqual(4);
      });

      // Both faces lift away from the field in the same direction: Bone
      // brightens toward white, Obsidian brightens away from near-black. A
      // ladder that stalls or reverses would flatten the depth cue the whole
      // design system leans on.
      it('keeps the field behind every panel', () => {
        const luminance = (hex: string): number =>
          channels(hex).reduce((sum, channel) => sum + channel, 0);
        const ladder = [derived.void, derived.surface1, derived.surface2, derived.surface3];
        for (let i = 1; i < ladder.length; i += 1) {
          expect(luminance(ladder[i]!)).toBeGreaterThan(luminance(ladder[i - 1]!));
        }
      });

      it('carries the accent through as iris', () => {
        expect(derived.iris).toBe(deck.iris);
      });

      it('authors a readable ramp', () => {
        expectRampFloors(deck, authored.mode === 'light');
        expectRampSteps(deck, authored.mode === 'light');
      });

      // The derived ramp is what users actually see: `buildAppearanceTheme`
      // drops the authored `deck` so the three Appearance colors can drive a
      // fresh derivation, which means a floor enforced only in deck-palette.ts
      // would never reach the default install.
      it('keeps the muted steps readable', () => {
        expectRampFloors(derived, authored.mode === 'light');
        expectRampSteps(derived, authored.mode === 'light');
      });
    });
  }

  it('lifts a muted ramp that an installed theme left invisible', () => {
    const washedOut: ThemeManifest = {
      ...withoutDeck(PIWIN_APPEARANCE_OBSIDIAN),
      id: 'washed-out',
      tokens: {
        ...PIWIN_APPEARANCE_OBSIDIAN.tokens,
        // Muted only a hair off the field: the unclamped interpolation used to
        // land text3/text4 inside a couple of RGB steps of the background.
        muted: '#131318',
        ok: '#0d2b1e',
        danger: '#2b0f0d',
      },
    };
    // Only the floors are promised here. A theme whose muted color is already
    // at the floor leaves no headroom for a distinct third step, and inventing
    // one would mean overriding a palette the user chose rather than repairing
    // the part of it that cannot be read at all.
    expectRampFloors(deriveDeckTokens(washedOut), false);
  });
});

/** The reference surface is the one giving the muted steps the least contrast. */
const mutedReferenceOf = (deck: ThemeDeckTokens, isLight: boolean): string =>
  isLight ? deck.surface1 : deck.surface4;

/** No step may be painted at a contrast the eye cannot resolve. */
function expectRampFloors(deck: ThemeDeckTokens, isLight: boolean): void {
  const reference = mutedReferenceOf(deck, isLight);
  for (const readable of [deck.text1, deck.text2, deck.text3]) {
    expect(contrastRatio(readable, reference)).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrastRatio(deck.text4, reference)).toBeGreaterThanOrEqual(3);
  for (const signal of [deck.mint, deck.coral, deck.ember, deck.amber, deck.sky]) {
    expect(contrastRatio(signal, reference)).toBeGreaterThanOrEqual(3);
  }
}

/** A ramp with room to spare must still read as a ramp, not four of one grey. */
function expectRampSteps(deck: ThemeDeckTokens, isLight: boolean): void {
  const reference = mutedReferenceOf(deck, isLight);
  const steps = [deck.text1, deck.text2, deck.text3, deck.text4].map((step) =>
    contrastRatio(step, reference),
  );
  for (let index = 1; index < steps.length; index += 1) {
    expect(steps[index]!).toBeLessThan(steps[index - 1]!);
  }
}
