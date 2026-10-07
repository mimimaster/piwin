import { invoke } from '@tauri-apps/api/core';
import type { AppleHealthReadResultV1, ClientToolRequestFrame } from '@piwin/contracts';
import { createHealthKitBridge, readHealthKitInvokeCode } from '@piwin/host-client';

/** The bridge lives in @piwin/host-client; this binds it to the shell's Tauri invoke. */
export const mobileHealthKit = createHealthKitBridge((command, args) =>
  args === undefined ? invoke(command) : invoke(command, args),
);

export { readHealthKitInvokeCode };

export function healthkitIsAvailable(): Promise<boolean> {
  return mobileHealthKit.isAvailable();
}

export function healthkitReadContext(
  request: ClientToolRequestFrame,
): Promise<AppleHealthReadResultV1> {
  return mobileHealthKit.readContext(request);
}

export function healthkitCancelRead(requestId: string): Promise<void> {
  return mobileHealthKit.cancelRead(requestId);
}

export function healthkitRequestReadAuthorization(metrics?: readonly string[]): Promise<void> {
  return mobileHealthKit.requestReadAuthorization(metrics);
}
