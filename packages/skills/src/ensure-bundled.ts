/**
 * Bundled skills are not installed into ~/.piwin/skills.
 *
 * Authority is the product tree: repo `skills/` in development, or
 * `$PIWIN_BUNDLED_ASSETS_ROOT/skills` in a packaged host. Pi and the catalog
 * load that tree directly. `~/.piwin/skills` is only for user-installed skills.
 *
 * Kept as a no-op so older CLI / Host call sites stay valid.
 */
export async function ensureBundledSkillsInstalled(
  _piwinRoot: string,
  _bundledRoot?: string,
): Promise<string[]> {
  return [];
}
