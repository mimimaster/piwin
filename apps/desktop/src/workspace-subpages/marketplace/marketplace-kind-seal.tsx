/**
 * One seal per capability kind, not per entry: the mark says what *sort* of
 * thing you are installing, the title already says which one. Each kind gets
 * its own seal form (see styles/region-marketplace-seals.css):
 * extension 器 — 白文印, solid vermilion; code that runs inside the Host.
 * skill 法 — 朱文印, vermilion outline; a written method the model follows.
 * mcp 通 — 墨书题签, ink label; a line out to an external server.
 */
import type { ReactElement } from 'react';
import type { MarketplaceCapabilityKind } from '@piwin/contracts';

const KIND_SEALS: Record<MarketplaceCapabilityKind, string> = {
  extension: '器',
  skill: '法',
  mcp: '通',
  agent: '行',
};

export type MarketplaceKindSealProps = {
  kind: MarketplaceCapabilityKind;
  /** `lg` is the dialog header size; cards use the default. */
  size?: 'md' | 'lg';
};

export function MarketplaceKindSeal(props: MarketplaceKindSealProps): ReactElement {
  const sizeClass = props.size === 'lg' ? ' is-lg' : '';
  return (
    <span className={`market-card-mark is-${props.kind}${sizeClass}`} aria-hidden="true">
      {KIND_SEALS[props.kind]}
    </span>
  );
}
