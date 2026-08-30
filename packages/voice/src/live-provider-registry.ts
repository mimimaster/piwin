import type { LiveProviderRegistration } from './live-provider-registration.js';

export class LiveProviderRegistry {
  private readonly providers = new Map<string, LiveProviderRegistration>();

  constructor(registrations: readonly LiveProviderRegistration[]) {
    for (const registration of registrations) {
      const descriptor = registration.descriptor();
      const providerId = descriptor.providerId;
      if (this.providers.has(providerId)) {
        throw new Error(`duplicate Live provider ${providerId}`);
      }
      this.providers.set(providerId, registration);
    }
  }

  get(providerId: string): LiveProviderRegistration | undefined {
    return this.providers.get(providerId);
  }

  list(): LiveProviderRegistration[] {
    return [...this.providers.values()];
  }
}
