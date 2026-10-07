/**
 * Decide which extension owns a compaction when several hook it.
 *
 * Pi calls every `session_before_compact` handler in extension load order and
 * keeps the last result, so two compaction extensions both summarize and the
 * alphabetically later path silently wins. piwin wants a deterministic rule:
 * preferred (bundled, model-scoped) extensions answer first, the remaining
 * ones only run when nobody before them took the compaction.
 */

const COMPACTION_HOOK_EVENT = 'session_before_compact';

type CompactionHookHandler = (event: unknown, ctx: unknown) => unknown;

type CompactionHookExtension = {
  path: string;
  handlers: Map<string, CompactionHookHandler[]>;
};

function readLoadedExtensions(resourceLoader: unknown): CompactionHookExtension[] {
  const getExtensions = (resourceLoader as { getExtensions?: unknown } | undefined)?.getExtensions;
  if (typeof getExtensions !== 'function') return [];
  const extensions = (getExtensions.call(resourceLoader) as { extensions?: unknown } | undefined)
    ?.extensions;
  if (!Array.isArray(extensions)) return [];
  return extensions.filter(
    (extension): extension is CompactionHookExtension =>
      typeof extension === 'object' &&
      extension !== null &&
      typeof (extension as { path?: unknown }).path === 'string' &&
      (extension as { handlers?: unknown }).handlers instanceof Map,
  );
}

function takesCompaction(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const decision = result as { cancel?: unknown; compaction?: unknown };
  return decision.cancel === true || decision.compaction !== undefined;
}

function isUnderPath(extensionPath: string, rootPath: string): boolean {
  return extensionPath === rootPath || extensionPath.startsWith(`${rootPath}/`);
}

/**
 * Collapse all compaction hooks into one first-wins chain. Extensions under
 * `preferredExtensionPaths` go first; each group keeps its load order. A
 * handler that throws is logged and skipped, matching Pi's own runner.
 */
export function prioritizeCompactionHooks(
  resourceLoader: unknown,
  preferredExtensionPaths: readonly string[],
): void {
  const owners = readLoadedExtensions(resourceLoader).filter(
    (extension) => (extension.handlers.get(COMPACTION_HOOK_EVENT)?.length ?? 0) > 0,
  );
  const [chainHost] = owners;
  if (!chainHost || owners.length < 2) return;

  const isPreferred = (extension: CompactionHookExtension): boolean =>
    preferredExtensionPaths.some((rootPath) => isUnderPath(extension.path, rootPath));
  const chain = [
    ...owners.filter(isPreferred),
    ...owners.filter((extension) => !isPreferred(extension)),
  ].flatMap((extension) =>
    (extension.handlers.get(COMPACTION_HOOK_EVENT) ?? []).map((handler) => ({
      extensionPath: extension.path,
      handler,
    })),
  );

  const runChain: CompactionHookHandler = async (event, ctx) => {
    for (const { extensionPath, handler } of chain) {
      try {
        const result = await handler(event, ctx);
        if (takesCompaction(result)) return result;
      } catch (error) {
        console.warn(`[piwin-agent-host] extension ${extensionPath} compaction hook failed`, error);
      }
    }
    return undefined;
  };

  for (const extension of owners) {
    extension.handlers.delete(COMPACTION_HOOK_EVENT);
  }
  chainHost.handlers.set(COMPACTION_HOOK_EVENT, [runChain]);
}
