#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  createAgentHost,
  getPiwinRoot,
  getPiwinMediaDir,
  HostRuntime,
  type HostRuntimeTestFixture,
  initPiwinConfig,
  loadPiwinConfig,
  savePiwinConfig,
  ensureBundledExtensionsInstalled,
  scanExtensions,
  ensureBundledPromptsInstalled,
  scanPrompts,
  createSecretResolver,
  getPiwinSessionIndexPath,
} from '@piwin/agent-host';
import type {
  AgentEvent,
  HostCommand,
  HostMode,
  HostServerMessage,
  HostStatusData,
  PermissionMode,
  UsageRollup,
} from '@piwin/contracts';
import { formatCapabilityMatrixLines } from '@piwin/contracts';
import { formatTextModelImageInjection } from '@piwin/contracts';
import { ensureBundledSkillsInstalled, scanSkills } from '@piwin/skills';
import { loadMcpConfig, saveMcpConfig, tryValidateMcpConfig, listEnabledServers } from '@piwin/mcp';
import { installSkill, installExtension, RECOMMENDED_SKILLS } from '@piwin/marketplace';
import { createMediaService } from '@piwin/media';
import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import { createJsonlWriter } from './host-serve-jsonl-writer.js';
import { createHostServeStreamBatcher } from './host-serve-stream-batcher.js';
import { parsePermissionModeOverride } from './permission-mode-override.js';

function printHelp(): void {
  console.log(`piwin — private coding agent shell

Usage:
  piwin doctor
  piwin host-mode
  piwin config init
  piwin config show
  piwin session list [--project <path>] [--mock]
  piwin session pin <sessionId> [--mock]
  piwin session unpin <sessionId> [--mock]
  piwin session search <query> [--project <path>] [--mock]
  piwin session export <id> --format md|html [--redact-tools] [--out <path>] [--mock]
  piwin status [--project <path>] [--mock]
  piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass]
  piwin host serve [--mode sdk|rpc] [--mock] [--test-fixture <name>] [--permission-mode auto|ask-all|bypass]
  piwin skill list [--project <path>]
  piwin skill install --local <dir> | --git <url> [--name <id>]
  piwin skill ensure-bundled
  piwin extension list [--project <path>]
  piwin extension ensure-bundled
  piwin extension install --local <file|dir> | --git <url> [--name <id>]
  piwin prompt list [--project <path>]
  piwin mcp list
  piwin mcp validate [path]
  piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]
  piwin notes add <content> --title <t> [--collection c] [--tags a,b]
  piwin notes list [--collection c]
  piwin notes search <query> [--collection c] [--limit n] [--search-mode auto|fts|vector|hybrid]
  piwin notes show <id> | delete <id> | reindex
  piwin notes pin <query> <noteId...>       (add golden eval case)
  piwin notes eval [--k 5] [--verbose] | eval history
  piwin cards add <front> --back <b> [--deck d] [--tags a,b]
  piwin cards list [--deck d] | decks | show <id> | delete <id>
  piwin cards due [--deck d]
  piwin cards review [--deck d]             (interactive FSRS loop)
  piwin cards export [--deck d] [--out <path>]   (Anki TSV)
  piwin doccards scan <folder>
  piwin doccards index <folder>
  piwin doccards retrieve <folder> <query> [--limit n]
  piwin doccards list <folder>
  piwin doccards generate <folder> [--topic t] [--limit n]   (print generation prompt)
  piwin doccards rebind <oldPath> <newPath>
  piwin doccards forget <folder>
  piwin cron list [--mock]
  piwin usage [--project <path> | --global] [--mock]

Host modes: sdk | rpc
Offline: --mock or PIWIN_MOCK=1
host serve: JSONL IPC on stdin/stdout for desktop sidecar
test fixture: harness-only delayed session; rejected outside NODE_ENV=test
`);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

/** Positional tokens, excluding flags and the value tokens of the given options. */
function collectPositionals(tokens: string[], valueOptions: string[]): string[] {
  const positionals: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.startsWith('--')) {
      if (valueOptions.includes(token)) {
        index += 1; // skip the option's value
      }
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

function parseMode(argv: string[]): HostMode {
  const value = readOption(argv, '--mode');
  return value === 'rpc' ? 'rpc' : 'sdk';
}

/** Explicit --project path, or null when the user did not pass --project. */
function parseOptionalProject(argv: string[]): string | null {
  const value = readOption(argv, '--project');
  if (!value) {
    return null;
  }
  return resolve(value);
}

/** Legacy helper: --project or process.cwd() for project-bound commands. */
function parseProject(argv: string[]): string {
  return parseOptionalProject(argv) ?? resolve(process.cwd());
}

function parseMock(argv: string[]): boolean {
  return hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
}

/**
 * Parse the session-level permission mode override (ADR 0019 §3) and emit the
 * stderr warning when the dangerous alias is used. Returns `undefined` when
 * neither flag is present so the configured `config.permissions.mode` applies.
 */
function resolvePermissionModeOverride(argv: string[]): PermissionMode | undefined {
  const result = parsePermissionModeOverride(argv);
  if (result.fromDangerousAlias) {
    console.error(
      '[piwin] --dangerously-bypass-permissions: bypassing all permission prompts for this session.',
    );
  }
  return result.mode;
}

function parseHostServeTestFixture(argv: string[]): HostRuntimeTestFixture | undefined {
  const value = readOption(argv, '--test-fixture') ?? process.env.PIWIN_HOST_TEST_FIXTURE;
  if (value === undefined) {
    return undefined;
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('--test-fixture is available only when NODE_ENV=test');
  }
  if (
    value === 'hang-until-abort' ||
    value === 'slow-first-token' ||
    value === 'high-rate-tool-output'
  ) {
    return value;
  }
  throw new Error(`Unknown host test fixture: ${value}`);
}

function formatEvent(event: AgentEvent): string | null {
  switch (event.type) {
    case 'message/text_delta':
      return event.delta;
    case 'message/thinking_delta':
      return `\n[thinking] ${event.delta}`;
    case 'tool/start':
      return `\n[tool:${event.toolName} start ${event.toolCallId}]\n`;
    case 'tool/update':
      return event.delta ? `[tool] ${event.delta}\n` : null;
    case 'tool/end':
      return `[tool end ${event.toolCallId} ${event.isError ? 'error' : 'ok'}]\n`;
    case 'error':
      return `\n[error] ${event.message}\n`;
    case 'permission/request':
      return `\n[permission ${event.defaultDecision}] ${event.action}: ${event.detail}\n`;
    case 'usage/update': {
      const usage = event.usage;
      const used = usage.tokensUsed ?? usage.totalTokens;
      const limit = usage.tokensLimit;
      if (typeof used === 'number' && typeof limit === 'number') {
        return `\n[usage] ${used}/${limit} tokens\n`;
      }
      if (typeof used === 'number') {
        return `\n[usage] ${used} tokens\n`;
      }
      return `\n[usage] unknown\n`;
    }
    default:
      return null;
  }
}

async function commandDoctor(): Promise<void> {
  const root = getPiwinRoot();
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
  console.log(`- web searchProvider: ${config.web?.searchProvider ?? '(default)'}`);
  try {
    const { scanSkills, ensureBundledSkillsInstalled } = await import('@piwin/skills');
    await ensureBundledSkillsInstalled(root);
    const skills = await scanSkills({
      piwinRoot: root,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    });
    console.log(
      `- skills: ${skills.length} (extraPaths=${(config.skills?.extraPaths ?? []).length})`,
    );
  } catch (error) {
    console.log(
      `- skills: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    await ensureBundledExtensionsInstalled(root);
    const extensions = await scanExtensions({
      piwinRoot: root,
      ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    });
    const enabledCount = extensions.filter((item) => item.enabled).length;
    console.log(
      `- extensions: ${extensions.length} (${enabledCount} enabled; extraPaths=${(config.extensions?.extraPaths ?? []).length})`,
    );
    console.log('- extensions security: third-party modules run with full process privileges');
  } catch (error) {
    console.log(
      `- extensions: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    await ensureBundledPromptsInstalled(root);
    const prompts = await scanPrompts({
      piwinRoot: root,
      ...(config.prompts ? { promptsConfig: config.prompts } : {}),
    });
    const enabledCount = prompts.filter((item) => item.enabled).length;
    console.log(
      `- prompts: ${prompts.length} (${enabledCount} enabled; extraPaths=${(config.prompts?.extraPaths ?? []).length})`,
    );
  } catch (error) {
    console.log(
      `- prompts: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  console.log(`- mock env: ${process.env.PIWIN_MOCK === '1' ? 'on' : 'off'}`);
  console.log('- Pi kernel: via @piwin/agent-host only (apps must not import Pi)');
  console.log('- bash: permission-gated (deny hard patterns; ask destructive)');
  console.log('- IPC: HostCommand/HostPush + `host serve` available');
  console.log('- packages: media tools-web skills mcp marketplace git theme pet artifact browser');
  try {
    const { getBrowserInstallStatus } = await import('@piwin/browser');
    const browserStatus = getBrowserInstallStatus();
    if (browserStatus.available) {
      console.log(`- browser chromium: available (${browserStatus.path ?? 'unknown path'})`);
    } else {
      console.log(
        `- browser chromium: MISSING (${browserStatus.hint ?? 'run pnpm --dir apps/desktop e2e:install'})`,
      );
    }
  } catch (error) {
    console.log(
      `- browser chromium: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    const runtime = new HostRuntime({
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
    } finally {
      await runtime.dispose();
    }
  } catch (error) {
    console.log(
      `- capability matrix: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  console.log(`- session index path: ${getPiwinSessionIndexPath(root)}`);
  console.log(`- CI scripts: typecheck/test present in package.json`);
  try {
    const { listThemes } = await import('@piwin/theme');
    const themes = await listThemes(root);
    console.log(`- themes: ${themes.themes.length} (active=${themes.activeThemeId})`);
  } catch (error) {
    console.log(
      `- themes: (unavailable: ${error instanceof Error ? error.message : String(error)})`,
    );
  }
  try {
    const { listPets } = await import('@piwin/pet');
    const pets = await listPets(root);
    console.log(`- pets: ${pets.pets.length} (active=${pets.activePetId})`);
  } catch (error) {
    console.log(`- pets: (unavailable: ${error instanceof Error ? error.message : String(error)})`);
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

async function commandHostMode(): Promise<void> {
  const sdkHost = createAgentHost({ mode: 'sdk', mock: true });
  const rpcHost = createAgentHost({ mode: 'rpc', mock: true });
  console.log(`sdk adapter mode=${sdkHost.mode}`);
  console.log(`rpc adapter mode=${rpcHost.mode}`);
  await sdkHost.dispose();
  await rpcHost.dispose();
}

async function commandConfig(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'show';
  if (sub === 'init') {
    const result = await initPiwinConfig();
    console.log(result.created ? `created ${result.path}` : `already exists ${result.path}`);
    return;
  }
  if (sub === 'show') {
    const root = getPiwinRoot();
    const config = await loadPiwinConfig(root);
    console.log(JSON.stringify({ root, config }, null, 2));
    return;
  }
  console.error(`Unknown config subcommand: ${sub}`);
  process.exitCode = 1;
}

async function commandSession(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const runtime = new HostRuntime({ mode, mock });

  try {
    if (sub === 'list') {
      const projectPath = parseOptionalProject(argv);
      const response = await runtime.handleCommand(
        projectPath
          ? { type: 'session/list', projectPath }
          : { type: 'session/list', scope: { kind: 'general' } },
      );
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const sessions =
        (
          response.data as {
            sessions?: Array<{
              id: string;
              updatedAt: string;
              name?: string;
              isPinned?: boolean;
              lastPreview?: string;
            }>;
          }
        )?.sessions ?? [];
      if (sessions.length === 0) {
        console.log(projectPath ? `(no sessions for ${projectPath})` : '(no general sessions)');
        return;
      }
      for (const session of sessions) {
        const pin = session.isPinned === true ? 'pin' : '   ';
        console.log(
          `${pin}\t${session.id}\t${session.updatedAt}\t${session.name ?? ''}\t${session.lastPreview ?? ''}`,
        );
      }
      return;
    }

    if (sub === 'pin' || sub === 'unpin') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error(`Usage: piwin session ${sub} <sessionId> [--mock]`);
        process.exitCode = 1;
        return;
      }
      const response = await runtime.handleCommand({
        type: sub === 'pin' ? 'session/pin' : 'session/unpin',
        sessionId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(`${sub} ok ${sessionId}`);
      return;
    }

    if (sub === 'search') {
      const queryTokens: string[] = [];
      const args = argv.slice(2);
      for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token) continue;
        if (token === '--project' || token === '--mode') {
          index += 1;
          continue;
        }
        if (token === '--mock' || token.startsWith('--')) continue;
        queryTokens.push(token);
      }
      const query = queryTokens.join(' ').trim();
      if (!query) {
        console.error('Usage: piwin session search <query> [--project <path>] [--mock]');
        process.exitCode = 1;
        return;
      }
      const projectPath = parseProject(argv);
      const response = await runtime.handleCommand({
        type: 'session/search',
        query: { query, projectPath, limit: 30 },
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const hits =
        (
          response.data as {
            hits?: Array<{
              sessionId: string;
              name?: string;
              snippet?: string;
              isPinned?: boolean;
            }>;
          }
        )?.hits ?? [];
      if (hits.length === 0) {
        console.log('(no hits)');
        return;
      }
      for (const hit of hits) {
        const pin = hit.isPinned === true ? 'pin' : '   ';
        console.log(`${pin}\t${hit.sessionId}\t${hit.name ?? ''}\t${hit.snippet ?? ''}`);
      }
      return;
    }

    if (sub === 'export') {
      const sessionId = argv[2];
      if (!sessionId || sessionId.startsWith('--')) {
        console.error(
          'Usage: piwin session export <id> --format md|html [--redact-tools] [--out <path>] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      const formatRaw = readOption(argv, '--format') ?? 'md';
      if (formatRaw !== 'md' && formatRaw !== 'html') {
        console.error(`Unsupported format: ${formatRaw} (use md or html)`);
        process.exitCode = 1;
        return;
      }
      const redactTools = hasFlag(argv, '--redact-tools');
      const outOption = readOption(argv, '--out');
      const command: Extract<HostCommand, { type: 'session/export' }> = {
        type: 'session/export',
        sessionId,
        format: formatRaw,
        redactTools,
        ...(outOption ? { outputPath: resolve(outOption) } : {}),
      };
      const response = await runtime.handleCommand(command);
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const data = response.data as {
        path?: string;
        format?: string;
        redactTools?: boolean;
        byteLength?: number;
      };
      console.log(data.path ?? '(export written)');
      if (typeof data.byteLength === 'number') {
        console.error(
          `exported ${data.byteLength} bytes format=${data.format ?? formatRaw}` +
            (data.redactTools ? ' redact-tools' : ''),
        );
      }
      return;
    }

    console.error(`Unknown session subcommand: ${sub}`);
    console.error('Usage: piwin session list|pin|unpin|search|export');
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

async function commandStatus(argv: string[]): Promise<void> {
  const runtime = new HostRuntime({
    mode: parseMode(argv),
    mock: parseMock(argv),
  });
  try {
    const response = await runtime.handleCommand({ type: 'host/status' });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const data = response.data as HostStatusData;
    console.log('piwin status');
    console.log(`- mode: ${data.mode}`);
    console.log(`- ready: ${data.ready}`);
    console.log(`- mock: ${data.mock}`);
    console.log(`- piwinRoot: ${data.piwinRoot}`);
    console.log(`- activeSessions: ${data.activeSessionIds.join(', ') || '(none)'}`);
    console.log('--- capability matrix ---');
    for (const line of formatCapabilityMatrixLines(data.capabilities, {
      mode: data.mode as 'sdk' | 'rpc',
      mock: data.mock,
    })) {
      console.log(`- ${line}`);
    }
    console.log(
      '- usage: chip/events available after first assistant turn (see usage/update); CLI chat prints [usage] lines',
    );
  } finally {
    await runtime.dispose();
  }
}

async function commandChat(argv: string[]): Promise<void> {
  const args = argv.slice(1);
  const messageTokens: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) continue;
    if (
      token === '--project' ||
      token === '--mode' ||
      token === '--image' ||
      token === '--permission-mode'
    ) {
      index += 1;
      continue;
    }
    if (token === '--mock' || token.startsWith('--')) {
      continue;
    }
    messageTokens.push(token);
  }
  let message = messageTokens.join(' ').trim();
  const imagePath = readOption(argv, '--image');
  if (!message && !imagePath) {
    console.error(
      'Usage: piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass]',
    );
    process.exitCode = 1;
    return;
  }

  if (imagePath) {
    const root = getPiwinRoot();
    const config = await loadPiwinConfig(root);
    const media = createMediaService({
      mediaRoot: getPiwinMediaDir(root),
      maxPasteBytes: config.media.maxPasteBytes,
      allowedMimeTypes: config.media.allowedMimeTypes,
    });
    const bytes = await readFile(resolve(imagePath));
    const saved = await media.saveMediaAsset({
      sessionId: 'cli',
      bytes,
      mimeType: guessMime(imagePath),
      source: 'file-picker',
    });
    const injection = formatTextModelImageInjection({
      absolutePath: saved.absolutePath,
      mimeType: saved.mimeType,
      byteSize: saved.byteSize,
    });
    message = message ? `${message}\n\n${injection}` : injection;
    console.error(`[media] saved ${saved.absolutePath}`);
  }

  const projectPath = parseOptionalProject(argv);
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const permissionModeOverride = resolvePermissionModeOverride(argv);
  if (mode === 'rpc' && !mock) {
    console.error(
      'piwin chat --mode rpc: stock Pi RPC does not support piwin custom tools ' +
        '(web/MCP/bash). Use default --mode sdk, or --mode rpc --mock for offline smoke. ' +
        'See ADR 0008 / host status capabilities.customTools.',
    );
    process.exitCode = 1;
    return;
  }
  const host = createAgentHost({
    mode,
    mock,
    ...(permissionModeOverride !== undefined ? { permissionModeOverride } : {}),
  });
  const session = await host.createSession(
    projectPath
      ? { scope: { kind: 'project', projectPath }, projectPath }
      : { scope: { kind: 'general' } },
  );
  const unsubscribe = session.subscribe((event) => {
    const line = formatEvent(event);
    if (line !== null) {
      process.stdout.write(line);
    }
  });

  try {
    await session.prompt({ text: message });
    process.stdout.write('\n');
  } finally {
    unsubscribe();
    await host.dispose();
  }
}

function guessMime(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

async function commandSkill(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledSkillsInstalled(root);
    const scanOptions: {
      piwinRoot: string;
      projectPath: string;
      skillsConfig?: NonNullable<typeof config.skills>;
    } = {
      piwinRoot: root,
      projectPath: parseProject(argv),
    };
    if (config.skills) {
      scanOptions.skillsConfig = config.skills;
    }
    const skills = await scanSkills(scanOptions);
    const visibleSkills = skills.filter((s) => s.hidden !== true);
    if (visibleSkills.length === 0) {
      console.log('(no skills found)');
      return;
    }
    for (const skill of visibleSkills) {
      const flag = skill.enabled ? 'on ' : 'off';
      console.log(`${flag}\t${skill.id}\t${skill.source}\t${skill.name}\t${skill.path}`);
    }
    return;
  }

  if (sub === 'ensure-bundled') {
    const installed = await ensureBundledSkillsInstalled(root);
    if (installed.length === 0) {
      console.log('(bundled skills already present or none found)');
    } else {
      for (const name of installed) {
        console.log(`installed bundled skill: ${name}`);
      }
    }
    return;
  }

  if (sub === 'install') {
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const name = readOption(argv, '--name');
    if (localPath) {
      const installOptions: Parameters<typeof installSkill>[0] = {
        piwinRoot: root,
        source: { kind: 'local', path: resolve(localPath) },
      };
      if (name) {
        installOptions.name = name;
      }
      const result = await installSkill(installOptions);
      console.log(`installed ${result.skillId} -> ${result.targetPath}`);
      return;
    }
    if (gitUrl) {
      const installOptions: Parameters<typeof installSkill>[0] = {
        piwinRoot: root,
        source: { kind: 'git', url: gitUrl },
      };
      if (name) {
        installOptions.name = name;
      }
      const result = await installSkill(installOptions);
      console.log(`installed ${result.skillId} -> ${result.targetPath}`);
      return;
    }
    console.log('Recommended git skills:');
    for (const item of RECOMMENDED_SKILLS) {
      console.log(
        `- ${item.id}: ${item.source.url}${item.source.subdir ? ` (${item.source.subdir})` : ''}`,
      );
    }
    console.error('Usage: piwin skill install --local <dir> | --git <url> [--name <id>]');
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown skill subcommand: ${sub}`);
  process.exitCode = 1;
}

async function commandExtension(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledExtensionsInstalled(root);
    const scanOptions: Parameters<typeof scanExtensions>[0] = {
      piwinRoot: root,
      projectPath: parseProject(argv),
    };
    if (config.extensions) {
      scanOptions.extensionsConfig = config.extensions;
    }
    const extensions = await scanExtensions(scanOptions);
    if (extensions.length === 0) {
      console.log('(no extensions found under ~/.piwin/extensions)');
      return;
    }
    for (const extension of extensions) {
      const flag = extension.enabled ? 'on ' : 'off';
      console.log(
        `${flag}\t${extension.id}\t${extension.source}\t${extension.name}\t${extension.path}`,
      );
    }
    return;
  }

  if (sub === 'ensure-bundled') {
    const installed = await ensureBundledExtensionsInstalled(root);
    if (installed.length === 0) {
      console.log('(bundled extensions already present or none found)');
    } else {
      for (const name of installed) {
        console.log(`installed bundled extension: ${name}`);
      }
    }
    return;
  }

  if (sub === 'install') {
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const name = readOption(argv, '--name');
    if (localPath) {
      const installOptions: Parameters<typeof installExtension>[0] = {
        piwinRoot: root,
        source: { kind: 'local', path: resolve(localPath) },
      };
      if (name) installOptions.name = name;
      const result = await installExtension(installOptions);
      console.log(`installed extension ${result.extensionId} -> ${result.targetPath}`);
      return;
    }
    if (gitUrl) {
      const installOptions: Parameters<typeof installExtension>[0] = {
        piwinRoot: root,
        source: { kind: 'git', url: gitUrl },
      };
      if (name) installOptions.name = name;
      const result = await installExtension(installOptions);
      console.log(`installed extension ${result.extensionId} -> ${result.targetPath}`);
      return;
    }
    console.error('Usage: piwin extension install --local <file|dir> | --git <url> [--name <id>]');
    process.exitCode = 1;
    return;
  }

  console.error(`Unknown extension subcommand: ${sub}`);
  console.error('Usage: piwin extension list | ensure-bundled | install');
  process.exitCode = 1;
}

async function commandPrompt(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);

  if (sub === 'list') {
    await ensureBundledPromptsInstalled(root);
    const scanOptions: Parameters<typeof scanPrompts>[0] = {
      piwinRoot: root,
      projectPath: parseProject(argv),
    };
    if (config.prompts) {
      scanOptions.promptsConfig = config.prompts;
    }
    const prompts = await scanPrompts(scanOptions);
    if (prompts.length === 0) {
      console.log('(no prompt templates under ~/.piwin/prompts)');
      return;
    }
    for (const prompt of prompts) {
      const flag = prompt.enabled ? 'on ' : 'off';
      console.log(`${flag}\t${prompt.id}\t${prompt.source}\t${prompt.name}\t${prompt.path}`);
    }
    return;
  }

  console.error(`Unknown prompt subcommand: ${sub}`);
  console.error('Usage: piwin prompt list');
  process.exitCode = 1;
}

async function commandMcp(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();

  if (sub === 'list') {
    const document = await loadMcpConfig(root);
    const servers = Object.entries(document.mcpServers);
    if (servers.length === 0) {
      console.log('(no mcp servers in ~/.piwin/mcp.json)');
      return;
    }
    for (const [id, config] of servers) {
      const state = config.disabled ? 'off' : 'on';
      const args = config.args?.join(' ') ?? '';
      console.log(`${state}\t${id}\t${config.command} ${args}`.trimEnd());
    }
    const enabled = listEnabledServers(document);
    console.log(`enabled: ${enabled.length}/${servers.length}`);
    return;
  }

  if (sub === 'validate') {
    const pathArg = argv[2];
    const raw = pathArg
      ? await readFile(resolve(pathArg), 'utf8')
      : JSON.stringify(await loadMcpConfig(root));
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('invalid JSON', error);
      process.exitCode = 1;
      return;
    }
    const result = tryValidateMcpConfig(parsed);
    if (result.ok) {
      console.log('ok');
      console.log(`servers: ${Object.keys(result.document.mcpServers).length}`);
      return;
    }
    for (const issue of result.issues) {
      console.error(`${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (sub === 'add') {
    const id = argv[2];
    const command = readOption(argv, '--command');
    if (!id || !command) {
      console.error('Usage: piwin mcp add <id> --command <cmd> [--args a,b] [--env KEY=VAL]');
      process.exitCode = 1;
      return;
    }
    const document = await loadMcpConfig(root);
    const serverConfig: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    } = { command };
    const argsRaw = readOption(argv, '--args');
    if (argsRaw) {
      serverConfig.args = argsRaw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    const envRaw = readOption(argv, '--env');
    if (envRaw) {
      const [envKey, ...rest] = envRaw.split('=');
      if (envKey) {
        serverConfig.env = { [envKey]: rest.join('=') };
      }
    }
    document.mcpServers[id] = serverConfig;
    const path = await saveMcpConfig(root, document);
    console.log(`saved ${id} -> ${path}`);
    return;
  }

  console.error(`Unknown mcp subcommand: ${sub}`);
  process.exitCode = 1;
}

async function commandProcess(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const mock = parseMock(argv);
  const runtime = new HostRuntime({ mode: 'sdk', mock });

  try {
    if (sub === 'list') {
      const projectPath = hasFlag(argv, '--project') ? parseProject(argv) : undefined;
      const command: HostCommand = projectPath
        ? { type: 'process/list', projectPath }
        : { type: 'process/list' };
      const response = await runtime.handleCommand(command);
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const processes =
        (response.data as { processes: Array<Record<string, unknown>> }).processes ?? [];
      if (processes.length === 0) {
        console.log('(no managed processes in this host process)');
        console.log(
          'Note: processes live in the host that started them (Desktop host serve or chat session).',
        );
        return;
      }
      for (const item of processes) {
        const label = item.label ? String(item.label) : '';
        const pid = item.pid !== undefined ? String(item.pid) : '-';
        console.log(
          `${item.status}\t${item.id}\tpid=${pid}\t${item.command} ${(item.argv as string[] | undefined)?.join(' ') ?? ''}\t${label}`.trimEnd(),
        );
      }
      return;
    }

    if (sub === 'logs') {
      const processId = argv[2];
      if (!processId) {
        console.error('Usage: piwin process logs <processId> [--limit N]');
        process.exitCode = 1;
        return;
      }
      const limitRaw = readOption(argv, '--limit');
      const query: { processId: string; limit?: number } = { processId };
      if (limitRaw) {
        query.limit = Number(limitRaw);
      }
      const response = await runtime.handleCommand({ type: 'process/logs', query });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const chunks =
        (response.data as { chunks: Array<{ stream: string; text: string; at: string }> }).chunks ??
        [];
      for (const chunk of chunks) {
        process.stdout.write(`[${chunk.stream}] ${chunk.text}`);
        if (!chunk.text.endsWith('\n')) process.stdout.write('\n');
      }
      if (chunks.length === 0) {
        console.log('(no logs)');
      }
      return;
    }

    if (sub === 'stop') {
      const processId = argv[2];
      if (!processId) {
        console.error('Usage: piwin process stop <processId>');
        process.exitCode = 1;
        return;
      }
      const response = await runtime.handleCommand({ type: 'process/stop', processId });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const processRecord = (response.data as { process: { id: string; status: string } }).process;
      console.log(`${processRecord.status}\t${processRecord.id}`);
      return;
    }

    console.error(`Unknown process subcommand: ${sub}`);
    console.error('Usage: piwin process list|logs|stop');
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

async function commandNotes(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.notes?.enabled === false) {
    console.error('Notes disabled (config.notes.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createNoteStore, openNoteIndex, searchNotes, createEmbeddingProvider } =
    await import('@piwin/notes');
  const store = createNoteStore({ piwinRoot: root });

  if (sub === 'add') {
    const content = collectPositionals(argv.slice(2), ['--title', '--collection', '--tags'])
      .join(' ')
      .trim();
    const title = readOption(argv, '--title');
    if (!content || !title) {
      console.error('Usage: piwin notes add <content> --title <t> [--collection c] [--tags a,b]');
      process.exitCode = 1;
      return;
    }
    const input: {
      title: string;
      content: string;
      collection?: string;
      tags?: string[];
    } = { title, content };
    const collection = readOption(argv, '--collection');
    if (collection) input.collection = collection;
    const tags = readOption(argv, '--tags');
    if (tags)
      input.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const record = await store.write(input);
    console.log(`wrote ${record.id} (${record.relativePath})`);
    return;
  }

  if (sub === 'list') {
    const filter: { collection?: string } = {};
    const collection = readOption(argv, '--collection');
    if (collection) filter.collection = collection;
    const records = await store.list(filter);
    for (const record of records) {
      console.log(
        `${record.id}\t${record.collection}\t${record.title}\t${(record.tags ?? []).join(',')}`,
      );
    }
    return;
  }

  if (sub === 'show') {
    const noteId = argv[2];
    if (!noteId) {
      console.error('Usage: piwin notes show <id>');
      process.exitCode = 1;
      return;
    }
    const record = await store.read(noteId);
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  if (sub === 'delete') {
    const noteId = argv[2];
    if (!noteId) {
      console.error('Usage: piwin notes delete <id>');
      process.exitCode = 1;
      return;
    }
    await store.delete(noteId);
    console.log(`deleted ${noteId}`);
    return;
  }

  if (sub === 'search' || sub === 'reindex') {
    const index = await openNoteIndex(store);
    try {
      if (sub === 'reindex') {
        await index.rebuild();
        console.log('index rebuilt');
        return;
      }
      const query = collectPositionals(argv.slice(2), ['--collection', '--limit', '--search-mode'])
        .join(' ')
        .trim();
      if (!query) {
        console.error(
          'Usage: piwin notes search <query> [--collection c] [--limit n] [--search-mode m]',
        );
        process.exitCode = 1;
        return;
      }
      const searchQuery: {
        query: string;
        collection?: string;
        limit?: number;
        mode?: 'auto' | 'fts' | 'vector' | 'hybrid';
      } = { query };
      const collection = readOption(argv, '--collection');
      if (collection) searchQuery.collection = collection;
      const limit = readOption(argv, '--limit');
      if (limit) searchQuery.limit = Number(limit);
      const searchMode = readOption(argv, '--search-mode');
      if (
        searchMode === 'auto' ||
        searchMode === 'fts' ||
        searchMode === 'vector' ||
        searchMode === 'hybrid'
      ) {
        searchQuery.mode = searchMode;
      }

      const searchOptions: import('@piwin/notes').SearchNotesOptions = {};
      if (config.notes?.embedding) {
        const { resolveNotesEmbeddingApiKey } = await import('@piwin/agent-host');
        const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
        const provider = createEmbeddingProvider({
          config: config.notes.embedding,
          ...(apiKey ? { apiKey } : {}),
        });
        if (provider) searchOptions.embeddingProvider = provider;
      }
      if (typeof config.notes?.search?.rrfK === 'number') {
        searchOptions.rrfK = config.notes.search.rrfK;
      }

      const hits = await searchNotes(index, searchQuery, searchOptions);
      for (const hit of hits) {
        console.log(
          `${hit.note.id}\t[${hit.channels.join('+')}]\t${hit.score.toFixed(4)}\t${hit.note.title}\t${hit.snippet.replaceAll('\n', ' ').slice(0, 100)}`,
        );
      }
      return;
    } finally {
      index.close();
    }
  }

  if (sub === 'pin') {
    const positionals = collectPositionals(argv.slice(2), []);
    const query = positionals[0];
    const noteIds = positionals.slice(1);
    if (!query || noteIds.length === 0) {
      console.error('Usage: piwin notes pin <query> <noteId...>');
      process.exitCode = 1;
      return;
    }
    const { appendGoldenCase } = await import('@piwin/notes');
    const path = await appendGoldenCase(store.getNotesRoot(), {
      query,
      expectedNoteIds: noteIds,
    });
    console.log(`pinned "${query}" -> ${noteIds.join(',')} (${path})`);
    return;
  }

  if (sub === 'eval') {
    const {
      openNoteIndex: openIndex,
      searchNotes: runSearch,
      loadGoldenSet,
      runRecallEval,
    } = await import('@piwin/notes');
    const index = await openIndex(store);
    try {
      if (argv[2] === 'history') {
        const runs = index.listEvalRuns();
        if (runs.length === 0) {
          console.log('(no eval runs yet — run `piwin notes eval` first)');
          return;
        }
        for (const run of runs) {
          console.log(
            `${run.runAt}\t${run.mode}\trecall@${run.k}=${run.recallAtK.toFixed(3)}\tmrr=${run.mrr.toFixed(3)}\tcases=${run.cases}`,
          );
        }
        return;
      }

      const { cases, warnings } = await loadGoldenSet(store.getNotesRoot());
      for (const warning of warnings) {
        console.error(`[golden] ${warning}`);
      }
      if (cases.length === 0) {
        console.error('Golden set empty. Add cases with: piwin notes pin <query> <noteId...>');
        process.exitCode = 1;
        return;
      }

      const searchOptions: import('@piwin/notes').SearchNotesOptions = {};
      if (config.notes?.embedding) {
        const { resolveNotesEmbeddingApiKey } = await import('@piwin/agent-host');
        const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
        const provider = createEmbeddingProvider({
          config: config.notes.embedding,
          ...(apiKey ? { apiKey } : {}),
        });
        if (provider) searchOptions.embeddingProvider = provider;
      }
      if (typeof config.notes?.search?.rrfK === 'number') {
        searchOptions.rrfK = config.notes.search.rrfK;
      }

      const k = Number(readOption(argv, '--k')) || 5;
      const verbose = hasFlag(argv, '--verbose');
      const modes: Array<'fts' | 'vector' | 'hybrid'> = searchOptions.embeddingProvider
        ? ['fts', 'vector', 'hybrid']
        : ['fts'];

      console.log(`eval: ${cases.length} case(s), k=${k}, modes=${modes.join(',')}`);
      for (const mode of modes) {
        let degraded = false;
        const report = await runRecallEval({
          cases,
          mode,
          k,
          search: async (query, limit, searchMode) =>
            runSearch(
              index,
              { query, limit, mode: searchMode },
              { ...searchOptions, onWarning: () => (degraded = true) },
            ),
          wasDegraded: () => degraded,
        });
        index.saveEvalRun(report);
        console.log(
          `${mode.padEnd(7)}\trecall@${k}=${report.recallAtK.toFixed(3)}\tmrr=${report.mrr.toFixed(3)}${report.degraded ? '\t⚠ DEGRADED to fts (embedding failed) — numbers do not measure this mode' : ''}`,
        );
        if (verbose) {
          for (const perCase of report.perCase) {
            const status = perCase.hitRank === null ? 'MISS' : `rank ${perCase.hitRank}`;
            console.log(`  ${status.padEnd(8)} ${perCase.query}`);
          }
        }
      }
      return;
    } finally {
      index.close();
    }
  }

  console.error('Usage: piwin notes add|list|search|show|delete|reindex|pin|eval');
  process.exitCode = 1;
}

async function commandCards(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.flashcards?.enabled === false) {
    console.error('Flashcards disabled (config.flashcards.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createCardStore, buildReviewQueue, exportCardsToTsv } = await import('@piwin/flashcards');
  const store = createCardStore({ piwinRoot: root });
  const deck = readOption(argv, '--deck');

  if (sub === 'add') {
    const front = collectPositionals(argv.slice(2), ['--back', '--deck', '--tags'])
      .join(' ')
      .trim();
    const back = readOption(argv, '--back');
    if (!front || !back) {
      console.error('Usage: piwin cards add <front> --back <b> [--deck d] [--tags a,b]');
      process.exitCode = 1;
      return;
    }
    const input: {
      front: string;
      back: string;
      deck?: string;
      tags?: string[];
    } = { front, back };
    if (deck) input.deck = deck;
    const tags = readOption(argv, '--tags');
    if (tags)
      input.tags = tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const card = await store.create(input);
    console.log(`created ${card.id} [${card.deck}]`);
    return;
  }

  if (sub === 'list') {
    const cards = await store.list(deck ? { deck } : undefined);
    for (const card of cards) {
      console.log(`${card.id}\t${card.deck}\t${card.front.replaceAll('\n', ' ').slice(0, 80)}`);
    }
    return;
  }

  if (sub === 'decks') {
    for (const name of await store.listDecks()) {
      console.log(name);
    }
    return;
  }

  if (sub === 'show') {
    const cardId = argv[2];
    if (!cardId) {
      console.error('Usage: piwin cards show <id>');
      process.exitCode = 1;
      return;
    }
    const card = await store.read(cardId);
    const state = await store.getReviewState(cardId);
    console.log(JSON.stringify({ card, review: state }, null, 2));
    return;
  }

  if (sub === 'delete') {
    const cardId = argv[2];
    if (!cardId) {
      console.error('Usage: piwin cards delete <id>');
      process.exitCode = 1;
      return;
    }
    await store.delete(cardId);
    console.log(`deleted ${cardId}`);
    return;
  }

  if (sub === 'due' || sub === 'review') {
    const cards = await store.list();
    const states = await store.loadReviewStates();
    const queue = buildReviewQueue({
      cards,
      states,
      ...(deck ? { deck } : {}),
      ...(typeof config.flashcards?.newPerDay === 'number'
        ? { newPerDay: config.flashcards.newPerDay }
        : {}),
      ...(typeof config.flashcards?.maxReviewsPerDay === 'number'
        ? { maxReviewsPerDay: config.flashcards.maxReviewsPerDay }
        : {}),
    });

    if (sub === 'due') {
      console.log(`${queue.length} card(s) to review`);
      for (const item of queue) {
        const label = item.isNew ? 'new' : `due ${item.state.due.slice(0, 10)}`;
        console.log(`${item.card.id}\t[${label}]\t${item.card.front.slice(0, 70)}`);
      }
      return;
    }

    // Interactive review loop.
    if (queue.length === 0) {
      console.log('No cards due. 🎉'.replace(' 🎉', ''));
      return;
    }
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> =>
      new Promise((resolvePrompt) => readline.question(prompt, resolvePrompt));
    try {
      let position = 0;
      for (const item of queue) {
        position += 1;
        console.log(
          `\n[${position}/${queue.length}] ${item.isNew ? '(new) ' : ''}${item.card.front}`,
        );
        await ask('  press Enter to reveal…');
        console.log(`  → ${item.card.back}`);
        // Only 1-4 commit a rating; anything else re-prompts (a typo must
        // never silently write FSRS state).
        const RATING_KEYS: Record<string, 'again' | 'hard' | 'good' | 'easy'> = {
          '1': 'again',
          '2': 'hard',
          '3': 'good',
          '4': 'easy',
        };
        let rating: 'again' | 'hard' | 'good' | 'easy' | undefined;
        let quit = false;
        while (!rating && !quit) {
          const answer = (await ask('  rate: 1=again 2=hard 3=good 4=easy (q=quit): ')).trim();
          if (answer === 'q') {
            quit = true;
          } else {
            rating = RATING_KEYS[answer];
            if (!rating) console.log('  invalid input — enter 1, 2, 3, 4, or q');
          }
        }
        if (quit || !rating) break;
        const next = await store.rate(item.card.id, rating);
        console.log(`  next due: ${next.due.slice(0, 16).replace('T', ' ')}`);
      }
      console.log('\nreview session done');
    } finally {
      readline.close();
    }
    return;
  }

  if (sub === 'export') {
    const cards = await store.list(deck ? { deck } : undefined);
    const tsv = exportCardsToTsv(cards);
    const outPath = readOption(argv, '--out');
    if (outPath) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(resolve(outPath), tsv, 'utf8');
      console.log(`exported ${cards.length} card(s) to ${resolve(outPath)}`);
    } else {
      process.stdout.write(tsv);
    }
    return;
  }

  console.error('Usage: piwin cards add|list|decks|show|delete|due|review|export');
  process.exitCode = 1;
}

async function commandDocCards(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'help';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.flashcards?.enabled === false) {
    console.error('Flashcards disabled (config.flashcards.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const {
    createFolderRag,
    buildFlashcardGenerationPrompt,
    FLASHCARD_QUALITY_RULES,
    canonicalizeFolderPath,
  } = await import('@piwin/doc-rag');
  const { createEmbeddingProvider } = await import('@piwin/notes');
  const { createCardStore } = await import('@piwin/flashcards');
  const { resolveNotesEmbeddingApiKey } = await import('@piwin/agent-host');

  let embeddingProvider: import('@piwin/contracts').EmbeddingProvider | undefined;
  if (config.notes?.embedding) {
    const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
    const provider = createEmbeddingProvider({
      config: config.notes.embedding,
      ...(apiKey ? { apiKey } : {}),
    });
    if (provider) embeddingProvider = provider;
  }
  const rag = createFolderRag({
    piwinRoot: root,
    ...(embeddingProvider ? { embeddingProvider } : {}),
  });
  const store = createCardStore({ piwinRoot: root });
  let host: import('@piwin/contracts').AgentHost | undefined;

  try {
    if (sub === 'scan') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards scan <folder>');
        process.exitCode = 1;
        return;
      }
      const result = await rag.scanFolder(folderPath);
      console.log(
        `${result.files.length} supported file(s), ${result.supportedExtensions.length} extension(s):`,
      );
      for (const file of result.files.slice(0, 50)) {
        console.log(`  ${file.relativePath}\t${file.sizeBytes}B\t${file.language}`);
      }
      if (result.files.length > 50) console.log(`  … and ${result.files.length - 50} more`);
      return;
    }

    if (sub === 'index') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards index <folder> [--files a,b]');
        process.exitCode = 1;
        return;
      }
      const includeFiles = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await rag.indexFolder(
        folderPath,
        includeFiles?.length ? { includeFiles } : undefined,
      );
      console.log(
        `indexed ${result.indexed} file(s), ${result.chunks} chunk(s)${result.degraded ? ' (FTS-only)' : ''}, skipped ${result.skipped}`,
      );
      for (const warning of result.warnings) console.log(`  ! ${warning}`);
      return;
    }

    if (sub === 'retrieve') {
      const folderPath = argv[2];
      const query = argv[3];
      if (!folderPath || !query) {
        console.error('Usage: piwin doccards retrieve <folder> <query> [--limit n] [--files a,b]');
        process.exitCode = 1;
        return;
      }
      const limit = readOption(argv, '--limit') ? Number(readOption(argv, '--limit')) : undefined;
      const fileAllowlist = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const chunks = await rag.retrieve(folderPath, query, {
        ...(limit ? { limit } : {}),
        ...(fileAllowlist?.length ? { fileAllowlist } : {}),
      });
      console.log(`${chunks.length} passage(s):`);
      for (const chunk of chunks) {
        console.log(
          `\n--- ${chunk.filePath}:${chunk.startLine}-${chunk.endLine} (score ${chunk.score.toFixed(3)}) ---`,
        );
        console.log(chunk.content);
      }
      return;
    }

    if (sub === 'list') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards list <folder>');
        process.exitCode = 1;
        return;
      }
      const canonical = await canonicalizeFolderPath(folderPath);
      const cards = await store.list(
        canonical ? { sourceFolder: canonical } : { sourceFolder: folderPath },
      );
      console.log(`${cards.length} card(s) from ${canonical ?? folderPath}:`);
      for (const card of cards) {
        const source = card.sourceFile
          ? ` [${card.sourceFile}${typeof card.sourceLine === 'number' ? `:${card.sourceLine}` : ''}]`
          : '';
        console.log(`  ${card.id}\t${card.front.slice(0, 70)}${source}`);
      }
      return;
    }

    if (sub === 'generate') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error(
          'Usage: piwin doccards generate <folder> [--topic t] [--limit n] [--files a,b] [--difficulty easy|medium|hard] [--count fewer|standard|more]',
        );
        process.exitCode = 1;
        return;
      }
      const mode = parseMode(argv);
      const mock = parseMock(argv);
      if (mode === 'rpc' && !mock) {
        console.error(
          'piwin doccards generate --mode rpc: use --mock for an offline smoke, or omit --mode to use sdk.',
        );
        process.exitCode = 1;
        return;
      }
      const topic = readOption(argv, '--topic') ?? '';
      const limit = readOption(argv, '--limit') ? Number(readOption(argv, '--limit')) : 10;
      const fileAllowlist = readOption(argv, '--files')
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const difficulty = readOption(argv, '--difficulty') as 'easy' | 'medium' | 'hard' | undefined;
      const count = readOption(argv, '--count') as 'fewer' | 'standard' | 'more' | undefined;
      const canonical = await canonicalizeFolderPath(folderPath);
      if (!canonical) {
        console.error(`Folder not found: ${folderPath}`);
        process.exitCode = 1;
        return;
      }

      // Step 1: index (optionally limited to selected files), then retrieve.
      const indexOptions = fileAllowlist?.length ? { includeFiles: fileAllowlist } : undefined;
      await rag.indexFolder(canonical, indexOptions);
      const query = topic || canonical;
      const retrieveOptions = {
        limit,
        ...(fileAllowlist?.length ? { fileAllowlist } : {}),
      };
      const chunks = await rag.retrieve(canonical, query, retrieveOptions);
      if (chunks.length === 0) {
        console.error('No passages retrieved; index the folder first or try a different topic.');
        process.exitCode = 1;
        return;
      }

      // Step 2: build the flashcard generation prompt.
      const prompt = buildFlashcardGenerationPrompt({
        folderPath: canonical,
        chunks,
        ...(topic ? { topic } : {}),
        difficulty: difficulty ?? 'medium',
        count: count ?? 'standard',
        qualityRules: FLASHCARD_QUALITY_RULES,
      });

      // Step 3: start a chat session and stream the generation.
      host = createAgentHost({ mode, mock, piwinRoot: root });
      const sessionName = `Doc cards: ${basename(canonical)}`;
      const session = await host.createSession({
        scope: { kind: 'general' },
        executionMode: 'chat',
        sessionName,
      });
      const unsubscribe = session.subscribe((event) => {
        const line = formatEvent(event);
        if (line !== null) {
          process.stdout.write(line);
        }
      });
      try {
        await session.prompt({ text: prompt });
        process.stdout.write('\n');
      } finally {
        unsubscribe();
      }
      return;
    }

    if (sub === 'rebind') {
      const oldPath = argv[2];
      const newPath = argv[3];
      if (!oldPath || !newPath) {
        console.error('Usage: piwin doccards rebind <oldPath> <newPath>');
        process.exitCode = 1;
        return;
      }
      const oldCanonical = await canonicalizeFolderPath(oldPath);
      const newCanonical = await canonicalizeFolderPath(newPath);
      const result = await store.rebindSourceFolder(
        oldCanonical ?? oldPath,
        newCanonical ?? newPath,
      );
      console.log(`rebound ${result.updated} card(s)`);
      return;
    }

    if (sub === 'forget') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error('Usage: piwin doccards forget <folder> [--yes]');
        process.exitCode = 1;
        return;
      }
      const canonical = await canonicalizeFolderPath(folderPath);
      const cardCount = canonical ? (await store.list({ sourceFolder: canonical })).length : 0;
      if (cardCount > 0 && !hasFlag(argv, '--yes')) {
        console.error(`Folder has ${cardCount} card(s). Add --yes to forget them.`);
        process.exitCode = 1;
        return;
      }
      const result = await store.deleteBySourceFolder(canonical ?? folderPath);
      console.log(`forgot ${result.deleted} card(s)`);
      return;
    }

    console.error('Usage: piwin doccards scan|index|retrieve|list|generate|rebind|forget');
    process.exitCode = 1;
  } finally {
    if (host) await host.dispose();
    rag.close();
  }
}

async function commandHostServe(argv: string[]): Promise<void> {
  redirectHostLogsToStandardError();
  const mode = parseMode(argv);
  const mock = parseMock(argv);
  const testFixture = parseHostServeTestFixture(argv);
  const permissionModeOverride = resolvePermissionModeOverride(argv);
  const writer = createJsonlWriter(process.stdout);
  const streamBatcher = createHostServeStreamBatcher({
    write: (message) => writer.write(message),
  });
  const runtimeOptions: ConstructorParameters<typeof HostRuntime>[0] = {
    mode,
    mock,
    onPush: (message) => {
      streamBatcher.push(message);
    },
  };
  if (testFixture !== undefined) {
    runtimeOptions.testFixture = testFixture;
  }
  if (permissionModeOverride !== undefined) {
    runtimeOptions.permissionModeOverride = permissionModeOverride;
  }
  const runtime = new HostRuntime(runtimeOptions);

  await writer.write({
    type: 'host/status',
    mode: runtime.getMode(),
    ready: true,
    mock,
  });

  const readlineInterface = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  // ADR 0015: control-lane commands (abort, permission resolve, …) bypass
  // the serialized mutation queue so Stop can reach an in-flight turn.
  const dispatcher = createHostServeDispatcher({
    runtime,
    writer,
    commandTimeoutMs: 45_000,
  });

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }
    shutdownPromise = (async (): Promise<void> => {
      // Stop reading first so EOF and SIGINT cannot admit more commands while
      // the existing command and stream work is being drained.
      readlineInterface.close();
      await dispatcher.drain();
      await streamBatcher.flush();
      await runtime.dispose();
    })();
    return shutdownPromise;
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  for await (const line of readlineInterface) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let command: HostCommand;
    try {
      command = JSON.parse(trimmed) as HostCommand;
    } catch {
      await writer.write({
        type: 'response',
        command: 'parse',
        success: false,
        error: 'invalid JSON command line',
      });
      continue;
    }

    dispatcher.dispatch(command);
  }

  await shutdown();
}

/**
 * The desktop sidecar treats stdout as a strict JSONL protocol. Agent-host and
 * third-party extensions use console.info/warn for diagnostics, which otherwise
 * insert plain text between protocol messages and corrupt the stream.
 */
function redirectHostLogsToStandardError(): void {
  const writeDiagnostic = console.error.bind(console);
  console.log = writeDiagnostic;
  console.info = writeDiagnostic;
  console.warn = writeDiagnostic;
}

async function commandCron(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  if (sub !== 'list') {
    console.error('Usage: piwin cron list [--mock]');
    process.exitCode = 1;
    return;
  }
  const mock = hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: mock === true,
  });
  try {
    const response = await runtime.handleCommand({ type: 'cron/list' });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const jobs = (response.data as { jobs?: Array<Record<string, unknown>> }).jobs ?? [];
    if (jobs.length === 0) {
      console.log('No cron jobs (host-local; no background daemon).');
      return;
    }
    for (const job of jobs) {
      const last = job.lastStatus ? ` last=${job.lastStatus}` : '';
      const when = job.lastRunAt ? ` at=${job.lastRunAt}` : '';
      console.log(
        `${job.id}\t${job.enabled ? 'on' : 'off'}\t${job.schedule}\t${job.name}${last}${when}`,
      );
    }
  } finally {
    await runtime.dispose();
  }
}

async function commandUsage(argv: string[]): Promise<void> {
  const mock = parseMock(argv);
  const projectPath = parseOptionalProject(argv);
  const globalFlag = hasFlag(argv, '--global');
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock,
  });
  try {
    const response = await runtime.handleCommand({
      type: 'usage/get-rollup',
      ...(globalFlag || !projectPath ? {} : { projectPath }),
      topSessions: 10,
    });
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    const rollup = (response.data as { rollup?: UsageRollup }).rollup;
    if (!rollup) {
      console.error('No rollup returned.');
      process.exitCode = 1;
      return;
    }
    const scope =
      rollup.scope.kind === 'global'
        ? 'global'
        : rollup.scope.kind === 'project'
          ? rollup.scope.projectPath
          : 'general';
    console.log(`piwin usage — ${scope}`);
    console.log('---');
    console.log(
      `total tokens: ${formatUsageNumber(rollup.totalTokens)}  ` +
        `input: ${formatUsageNumber(rollup.promptTokens)}  ` +
        `output: ${formatUsageNumber(rollup.completionTokens)}  ` +
        `sessions: ${rollup.sessionCount}  turns: ${rollup.entryCount}`,
    );
    if (rollup.firstAt) {
      console.log(`range: ${rollup.firstAt.slice(0, 10)} → ${rollup.lastAt?.slice(0, 10) ?? ''}`);
    }
    const models = Object.entries(rollup.byModel).sort(
      ([, a], [, b]) => b.totalTokens - a.totalTokens,
    );
    if (models.length > 0) {
      console.log('--- by model ---');
      for (const [modelId, bucket] of models) {
        console.log(
          `${modelId}\t${formatUsageNumber(bucket.totalTokens)} total\t` +
            `${formatUsageNumber(bucket.promptTokens)} in\t${formatUsageNumber(bucket.completionTokens)} out`,
        );
      }
    }
    if (rollup.bySession.length > 0) {
      console.log('--- by session (top) ---');
      for (const session of rollup.bySession) {
        console.log(
          `${session.sessionId}\t${formatUsageNumber(session.totalTokens)} total\t` +
            `${session.entryCount} turns`,
        );
      }
    }
  } finally {
    await runtime.dispose();
  }
}

function formatUsageNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'doctor') {
    await commandDoctor();
    return;
  }
  if (command === 'host-mode') {
    await commandHostMode();
    return;
  }
  if (command === 'config') {
    await commandConfig(argv);
    return;
  }
  if (command === 'session') {
    await commandSession(argv);
    return;
  }
  if (command === 'status') {
    await commandStatus(argv);
    return;
  }
  if (command === 'chat') {
    await commandChat(argv);
    return;
  }
  if (command === 'skill') {
    await commandSkill(argv);
    return;
  }
  if (command === 'extension') {
    await commandExtension(argv);
    return;
  }
  if (command === 'prompt') {
    await commandPrompt(argv);
    return;
  }
  if (command === 'mcp') {
    await commandMcp(argv);
    return;
  }
  if (command === 'process') {
    await commandProcess(argv);
    return;
  }
  if (command === 'cron') {
    await commandCron(argv);
    return;
  }
  if (command === 'notes') {
    await commandNotes(argv);
    return;
  }
  if (command === 'cards') {
    await commandCards(argv);
    return;
  }
  if (command === 'doccards') {
    await commandDocCards(argv);
    return;
  }
  if (command === 'host' && argv[1] === 'serve') {
    await commandHostServe(argv);
    return;
  }
  if (command === 'usage') {
    await commandUsage(argv);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
