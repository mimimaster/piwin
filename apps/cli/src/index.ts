#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  createAgentHost,
  getPiwinRoot,
  getPiwinMediaDir,
  HostRuntime,
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
import type { AgentEvent, HostCommand, HostMode, HostServerMessage } from '@piwin/contracts';
import { formatTextModelImageInjection } from '@piwin/contracts';
import { ensureBundledSkillsInstalled, scanSkills } from '@piwin/skills';
import {
  loadMcpConfig,
  saveMcpConfig,
  tryValidateMcpConfig,
  listEnabledServers,
} from '@piwin/mcp';
import { installSkill, installExtension, RECOMMENDED_SKILLS } from '@piwin/marketplace';
import { createMediaService } from '@piwin/media';

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
  piwin status [--project <path>] [--mock]
  piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>]
  piwin host serve [--mode sdk|rpc] [--mock]
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
  piwin memory list|search|write|delete|quota|enable|disable [--project <path>]

Host modes: sdk | rpc
Offline: --mock or PIWIN_MOCK=1
host serve: JSONL IPC on stdin/stdout for desktop sidecar
`);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
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

function parseProject(argv: string[]): string {
  return resolve(readOption(argv, '--project') ?? process.cwd());
}

function parseMock(argv: string[]): boolean {
  return hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
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
  console.log(
    '- rpc.customTools: false (stock pi RPC; use sdk mode for web/MCP/bash tools)',
  );
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
    console.log(`- skills: ${skills.length} (extraPaths=${(config.skills?.extraPaths ?? []).length})`);
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
  console.log('- packages: media tools-web skills mcp marketplace git theme pet artifact');
  console.log(`- session index path: ${getPiwinSessionIndexPath(root)}`);
  console.log(`- CI scripts: typecheck/test present in package.json`);
  try {
    const { listThemes } = await import('@piwin/theme');
    const themes = await listThemes(root);
    console.log(`- themes: ${themes.themes.length} (active=${themes.activeThemeId})`);
  } catch (error) {
    console.log(`- themes: (unavailable: ${error instanceof Error ? error.message : String(error)})`);
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
      const projectPath = parseProject(argv);
      const response = await runtime.handleCommand({ type: 'session/list', projectPath });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const sessions =
        (response.data as { sessions?: Array<{
          id: string;
          updatedAt: string;
          name?: string;
          isPinned?: boolean;
          lastPreview?: string;
        }> })?.sessions ?? [];
      if (sessions.length === 0) {
        console.log(`(no sessions for ${projectPath})`);
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
        (response.data as { hits?: Array<{
          sessionId: string;
          name?: string;
          snippet?: string;
          isPinned?: boolean;
        }> })?.hits ?? [];
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

    console.error(`Unknown session subcommand: ${sub}`);
    console.error('Usage: piwin session list|pin|unpin|search');
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
    const data = response.data as {
      mode: string;
      ready: boolean;
      mock: boolean;
      piwinRoot: string;
      activeSessionIds: string[];
      capabilities: Record<string, boolean | undefined>;
    };
    console.log('piwin status');
    console.log(`- mode: ${data.mode}`);
    console.log(`- ready: ${data.ready}`);
    console.log(`- mock: ${data.mock}`);
    console.log(`- piwinRoot: ${data.piwinRoot}`);
    console.log(`- activeSessions: ${data.activeSessionIds.join(', ') || '(none)'}`);
    console.log(
      `- capabilities: sessionPin=${Boolean(data.capabilities.sessionPin)} sessionSearch=${Boolean(data.capabilities.sessionSearch)} usage=${Boolean(data.capabilities.usage)}`,
    );
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
    if (token === '--project' || token === '--mode' || token === '--image') {
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
      'Usage: piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>]',
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

  const projectPath = parseProject(argv);
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  if (mode === 'rpc' && !mock) {
    console.error(
      'piwin chat --mode rpc: stock Pi RPC does not support piwin custom tools ' +
        '(web/MCP/bash). Use default --mode sdk, or --mode rpc --mock for offline smoke. ' +
        'See ADR 0008 / host status capabilities.customTools.',
    );
    process.exitCode = 1;
    return;
  }
  const host = createAgentHost({ mode, mock });
  const session = await host.createSession({ projectPath });
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
    if (skills.length === 0) {
      console.log('(no skills found)');
      return;
    }
    for (const skill of skills) {
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
      console.log(`- ${item.id}: ${item.source.url}${item.source.subdir ? ` (${item.source.subdir})` : ''}`);
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
      console.log(
        `${flag}\t${prompt.id}\t${prompt.source}\t${prompt.name}\t${prompt.path}`,
      );
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
      serverConfig.args = argsRaw.split(',').map((item) => item.trim()).filter(Boolean);
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
      const processes = (response.data as { processes: Array<Record<string, unknown>> }).processes ?? [];
      if (processes.length === 0) {
        console.log('(no managed processes in this host process)');
        console.log('Note: processes live in the host that started them (Desktop host serve or chat session).');
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
      const chunks = (response.data as { chunks: Array<{ stream: string; text: string; at: string }> }).chunks ?? [];
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


async function commandMemory(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.memory?.enabled !== true && sub !== 'enable' && sub !== 'disable') {
    console.error(
      'Memory disabled. Enable with: piwin memory enable  (or config.memory.enabled=true)',
    );
    process.exitCode = 1;
    return;
  }

  const runtime = new HostRuntime({
    mode: parseMode(argv),
    mock: true,
    piwinRoot: root,
  });
  try {
    if (sub === 'enable' || sub === 'disable') {
      const next = {
        ...config,
        memory: {
          ...(config.memory ?? { injectOverview: true, autoExtract: false }),
          enabled: sub === 'enable',
        },
      };
      if (hasFlag(argv, '--no-inject')) {
        next.memory.injectOverview = false;
      }
      if (hasFlag(argv, '--inject')) {
        next.memory.injectOverview = true;
      }
      await savePiwinConfig(next, root);
      console.log(
        `memory.enabled=${next.memory.enabled} injectOverview=${next.memory.injectOverview !== false}`,
      );
      return;
    }

    if (sub === 'list') {
      const response = await runtime.handleCommand({ type: 'memory/list', filter: { limit: 100 } });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const data = response.data as { records: Array<Record<string, unknown>> };
      for (const record of data.records ?? []) {
        console.log(
          `${record.id}\t${record.scope}/${record.type}\t${record.confidence}\t${record.title ?? ''}\t${String(record.content ?? '').slice(0, 80)}`,
        );
      }
      return;
    }

    if (sub === 'search') {
      const query = argv.slice(2).filter((token) => !token.startsWith('--')).join(' ').trim();
      if (!query) {
        console.error('Usage: piwin memory search <query>');
        process.exitCode = 1;
        return;
      }
      const response = await runtime.handleCommand({
        type: 'memory/search',
        query: { query, limit: 20 },
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const data = response.data as {
        hits: Array<{ record: Record<string, unknown>; snippet?: string }>;
      };
      for (const hit of data.hits ?? []) {
        console.log(
          `${hit.record.id}\t${hit.snippet ?? String(hit.record.content ?? '').slice(0, 100)}`,
        );
      }
      return;
    }

    if (sub === 'write') {
      const content = argv.slice(2).filter((token) => !token.startsWith('--')).join(' ').trim();
      const title = readOption(argv, '--title');
      const scope = readOption(argv, '--scope') === 'project' ? 'project' : 'global';
      if (!content) {
        console.error('Usage: piwin memory write <content> [--title t] [--scope global|project]');
        process.exitCode = 1;
        return;
      }
      const input: {
        scope: 'global' | 'project';
        type: 'user';
        content: string;
        title?: string;
        projectKey?: string;
      } = { scope, type: 'user', content };
      if (title) input.title = title;
      if (scope === 'project') {
        const { projectKeyFromPath } = await import('@piwin/memory');
        input.projectKey = projectKeyFromPath(parseProject(argv));
      }
      const response = await runtime.handleCommand({ type: 'memory/write', input });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      const data = response.data as { record: { id: string } };
      console.log(`wrote ${data.record.id}`);
      return;
    }

    if (sub === 'delete') {
      const memoryId = argv[2];
      if (!memoryId) {
        console.error('Usage: piwin memory delete <id>');
        process.exitCode = 1;
        return;
      }
      const response = await runtime.handleCommand({ type: 'memory/delete', memoryId });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(`deleted ${memoryId}`);
      return;
    }

    if (sub === 'quota') {
      const response = await runtime.handleCommand({ type: 'memory/quota' });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(response.data, null, 2));
      return;
    }

    console.error('Usage: piwin memory list|search|write|delete|quota|enable|disable');
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

async function commandHostServe(argv: string[]): Promise<void> {
  const mode = parseMode(argv);
  const mock = parseMock(argv);
  const runtime = new HostRuntime({
    mode,
    mock,
    onPush: (message) => {
      writeJsonLine(message);
    },
  });

  writeJsonLine({
    type: 'host/status',
    mode: runtime.getMode(),
    ready: true,
    mock,
  });

  const readlineInterface = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  const shutdown = async (): Promise<void> => {
    readlineInterface.close();
    await runtime.dispose();
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
      writeJsonLine({
        type: 'response',
        command: 'parse',
        success: false,
        error: 'invalid JSON command line',
      });
      continue;
    }
    const response = await runtime.handleCommand(command);
    writeJsonLine(response);
  }

  await shutdown();
}

function writeJsonLine(message: HostServerMessage | Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
  if (command === 'memory') {
    await commandMemory(argv);
    return;
  }
  if (command === 'host' && argv[1] === 'serve') {
    await commandHostServe(argv);
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
