/**
 * Imported first by the CLI entry: on an older Node the failures are cryptic
 * (`node:sqlite` missing, undici's `markAsUncloneable is not a function`), so
 * say what is wrong before anything else loads.
 */
export const MIN_NODE_VERSION = [22, 19, 0] as const;

export function isSupportedNode(version: string): boolean {
  const parts = version.replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < MIN_NODE_VERSION.length; index += 1) {
    const actual = parts[index] ?? 0;
    const wanted = MIN_NODE_VERSION[index] ?? 0;
    if (actual !== wanted) return actual > wanted;
  }
  return true;
}

if (!isSupportedNode(process.versions.node)) {
  process.stderr.write(
    `piwin 需要 Node ${MIN_NODE_VERSION.join('.')} 或更新版本，当前是 ${process.versions.node}。\n` +
      `piwin requires Node >= ${MIN_NODE_VERSION.join('.')} (found ${process.versions.node}); see .nvmrc.\n`,
  );
  process.exit(1);
}
