/**
 * Provider identity in the provider workspace. Custom channels (ids from the
 * custom-openai / custom-anthropic presets) get an ink monogram "seal":
 * ProviderIcon would draw the protocol's vendor mark, so seven relays all
 * looked like the same black OpenAI tile. Vendor presets and OAuth plans keep
 * their brand mark.
 *
 * The seal is deliberately monochrome. Inkstone's palette has few distinct
 * hues (and iris is reserved for selection), so hashed colors collided and
 * fought the paper/ink look; the letter and the name already tell rows apart.
 */

import type { ReactElement } from 'react';
import { ProviderIcon } from './provider-icons.js';

function monogram(name: string, id: string): string {
  const source = name.trim() || id;
  const letter = source.match(/[\p{L}\p{N}]/u)?.[0] ?? '?';
  return letter.toUpperCase();
}

export function isCustomChannelId(id: string): boolean {
  return id.toLowerCase().startsWith('custom');
}

export function ProviderAvatar(props: { id: string; name: string; size: number }): ReactElement {
  if (!isCustomChannelId(props.id)) {
    return <ProviderIcon id={props.id} name={props.name} size={props.size} />;
  }
  return (
    <span
      className="pavatar"
      aria-hidden
      data-provider-icon={props.id}
      style={{
        width: props.size,
        height: props.size,
        borderRadius: Math.max(7, Math.round(props.size * 0.28)),
        fontSize: Math.round(props.size * 0.44),
      }}
    >
      {monogram(props.name, props.id)}
    </span>
  );
}
