/**
 * Pure helpers for resolving known project options and updating per-project
 * system-prompt preset bindings in `PiwinConfig.systemPrompts`.
 */
import {
  createDefaultSystemPromptsConfig,
  SYSTEM_PROMPT_INHERIT_ID,
  type PiwinConfig,
  type ProjectRecord,
} from '@piwin/contracts';
import { projectLabel } from '../../sidebar/project-display-name';

export const SYSTEM_PROMPT_BROWSE_PROJECT_VALUE = '__browse_project__';

export type SystemPromptProjectOption = {
  path: string;
  baseLabel: string;
  displayLabel: string;
  isCurrent: boolean;
  assignedPresetId?: string;
};

function immediateParentSegment(projectPath: string): string | undefined {
  const segments = projectPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : undefined;
}

/**
 * Builds ordered, deduplicated project options across the current workspace,
 * recent projects, configured project bindings, and user-browsed folders.
 */
export function buildSystemPromptProjectOptions(input: {
  currentProjectPath: string | null;
  recentProjects: readonly ProjectRecord[];
  projectPresetIds?: Readonly<Record<string, string>> | undefined;
  extraProjectPaths?: readonly string[] | undefined;
}): SystemPromptProjectOption[] {
  const currentPath = input.currentProjectPath?.trim() || null;
  const seen = new Set<string>();
  const orderedPaths: string[] = [];

  const pushPath = (rawPath: string | null | undefined): void => {
    const trimmed = rawPath?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    orderedPaths.push(trimmed);
  };

  pushPath(currentPath);
  for (const project of input.recentProjects) {
    pushPath(project.path);
  }
  for (const configuredPath of Object.keys(input.projectPresetIds ?? {})) {
    pushPath(configuredPath);
  }
  for (const extraPath of input.extraProjectPaths ?? []) {
    pushPath(extraPath);
  }

  const baseLabels = orderedPaths.map((path) => projectLabel(path, input.recentProjects));
  const labelCounts = new Map<string, number>();
  for (const label of baseLabels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return orderedPaths.map((path, index) => {
    const baseLabel = baseLabels[index] ?? path;
    const isDuplicate = (labelCounts.get(baseLabel) ?? 0) > 1;
    const parent = isDuplicate ? immediateParentSegment(path) : undefined;
    const displayLabel = isDuplicate ? (parent ? `${baseLabel} (${parent})` : path) : baseLabel;
    const assigned = input.projectPresetIds?.[path]?.trim();
    return {
      path,
      baseLabel,
      displayLabel,
      isCurrent: currentPath !== null && path === currentPath,
      ...(assigned ? { assignedPresetId: assigned } : {}),
    };
  });
}

export function formatProjectOptionLabel(
  option: SystemPromptProjectOption,
  isZh: boolean,
): string {
  if (!option.isCurrent) {
    return option.displayLabel;
  }
  return isZh ? `${option.displayLabel}（当前）` : `${option.displayLabel} (Current)`;
}

export function listBoundProjectsForPreset(
  options: readonly SystemPromptProjectOption[],
  presetId: string,
): SystemPromptProjectOption[] {
  return options.filter((item) => item.assignedPresetId === presetId);
}

export function applyProjectPresetBinding(
  config: PiwinConfig,
  targetProjectPath: string,
  nextPresetId: string,
): PiwinConfig {
  const trimmedPath = targetProjectPath.trim();
  if (!trimmedPath) {
    return config;
  }
  const systemPrompts = config.systemPrompts ?? createDefaultSystemPromptsConfig();
  const nextProjects = { ...(systemPrompts.projectPresetIds ?? {}) };
  if (nextPresetId === SYSTEM_PROMPT_INHERIT_ID) {
    delete nextProjects[trimmedPath];
  } else {
    nextProjects[trimmedPath] = nextPresetId;
  }
  const { projectPresetIds: _prev, ...rest } = systemPrompts;
  return {
    ...config,
    systemPrompts:
      Object.keys(nextProjects).length > 0
        ? { ...rest, projectPresetIds: nextProjects }
        : rest,
  };
}
