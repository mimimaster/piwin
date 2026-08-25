import type { ClientToolCapabilitiesFrame, ClientToolResultFrame } from '@piwin/contracts';
import type { DeviceToolBroker } from './device-tool-broker.js';

export type ClientToolRoutedConnection = {
  connectionEpoch: string;
  deviceId: string | undefined;
};

/**
 * Routes authenticated client-tool result/capability frames to the broker.
 * Does not touch HostCommand, replay, or egress.
 */
export class ClientToolFrameRouter {
  private readonly broker: DeviceToolBroker;

  public constructor(broker: DeviceToolBroker) {
    this.broker = broker;
  }

  public handleResult(connection: ClientToolRoutedConnection, frame: ClientToolResultFrame): void {
    if (connection.deviceId === undefined) {
      return;
    }
    this.broker.admitResult({
      connectionEpoch: connection.connectionEpoch,
      deviceId: connection.deviceId,
      frame,
    });
  }

  public handleCapabilities(
    connection: ClientToolRoutedConnection,
    frame: ClientToolCapabilitiesFrame,
  ): void {
    if (connection.deviceId === undefined) {
      return;
    }
    this.broker.replaceCapabilities(connection.connectionEpoch, frame.capabilities);
  }
}
