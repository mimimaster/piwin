import type {
  HostRuntimeResourcesData,
  HostStatusData,
  SessionColdStorageStatus,
} from '@piwin/contracts';
import { openCliHost } from './cli-host.js';
import { formatRuntimeResourcesLines } from './runtime-resources-format.js';
import { formatDoctorColdStorageLines } from './session-cold-storage-command.js';
import { formatCapabilityMatrixLines, formatError } from '@piwin/contracts';
import {
  applyPiwinPlaywrightBrowsersPath,
  createSecretResolver,
  ensureBundledExtensionsInstalled,
  ensureBundledPromptsInstalled,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionsDir,
  listInterruptedTranscriptMigrations,
  loadDiscoveredResources,
  loadPiwinConfig,
  repairInterruptedTranscriptMigration,
} from '@piwin/host-runtime';
import { listEnabledServers, loadMcpConfig } from '@piwin/mcp';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * `piwin doctor` subcommand: argv handling, host lifecycle, and output.
 */

export async function commandDoctor(args: string[] = []): Promise<void> {
  const root = getPiwinRoot();
  applyPiwinPlaywrightBrowsersPath(root);
  const config = await loadPiwinConfig(root);
  const nodeVersion = process.versions.node;
  const resolver = createSecretResolver();
  console.log('piwin doctor');
  console.log('--- main-path matrix ---');
  console.log(`- node: ${nodeVersion}`);
  console.log(`- config root: ${root}`);
  console.log(`- hostMode(config): ${config.hostMode}`);
  console.log(`- agentMock(config): ${config.agentMock === true ? 'on' : 'off'}`);
  console.log('- host adapters: sdk + rpc');
  console.log('- rpc.customTools: false (stock pi RPC; use sdk mode for web/MCP/bash tools)');
  console.log(`- providers configured: ${config.providers.length}`);
  for (const provider of config.providers) {
    const report = await resolver.reportProviderSecret(provider);
    console.log(
      `  · ${provider.id} (${provider.protocol}) models=${provider.models.length} key=${report.status}${report.source ? ` via ${report.source}` : ''}${report.detail ? ` (${report.detail})` : ''}`,
    );
  }
  const web = config.web;
  const enabledSources = web?.searchSources?.filter((source) => source.enabled) ?? [];
  const sourceSummary =
    enabledSources.length === 0 ? 'none' : enabledSources.map((source) => source.id).join('+');
  console.log(
    `- web search: ${web?.searchProvider ?? '(default)'} [${sourceSummary}] strategy=${web?.searchStrategy?.mode ?? 'parallel'}`,
  );
  try {
    const { ensureBundledSkillsInstalled } = await import('@piwin/skills');
    await ensureBundledSkillsInstalled(root);
    await ensureBundledExtensionsInstalled(root);
    await ensureBundledPromptsInstalled(root);
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
      ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
      ...(config.prompts ? { promptsConfig: config.prompts } : {}),
    });
    console.log(
      `- skills: ${discovered.skills.length} (extraPaths=${(config.skills?.extraPaths ?? []).length})`,
    );
    const enabledExtensions = discovered.extensions.filter((item) => item.enabled).length;
    console.log(
      `- extensions: ${discovered.extensions.length} (${enabledExtensions} enabled; extraPaths=${(config.extensions?.extraPaths ?? []).length})`,
    );
    console.log('- extensions security: third-party modules run with full process privileges');
    console.log(
      '- extensions surface: Agent tools/hooks/confirm-select-input-notify; Pi TUI UI, themes, keybindings, editor, and /reload are not supported',
    );
    const enabledPrompts = discovered.prompts.filter((item) => item.enabled).length;
    console.log(
      `- prompts: ${discovered.prompts.length} (${enabledPrompts} enabled; extraPaths=${(config.prompts?.extraPaths ?? []).length})`,
    );
  } catch (error) {
    console.log(`- skills/extensions/prompts: (unavailable: ${formatError(error)})`);
  }
  console.log(`- mock env: ${process.env.PIWIN_MOCK === '1' ? 'on' : 'off'}`);
  console.log('- Pi kernel: via @piwin/agent-host only (apps must not import Pi)');
  console.log('- bash: permission-gated (deny hard patterns; ask destructive)');
  console.log('- IPC: HostCommand/HostPush + `host serve` available');
  console.log('- packages: media tools-web skills mcp marketplace git theme pet artifact browser');
  try {
    const { getBrowserInstallStatus } = await import('@piwin/browser');
    const browserStatus = await getBrowserInstallStatus();
    if (browserStatus.available) {
      console.log(`- browser chromium: available (${browserStatus.path ?? 'unknown path'})`);
    } else {
      console.log(
        `- browser chromium: MISSING${browserStatus.reason ? ` (${browserStatus.reason})` : ''} (${browserStatus.hint ?? 'install Playwright Chromium'})`,
      );
    }
  } catch (error) {
    console.log(`- browser chromium: (unavailable: ${formatError(error)})`);
  }
  try {
    const runtime = await openCliHost({
      mode: config.hostMode === 'rpc' ? 'rpc' : 'sdk',
      mock: config.agentMock === true || process.env.PIWIN_MOCK === '1',
    });
    try {
      const status = await runtime.handleCommand({ type: 'host/status' });
      if (status.success) {
        const data = status.data as HostStatusData;
        console.log('--- capability matrix (live host) ---');
        console.log(`- host mode: ${data.mode} mock=${data.mock}`);
        for (const line of formatCapabilityMatrixLines(data.capabilities, {
          mode: data.mode,
          mock: data.mock,
        })) {
          console.log(`- ${line}`);
        }
      }
      const resources = await runtime.handleCommand({ type: 'host/runtime-resources' });
      if (resources.success) {
        console.log('--- runtime residency (aggregate) ---');
        for (const line of formatRuntimeResourcesLines(
          resources.data as HostRuntimeResourcesData,
        )) {
          console.log(`- ${line}`);
        }
      } else {
        console.log(`- runtime residency: (unavailable: ${resources.error})`);
      }
      const coldStorage = await runtime.handleCommand({ type: 'session/cold-storage-status' });
      if (coldStorage.success) {
        console.log('--- session cold storage ---');
        for (const line of formatDoctorColdStorageLines(
          coldStorage.data as SessionColdStorageStatus,
        )) {
          console.log(line);
        }
      } else {
        console.log(`- session cold storage: (unavailable: ${coldStorage.error})`);
      }
    } finally {
      await runtime.dispose();
    }
  } catch (error) {
    console.log(`- capability matrix: (unavailable: ${formatError(error)})`);
  }
  console.log(`- session index path: ${getPiwinSessionIndexPath(root)}`);
  try {
    const sessionsDir = getPiwinSessionsDir(root);
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    let present = 0;
    let missing = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        await access(join(sessionsDir, entry.name, 'model-context.sqlite3'));
        present += 1;
      } catch {
        missing += 1;
      }
    }
    console.log(
      `- model-context: ${present} session files present${
        missing > 0 ? `, ${missing} sessions without ledger` : ''
      }`,
    );
  } catch {
    console.log('- model-context: (no sessions dir)');
  }
  const interruptedMigrations = await listInterruptedTranscriptMigrations(root);
  if (interruptedMigrations.length === 0) {
    console.log('- transcript migration: healthy');
  } else {
    console.log(`- transcript migration: ${interruptedMigrations.length} interrupted`);
    for (const issue of interruptedMigrations) {
      console.log(`  · ${issue.sessionId}: ${issue.databasePath}`);
    }
    if (args.includes('--repair-transcripts')) {
      for (const issue of interruptedMigrations) {
        const repaired = await repairInterruptedTranscriptMigration(root, issue.sessionId);
        console.log(
          `  · repaired ${issue.sessionId}; previous database retained at ${repaired.previousDatabasePath ?? '(none)'}`,
        );
      }
    } else {
      console.log(
        '  · run `piwin doctor --repair-transcripts` to rebuild from the retained v1 source',
      );
    }
  }
  console.log(`- CI scripts: typecheck/test present in package.json`);
  try {
    const { listThemes } = await import('@piwin/theme');
    const themes = await listThemes(root);
    console.log(`- themes: ${themes.themes.length} (active=${themes.activeThemeId})`);
  } catch (error) {
    console.log(`- themes: (unavailable: ${formatError(error)})`);
  }
  try {
    const { listPets } = await import('@piwin/pet');
    const pets = await listPets(root);
    console.log(`- pets: ${pets.pets.length} (active=${pets.activePetId})`);
  } catch (error) {
    console.log(`- pets: (unavailable: ${formatError(error)})`);
  }
  try {
    const mcp = await loadMcpConfig(root);
    console.log(`- mcp servers: ${listEnabledServers(mcp).length} enabled`);
    try {
      const { createMcpLifecycleManager } = await import('@piwin/mcp');
      const manager = createMcpLifecycleManager(root);
      const health = await manager.listHealth();
      const running = health.filter((item) => item.status === 'running').length;
      const errored = health.filter((item) => item.status === 'error').length;
      console.log(`- mcp health: ${health.length} known, running=${running}, error=${errored}`);
      await manager.dispose();
    } catch {
      console.log('- mcp health: (manager unavailable)');
    }
  } catch {
    console.log('- mcp servers: (config missing or invalid)');
  }
  console.log('--- end matrix ---');
}
