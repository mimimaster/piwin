import type { HostPathStyle } from './host-platform.js';

/** User-initiated creation in the Host file picker, never an agent tool write. */
export type HostCreateEntryInput = {
  parentPath: string;
  name: string;
  kind: 'directory' | 'file';
};

export type HostEntryProblemCode =
  | 'host-entry-invalid-name'
  | 'host-entry-already-exists'
  | 'host-entry-permission-denied'
  | 'host-entry-not-directory'
  | 'host-entry-create-failed';

/** Only a single child name is allowed, irrespective of the client's OS. */
export function isValidHostEntryName(name: unknown, style: HostPathStyle): name is string {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..' || /[/\\\u0000-\u001f\u007f]/.test(name)) return false;
  if (style === 'windows') {
    if (/[<>:"|?*]/.test(name) || /[. ]$/.test(name)) return false;
    if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) return false;
  }
  return true;
}
