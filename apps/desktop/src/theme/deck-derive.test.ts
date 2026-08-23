import { describe, expect, it } from 'vitest';

import type { ThemeManifest } from '@piwin/contracts';

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
    });
  }
});
