/**
 * Host-owned Pi runtime directory for auth.json / models.json.
 * Inventory (skills, SYSTEM.md) stays at ~/.pi/agent; this path follows the
 * product root so test-host and production do not share subscription OAuth.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PIWIN_PI_AGENT_DIR_ENV = 'PIWIN_PI_AGENT_DIR';
export const PIWIN_PI_AGENT_DIRNAME = 'pi-agent';

export function resolvePiRuntimeAgentDir(override?: string): string {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }
  const fromEnv = process.env[PIWIN_PI_AGENT_DIR_ENV]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const piwinRoot = process.env.PIWIN_ROOT?.trim();
  if (piwinRoot) {
    return join(piwinRoot, PIWIN_PI_AGENT_DIRNAME);
  }
  return join(homedir(), '.piwin', PIWIN_PI_AGENT_DIRNAME);
}
