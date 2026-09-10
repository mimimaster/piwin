/**
 * Extra models a v1 subscription can actually call on non-chat surfaces.
 * Chat rows still come from Pi's provider catalog. This overlay is not a
 * CPA dump: no aliases, no Codex-as-Claude, no other vendor's models.
 */
import type { ModelCapability, ModelConfigEntry } from './config.js';
import {
  isV1SubscriptionProviderId,
  type V1SubscriptionProviderId,
} from './subscription-oauth.js';

export type SubscriptionSurfaceExtra = {
  id: string;
  name: string;
  capabilities: readonly ModelCapability[];
  input?: readonly ('text' | 'image')[];
  routes?: ModelConfigEntry['routes'];
};

const CODEX_IMAGE_ROUTE = {
  'image-generation': { path: '/codex/images/generations', apiStyle: 'openai' as const },
} as const;

const GROK_IMAGE_ROUTE = {
  'image-generation': { path: '/images/generations', apiStyle: 'openai' as const },
} as const;

const GROK_VIDEO_ROUTE = {
  'video-generation': { path: '/videos/generations', apiStyle: 'xgrok-videos' as const },
} as const;

export const SUBSCRIPTION_SURFACE_EXTRAS: {
  readonly [K in V1SubscriptionProviderId]?: readonly SubscriptionSurfaceExtra[];
} = {
  'openai-codex': [
    {
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      capabilities: ['image-generation'],
      routes: CODEX_IMAGE_ROUTE,
    },
    {
      id: 'gpt-image-2.5-sunburst',
      name: 'GPT Image 2.5 Sunburst',
      capabilities: ['image-generation'],
      routes: CODEX_IMAGE_ROUTE,
    },
    {
      id: 'gpt-image-2.5-flare',
      name: 'GPT Image 2.5 Flare',
      capabilities: ['image-generation'],
      routes: CODEX_IMAGE_ROUTE,
    },
  ],
  xai: [
    {
      id: 'grok-imagine-image',
      name: 'Grok Imagine Image',
      capabilities: ['image-generation'],
      routes: GROK_IMAGE_ROUTE,
    },
    {
      id: 'grok-imagine-image-lite',
      name: 'Grok Imagine Image Lite',
      capabilities: ['image-generation'],
      routes: GROK_IMAGE_ROUTE,
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine Image 2.0',
      capabilities: ['image-generation'],
      routes: GROK_IMAGE_ROUTE,
    },
    {
      id: 'grok-imagine-video',
      name: 'Grok Imagine Video',
      capabilities: ['video-generation'],
      routes: GROK_VIDEO_ROUTE,
    },
    {
      id: 'grok-imagine-video-1.5',
      name: 'Grok Imagine Video 1.5',
      capabilities: ['video-generation'],
      routes: GROK_VIDEO_ROUTE,
    },
  ],
};

export function subscriptionSurfaceExtras(
  providerId: string,
): readonly SubscriptionSurfaceExtra[] {
  if (!isV1SubscriptionProviderId(providerId)) {
    return [];
  }
  return SUBSCRIPTION_SURFACE_EXTRAS[providerId] ?? [];
}
