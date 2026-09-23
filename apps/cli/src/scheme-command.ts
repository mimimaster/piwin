import { getPiwinRoot, loadPiwinConfig } from '@piwin/host-runtime';

/**
 * `piwin scheme` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandScheme(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  const { listOrchestrationSchemes, resolveOrchestrationScheme } = await import('@piwin/contracts');
  const slice = {
    schemes: config.subagents?.schemes,
    maxConcurrency: config.subagents?.maxConcurrency,
    maxTasksPerRun: config.subagents?.maxTasksPerRun,
  };
  const schemes = listOrchestrationSchemes(slice);

  if (sub === 'list') {
    console.log('Off  (default — freehand, no injection)');
    for (const scheme of schemes) {
      const source = scheme.source === 'builtin' ? 'builtin' : 'settings';
      console.log(`${scheme.id}  [${source}]  ${scheme.name} — ${scheme.description}`);
    }
    return;
  }

  if (sub === 'show') {
    const id = argv[2];
    if (!id) {
      console.error('Usage: piwin scheme show <id>');
      process.exitCode = 1;
      return;
    }
    if (id === 'off') {
      console.log('id: off');
      console.log('name: Off');
      console.log('description: Freehand — no orchestration injection');
      return;
    }
    try {
      // Validate against known profiles when possible (best-effort without host).
      const known = new Set(
        (config.subagents?.profiles ?? [])
          .map((profile) => profile.id)
          .concat(['explorer', 'reviewer', 'implementer', 'tester']),
      );
      const resolved = resolveOrchestrationScheme(slice, id, { knownProfileIds: known });
      if (!resolved) {
        console.error(`Unknown scheme: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`id: ${resolved.schemeId}`);
      console.log(`name: ${resolved.scheme.name}`);
      console.log(`source: ${resolved.scheme.source}`);
      console.log(`description: ${resolved.scheme.description}`);
      console.log(`defaultRole: ${resolved.defaultRole}`);
      console.log(`defaultProfileId: ${resolved.defaultProfileId}`);
      console.log(`exposeSpawnMetadata: ${resolved.exposeSpawnMetadata}`);
      console.log('members:');
      for (const member of resolved.members) {
        const modelLabel = member.model
          ? `${member.model.providerId}/${member.model.modelId}`
          : 'inherit';
        const avail = member.available
          ? 'available'
          : `UNAVAILABLE(${member.unavailableReason ?? '?'})`;
        console.log(
          `  - ${member.role} [${avail}] profile=${member.profileId ?? '-'} model=${modelLabel} ` +
            `isolation=${member.isolation ?? '-'} thinking=${member.thinkingLevel ?? '-'} fallback=${member.fallback}`,
        );
        console.log(`    ${member.description}`);
      }
      console.log(`maxConcurrency: ${resolved.maxConcurrency}`);
      console.log(`maxTasksPerRun: ${resolved.maxTasksPerRun}`);
      console.log(`waitPolicy: ${resolved.waitPolicy}`);
      if (resolved.maxSubagentThinkingLevel) {
        console.log(`maxSubagentThinkingLevel: ${resolved.maxSubagentThinkingLevel}`);
      }
      console.log('systemPreamble:');
      console.log(resolved.systemPreamble);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  console.error('Usage: piwin scheme list | show <id>');
  process.exitCode = 1;
}
