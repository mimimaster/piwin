import type { PermissionMode } from '@piwin/contracts';

/**
 * Resolve the admission-gate PermissionMode for a generation.
 *
 * Untrusted projects cannot run YOLO (`bypass`); the host downgrades to `auto`.
 * Session overrides (Plan/Ask floor) still win when they are stricter.
 */
export function effectivePermissionMode(input: {
  sessionOverride?: PermissionMode;
  cliOverride?: PermissionMode;
  configMode: PermissionMode;
  projectPath?: string;
  projectTrusted: boolean;
}): PermissionMode {
  const mode = input.sessionOverride ?? input.cliOverride ?? input.configMode;
  const untrustedProject = Boolean(input.projectPath) && input.projectTrusted !== true;
  if (mode === 'bypass' && untrustedProject) {
    return 'auto';
  }
  return mode;
}
