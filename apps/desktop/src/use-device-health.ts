import { useSyncExternalStore } from 'react';
import {
  getDeviceHealthSnapshot,
  subscribeDeviceHealth,
  type DeviceHealthSnapshot,
} from './device-health.js';

/** Live Apple Health state of this device (see device-health.ts). */
export function useDeviceHealth(): DeviceHealthSnapshot {
  return useSyncExternalStore(
    subscribeDeviceHealth,
    getDeviceHealthSnapshot,
    getDeviceHealthSnapshot,
  );
}
