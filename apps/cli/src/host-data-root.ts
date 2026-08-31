import { homedir } from 'node:os';
import { join } from 'node:path';
import { getPiwinRoot } from '@piwin/host-runtime';

/** Resolve the data root for the Host entry points. */
export function resolveHostDataRoot(): string {
  // The bundled Desktop is the local all-in-one product. Its Host must always
  // use the current user's default root, even if the launcher inherited the
  // test Host's PIWIN_ROOT.
  if (process.env.PIWIN_DESKTOP_BUNDLED === '1') {
    return join(homedir(), '.piwin');
  }
  return getPiwinRoot();
}
