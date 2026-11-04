/** Site registry: the only place that knows which adapters exist. */

import type { SiteDefinition } from '../site-adapter.ts';
import { chatgptSite } from './chatgpt.ts';
import { claudeSite } from './claude.ts';

export const SITES: readonly SiteDefinition[] = [chatgptSite, claudeSite];

export function findSiteById(id: string): SiteDefinition | undefined {
  return SITES.find((site) => site.id === id);
}

/** Adapter for a URL, matched on host suffix so `chatgpt.com/uc/...` still hits. */
export function findSiteForUrl(url: string): SiteDefinition | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return undefined;
  }
  return SITES.find((site) => site.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)));
}

export { chatgptSite, claudeSite };
