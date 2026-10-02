import type { PermissionMode } from '@piwin/contracts';

export function getInheritedPermissionOverride(
  overrides: ReadonlyMap<string, PermissionMode>,
  sessionId: string,
  parentSessionId?: string,
): PermissionMode | undefined {
  return overrides.get(sessionId) ?? (parentSessionId ? overrides.get(parentSessionId) : undefined);
}

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
  const selectedMode = input.sessionOverride ?? input.cliOverride ?? input.configMode;
  // Composer and children still speak the three presets. A YOLO session follows
  // the operator's live true-YOLO toggle; explicit Auto/Ask/CLI modes stay intact.
  const mode = selectedMode === 'bypass' && input.configMode === 'unrestricted' &&
    input.cliOverride === undefined
    ? 'unrestricted'
    : selectedMode;
  const untrustedProject = Boolean(input.projectPath) && input.projectTrusted !== true;
  if (mode === 'bypass' && untrustedProject) {
    return 'auto';
  }
  return mode;
}
