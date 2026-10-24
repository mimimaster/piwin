/**
 * Presence of the device that owns an in-flight subscription login. A device
 * can hold several shells, so presence is counted per device id; until any
 * device reports itself, the explicit connected flag is the only answer.
 */
export class SubscriptionLoginOwnership {
  private readonly deviceConnections = new Map<string, number>();
  private connected = true;
  private tracked = false;

  /** Returns false (and records nothing) for a blank device id. */
  public noteDeviceConnected(deviceId: string): boolean {
    const id = deviceId.trim();
    if (!id) {
      return false;
    }
    this.tracked = true;
    this.deviceConnections.set(id, (this.deviceConnections.get(id) ?? 0) + 1);
    return true;
  }

  /** Returns false (and records nothing) for a blank device id. */
  public noteDeviceDisconnected(deviceId: string): boolean {
    const id = deviceId.trim();
    if (!id) {
      return false;
    }
    const next = (this.deviceConnections.get(id) ?? 0) - 1;
    if (next <= 0) {
      this.deviceConnections.delete(id);
    } else {
      this.deviceConnections.set(id, next);
    }
    return true;
  }

  public setConnected(connected: boolean): void {
    this.connected = connected;
  }

  /** `activeOwnerDeviceId` is absent when no login is in flight. */
  public isConnected(activeOwnerDeviceId: string | undefined): boolean {
    if (activeOwnerDeviceId === undefined || !this.tracked) {
      return this.connected;
    }
    return (this.deviceConnections.get(activeOwnerDeviceId) ?? 0) > 0;
  }
}
