/**
 * Pure skills-config edits for mapping external skill roots and excluding or
 * restoring mapped skill ids. Returns undefined when config already matches.
 */
import { WELL_KNOWN_SKILL_PATH_PRESETS, type SkillsConfig } from '@piwin/contracts';

const PRESET_BY_PATH = new Map(
  WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => [preset.path, preset]),
);

export function nextSkillsConfigForMapping(
  current: SkillsConfig | undefined,
  path: string,
  mapped: boolean,
): SkillsConfig | undefined {
  const extraPaths = current?.extraPaths ?? [];
  const has = extraPaths.includes(path);
  if (has === mapped) return undefined;
  const excludedIds = current?.excludedIds;
  return {
    extraPaths: mapped ? [...extraPaths, path] : extraPaths.filter((entry) => entry !== path),
    disabledIds: current?.disabledIds ?? [],
    ...(excludedIds && excludedIds.length > 0 ? { excludedIds } : {}),
  };
}

export function nextSkillsConfigForExcludedIds(
  current: SkillsConfig | undefined,
  skillIds: readonly string[],
  excluded: boolean,
): SkillsConfig | undefined {
  const normalizedTargets: string[] = [];
  const targetSet = new Set<string>();
  for (const raw of skillIds) {
    const normalized = raw.trim().toLowerCase();
    if (!normalized || targetSet.has(normalized)) continue;
    targetSet.add(normalized);
    normalizedTargets.push(normalized);
  }
  if (normalizedTargets.length === 0) return undefined;

  const existing = current?.excludedIds ?? [];
  const existingKeys = new Set(existing.map((entry) => entry.trim().toLowerCase()));
  let nextExcluded: string[];
  if (excluded) {
    const additions = normalizedTargets.filter((id) => !existingKeys.has(id));
    if (additions.length === 0) return undefined;
    nextExcluded = [...existing, ...additions];
  } else {
    nextExcluded = existing.filter((entry) => !targetSet.has(entry.trim().toLowerCase()));
    if (nextExcluded.length === existing.length) return undefined;
  }

  return {
    extraPaths: current?.extraPaths ?? [],
    disabledIds: current?.disabledIds ?? [],
    ...(nextExcluded.length > 0 ? { excludedIds: nextExcluded } : {}),
  };
}

export function isPresetSkillPath(path: string): boolean {
  return PRESET_BY_PATH.has(path);
}

export function shortSkillPathLabel(path: string): string {
  const preset = PRESET_BY_PATH.get(path);
  if (preset) return preset.label;
  return path;
}
