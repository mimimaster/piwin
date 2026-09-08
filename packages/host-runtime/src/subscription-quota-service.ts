/**
 * Subscription Quota Service.
 * Manages quota reading, TTL caching, manual resets, and push broadcasts.
 */

import type {
  HostPush,
  SubscriptionAccountQuota,
} from '@piwin/contracts';
import {
  createSubscriptionAuthPort,
  defaultPiAuthPaths,
  type SubscriptionAuthPort,
} from '@piwin/agent-host';
import { getPiAgentDir } from './paths.js';

export type SubscriptionQuotaServiceOptions = {
  piwinRoot?: string;
  piAgentDir?: string;
  port?: SubscriptionAuthPort;
  cacheTtlMs?: number;
  now?: () => number;
};

const DEFAULT_CACHE_TTL_MS = 30_000; // 30 seconds debounce / rate limit protection

type CachedQuota = {
  quota: SubscriptionAccountQuota;
  timestamp: number;
};

export class SubscriptionQuotaService {
  private port: SubscriptionAuthPort | undefined;
  private readonly portFactory: () => Promise<SubscriptionAuthPort>;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedQuota>();
  private push: ((message: HostPush) => void) | undefined;

  constructor(options: SubscriptionQuotaServiceOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;

    if (options.port) {
      this.port = options.port;
      this.portFactory = async () => options.port!;
    } else {
      const paths = defaultPiAuthPaths(getPiAgentDir(options.piAgentDir));
      this.portFactory = async () =>
        createSubscriptionAuthPort({
          authPath: paths.authPath,
          modelsPath: paths.modelsPath,
        });
    }
  }

  bindPush(push?: (message: HostPush) => void): void {
    this.push = push;
  }

  private async getPort(): Promise<SubscriptionAuthPort> {
    if (!this.port) {
      this.port = await this.portFactory();
    }
    return this.port;
  }

  async getQuota(
    providerId: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<SubscriptionAccountQuota> {
    const now = this.now();
    const cached = this.cache.get(providerId);

    if (!options.forceRefresh && cached && now - cached.timestamp < this.cacheTtlMs) {
      return cached.quota;
    }

    const port = await this.getPort();
    const quota = await port.fetchQuota(providerId);
    this.cache.set(providerId, { quota, timestamp: now });

    this.push?.({
      type: 'auth/quota-updated',
      quota,
    });

    return quota;
  }

  async resetQuota(
    providerId: string,
  ): Promise<{ ok: boolean; message?: string; quota?: SubscriptionAccountQuota }> {
    const port = await this.getPort();
    if (!port.resetQuota) {
      return {
        ok: false,
        message: `Provider ${providerId} does not support quota reset`,
      };
    }

    const result = await port.resetQuota(providerId);
    if (result.ok && result.quota) {
      this.cache.set(providerId, { quota: result.quota, timestamp: this.now() });
      this.push?.({
        type: 'auth/quota-updated',
        quota: result.quota,
      });
    }
    return result;
  }

  clearCache(providerId?: string): void {
    if (providerId) {
      this.cache.delete(providerId);
    } else {
      this.cache.clear();
    }
  }
}
