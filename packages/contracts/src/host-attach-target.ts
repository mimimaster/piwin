import type { TrustedDeviceCredential } from './remote.js';

/** A shell attaches to this Host; credentials travel outside command arguments. */
export type HostAttachTarget = {
  endpoint: string;
  authToken?: string;
  deviceCredential?: TrustedDeviceCredential;
};
