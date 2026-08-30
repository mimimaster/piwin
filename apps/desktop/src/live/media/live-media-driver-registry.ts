import type { LiveMediaDriverId } from '@piwin/contracts';
import type { DesktopLiveMediaDriver } from './live-media-driver.js';

export class DesktopLiveMediaDriverRegistry {
  private readonly factories = new Map<LiveMediaDriverId, () => DesktopLiveMediaDriver>();

  constructor(factories: ReadonlyArray<readonly [LiveMediaDriverId, () => DesktopLiveMediaDriver]>) {
    for (const [id, factory] of factories) {
      if (this.factories.has(id)) {
        throw new Error(`duplicate Live media driver ${id}`);
      }
      this.factories.set(id, factory);
    }
  }

  has(id: LiveMediaDriverId): boolean {
    return this.factories.has(id);
  }

  create(id: LiveMediaDriverId): DesktopLiveMediaDriver {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`unknown Live media driver ${id}`);
    const driver = factory();
    if (driver.id !== id) {
      throw new Error(`Live media driver factory for ${id} produced ${driver.id}`);
    }
    return driver;
  }
}
