/**
 * Pure skills-config edit for mapping / unmapping an external skill root.
 * Returns undefined when the config already matches, so callers skip a write.
 */
import type { SkillsConfig } from '@piwin/contracts';

export function nextSkillsConfigForMapping(
  current: SkillsConfig | undefined,
  path: string,
  mapped: boolean,
): SkillsConfig | undefined {
  const extraPaths = current?.extraPaths ?? [];
  const has = extraPaths.includes(path);
  if (has === mapped) return undefined;
  return {
    extraPaths: mapped ? [...extraPaths, path] : extraPaths.filter((entry) => entry !== path),
    disabledIds: current?.disabledIds ?? [],
  };
}
