#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { access, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  getPiwinRoot,
  HostRuntime,
  type HostRuntimeTestFixture,
  initPiwinConfig,
  loadPiwinConfig,
  ensureBundledExtensionsInstalled,
  ensureBundledPromptsInstalled,
  loadDiscoveredResources,
  createSecretResolver,
  getPiwinSessionIndexPath,
  getPiwinSessionsDir,
  listInterruptedTranscriptMigrations,
  repairInterruptedTranscriptMigration,
} from '@piwin/host-runtime';
import type {
  AgentEvent,
  HostCommand,
  HostMode,
  HostPush,
  HostRuntimeResourcesData,
  HostServerMessage,
  HostStatusData,
  PermissionMode,
  SessionColdStorageStatus,
  UsageRollup,
} from '@piwin/contracts';
import {
  computePromptCacheHitRate,
  formatCapabilityMatrixLines,
  formatError,
} from '@piwin/contracts';
import type { PromptAttachment } from '@piwin/contracts';
import { connectCliAttachedHost, readCliHostAttachTarget } from './attach-existing-host.js';
import { formatRuntimeResourcesLines } from './runtime-resources-format.js';
import { openCliHost, type CliHostHandle } from './cli-host.js';
import { saveAttachedCliImageAttachment, saveLocalCliImageAttachment } from './cli-prompt-image.js';
import { ensureBundledSkillsInstalled, scanSkills } from '@piwin/skills';
import { loadMcpConfig, saveMcpConfig, tryValidateMcpConfig, listEnabledServers } from '@piwin/mcp';
import { installSkill, installExtension, RECOMMENDED_SKILLS } from '@piwin/marketplace';
import {
  installPlugin,
  loadInstalledPlugins,
  removeInstalledPlugin,
  fetchPluginRegistry,
  DEFAULT_PLUGIN_REGISTRY_URL,
} from '@piwin/marketplace';
import { pluginSecretRef, type PluginInstallSource } from '@piwin/contracts';
import { admitAndExecuteHostCommand, createDeviceToolBrokerForHost } from '@piwin/host-server';
import { createSidecarHostAuthority, LOCAL_JSONL_CLIENT_ID } from './sidecar-host-authority.js';
import { collectRefArgs, buildCliContextRefs } from './context-ref-args.js';

import { createHostServeDispatcher } from './host-serve-dispatcher.js';
import { createCliExtensionUiRequestHandler } from './extension-ui-cli.js';
import { createJsonlStdioTransport } from './host-serve-transport.js';
import { createSidecarMobileAccess, interceptSidecarMobileAccess } from './mobile-access-serve.js';
import { parsePermissionModeOverride } from './permission-mode-override.js';
import { resolveCliChatPrompt } from './chat-prompt.js';
import { resolveHostDataRoot } from './host-data-root.js';
import { formatCliFlashcardToolResult } from './flashcard-tool-result.js';
import { formatCliAgentErrorEvent } from './cli-agent-error.js';
import {
  runWalkthroughList,
  runWalkthroughGenerate,
  runWalkthroughExport,
  type WalkthroughHostClient,
} from './walkthrough-command.js';
import { runAuthCommand } from './auth-command.js';
import { bindStudyHostClient, runStudyCommand, type StudyHostClient } from './study-command.js';
import {
  bindSideChatHostClient,
  type SideChatHostClient,
  runSideChatList,
  runSideChatOpen,
  runSideChatSync,
  runSideChatSend,
  runSideChatResume,
} from './side-chat-command.js';
import { runSessionLifecycleApply, runSessionLifecyclePlan } from './session-lifecycle-command.js';
import {
  runSessionQueueCancel,
  runSessionQueueEdit,
  runSessionQueueList,
  runSessionQueueReorder,
  runSessionReplaceRun,
} from './session-queue-command.js';
import { runContextSummary } from './context-command.js';
import {
  runSessionPackCreate,
  runSessionPackList,
  runSessionPackVerify,
} from './session-pack-command.js';
import {
  runSessionColdStorageExecute,
  runSessionColdStorageImport,
  runSessionColdStoragePlan,
  runSessionColdStorageReconcile,
  runSessionColdStorageRestore,
  runSessionColdStorageStatus,
  formatDoctorColdStorageLines,
} from './session-cold-storage-command.js';
import {
  runSessionBranches,
  runSessionContinue,
  runSessionRetry,
  runSessionSwitch,
} from './session-branch-command.js';
import { runTurnRedo, runTurnUndo } from './turn-change-command.js';
import { runSubagentResult, runSubagentResults } from './subagent-result-command.js';

function printHelp(): void {
  console.log(`piwin — private coding agent shell

Usage:
  piwin doctor [--repair-transcripts]
  piwin host-mode
  piwin config init
  piwin config show
  piwin session list [--project <path>] [--mock]
  piwin session pin <sessionId> [--mock]
  piwin session unpin <sessionId> [--mock]
  piwin session pause <sessionId> [--run-id <runId>] [--mock]
  piwin session resume-run <sessionId> [--checkpoint <checkpointId>] [--mock]
  piwin session queue list <sessionId> [--mock]
  piwin session queue edit <sessionId> <queuedTurnId> --text <text> [--revision n] [--mock]
  piwin session queue cancel <sessionId> <queuedTurnId> [--revision n] [--mock]
  piwin session queue reorder <sessionId> <queuedTurnId...> [--revision n] [--mock]
  piwin session replace <sessionId> <runId> <text> [--queued-id id] [--user-message-id id] [--mock]
  piwin session search <query> [--project <path>] [--mock]
  piwin session export <id> --format md|html [--redact-tools] [--out <path>] [--mock]
  piwin session branches <sessionId> [--mock]
  piwin session switch <sessionId> <messageId> [--confirm] [--mock]
  piwin session continue <sessionId> [--mock]
  piwin session retry <sessionId> <userMessageId> [--keep] [--confirm] [--mock]
  piwin session lifecycle plan [--mock]
  piwin session pack create <sessionId> --out <host-dir> [--pack-id <id>] [--mock]
  piwin session pack verify <packPath> [--mock]
  piwin session pack list --dir <host-dir> [--mock]
  piwin session cold status [--mock]
  piwin session cold plan [--session <id>] [--mock]
  piwin session cold execute --plan <plan-id> --confirm <digest> [--mock]
  piwin session cold restore <sessionId> [--pack <path>] [--mock]
  piwin session cold import --pack <path> [--mock]
  piwin session cold reconcile [--mock]
  piwin session lifecycle apply --plan <plan-id> [--mock]
  piwin status [--project <path>] [--mock]
  piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass] [--scheme <id>] [--ref <path>…]
  piwin scheme list [--mock]
  piwin scheme show <id> [--mock]
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
  piwin plugin list
  piwin plugin install --local <dir> | --git <url> | --registry <id> | --bundled <id> [--secret KEY=VAL...]
  piwin plugin uninstall <id>
  piwin plugin registry [--url <url>]
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
  piwin cards study <catalog|start|get|claim|checkpoint|next|rate|undo|pause|resume|end|operation>
  piwin study catalog [--query q] [--cursor c] [--limit n] [--deck d]
  piwin study start sequence --item <id> | --sequence <id>
  piwin study start scheduled [--deck d]
  piwin study get <roundId> | claim <roundId> --revision n --epoch n
  piwin study checkpoint <roundId> --revision n --epoch n --entry id --content-version v --face question|answer
  piwin study next|rate|undo|pause|resume|end|operation   (Host snapshot; no tear / no touch)
  piwin doccards scan <folder>
  piwin doccards index <folder>
  piwin doccards retrieve <folder> <query> [--limit n]
  piwin doccards list <folder>
  piwin doccards generate <folder> [--topic t] [--limit n]   (print generation prompt)
  piwin doccards rebind <oldPath> <newPath>
  piwin doccards forget <folder>
  piwin cron list [--mock]
  piwin usage [--project <path> | --global] [--mock]
  piwin auth status | login <kimi-coding|openai-codex|anthropic|xai|github-copilot> | logout <id>
  piwin walkthrough list <session-id>
  piwin walkthrough generate <session-id> <message-id>
  piwin walkthrough export <session-id> <message-id> [--output <path>]
  piwin context <sessionId> [--mock]
  piwin subagent status <runId>
  piwin subagent cancel <runId>
  piwin subagent results <parentSessionId>
  piwin subagent result <resultId>
  piwin turn undo <changeSetId> --expected-version <revision>
  piwin turn redo <changeSetId> --expected-version <revision>
  piwin side-chat list <source-session-id> [--include-archived]
  piwin side-chat open <source-session-id> [--name <name>] [--message <message-id>]
  piwin side-chat sync <side-chat-session-id>
  piwin side-chat send <side-chat-session-id> <text>
  piwin side-chat resume <side-chat-session-id>

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

function parseCliRevision(value: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid revision: ${value}`);
  }
  return revision;
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

/**
 * Stateful assistant event formatter for the CLI.
 * Accumulates thinking deltas into a block and tool output per tool call.
 */
function createAssistantCliDisplay() {
  let thinkingBuffer = '';
  let sawTextDelta = false;
  let composingAnnounced = false;

  return {
    /** Process one AgentEvent, return the string to write (or null for no-op). */
    feed(event: AgentEvent): string | null {
      switch (event.type) {
        case 'message/text_delta':
          // Flush any buffered thinking block before text starts
          if (thinkingBuffer) {
            const block = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
            sawTextDelta = true;
            return block + event.delta;
          }
          sawTextDelta = true;
          return event.delta;

        case 'message/text_snapshot':
          // Snapshot is a full cumulative replacement; only emit if we never
          // streamed deltas for this message (otherwise it would duplicate).
          if (sawTextDelta) return null;
          return event.text;

        case 'message/thinking_delta':
          thinkingBuffer += event.delta;
          return null; // buffer until text starts or message ends

        case 'message/start':
          sawTextDelta = false;
          composingAnnounced = false;
          return '\n';

        case 'message/tool_args_progress':
          if (composingAnnounced) return null;
          composingAnnounced = true;
          return event.toolName ? `\n[composing:${event.toolName}]` : '\n[composing]';

        case 'message/end': {
          // Flush remaining thinking buffer
          let out = '';
          if (thinkingBuffer) {
            out = `\n[thinking]\n${thinkingBuffer.trimEnd()}\n[/thinking]\n`;
            thinkingBuffer = '';
          }
          sawTextDelta = false;
          return out || null;
        }

        case 'tool/start':
          return `\n[tool:${event.toolName}]`;

        case 'tool/update':
          if (!event.delta) return null;
          return event.delta;

        case 'tool/end':
          if (event.isError) {
            return `\n[tool:error] ${event.toolCallId}\n`;
          }
          {
            const flashcardText = formatCliFlashcardToolResult(event.presentation);
            if (flashcardText) return `\n${flashcardText}\n`;
          }
          return '\n';

        case 'error':
          return formatCliAgentErrorEvent(event);

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
    },
  };
}

function printCliWaitingResource(push: HostPush, seen: { printed: boolean }): void {
  if (seen.printed || push.type !== 'run/updated' || push.run.phase !== 'waiting-resource') {
    return;
  }
  seen.printed = true;
  const reason =
    push.run.phaseDetail === 'execution-slot'
      ? 'waiting for an execution slot'
      : 'waiting for runtime capacity';
  console.error(`[run] ${push.run.runId} ${reason}`);
}

async function commandDoctor(args: string[] = []): Promise<void> {
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
    const browserStatus = getBrowserInstallStatus();
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

async function commandHostMode(): Promise<void> {
  const sdkRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-host-mode-sdk-'));
  const rpcRoot = await mkdtemp(join(tmpdir(), 'piwin-cli-host-mode-rpc-'));
  const sdkRuntime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot: sdkRoot });
  const rpcRuntime = new HostRuntime({ mode: 'rpc', mock: true, piwinRoot: rpcRoot });
  console.log(`sdk runtime mode=${sdkRuntime.getMode()}`);
  console.log(`rpc runtime mode=${rpcRuntime.getMode()}`);
  await sdkRuntime.dispose();
  await rpcRuntime.dispose();
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
  const runtime = await openCliHost({ mode, mock });

  try {
    if (sub === 'lifecycle') {
      const action = argv[2] ?? 'plan';
      try {
        if (action === 'plan') {
          await runSessionLifecyclePlan(runtime, console.log);
          return;
        }
        if (action === 'apply') {
          const planId = readOption(argv, '--plan');
          if (!planId) {
            console.error('Usage: piwin session lifecycle apply --plan <plan-id> [--mock]');
            process.exitCode = 1;
            return;
          }
          const result = await runSessionLifecycleApply(runtime, planId, console.log);
          if (result.failed.length > 0) {
            process.exitCode = 2;
          }
          return;
        }
        console.error(`Unknown lifecycle action: ${action}`);
        console.error('Usage: piwin session lifecycle plan|apply --plan <plan-id>');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'cold') {
      const action = argv[2] ?? 'status';
      try {
        if (action === 'status') {
          await runSessionColdStorageStatus(runtime, console.log);
          return;
        }
        if (action === 'plan') {
          const sessionId = readOption(argv, '--session');
          await runSessionColdStoragePlan(
            runtime,
            sessionId ? [sessionId] : undefined,
            console.log,
          );
          return;
        }
        if (action === 'execute') {
          const planId = readOption(argv, '--plan');
          const confirmationDigest = readOption(argv, '--confirm');
          if (!planId || !confirmationDigest) {
            console.error(
              'Usage: piwin session cold execute --plan <plan-id> --confirm <digest> [--mock]',
            );
            process.exitCode = 1;
            return;
          }
          const result = await runSessionColdStorageExecute(
            runtime,
            { planId, confirmationDigest },
            console.log,
          );
          if (result.failed.length > 0) {
            process.exitCode = 2;
          }
          return;
        }
        if (action === 'restore') {
          const sessionId = argv[3];
          const packPath = readOption(argv, '--pack');
          if (!sessionId) {
            console.error('Usage: piwin session cold restore <sessionId> [--pack <path>] [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionColdStorageRestore(
            runtime,
            { sessionId, ...(packPath ? { packPath } : {}) },
            console.log,
          );
          return;
        }
        if (action === 'import') {
          const packPath = readOption(argv, '--pack');
          if (!packPath) {
            console.error('Usage: piwin session cold import --pack <path> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionColdStorageImport(runtime, packPath, console.log);
          return;
        }
        if (action === 'reconcile') {
          await runSessionColdStorageReconcile(runtime, console.log);
          return;
        }
        console.error(`Unknown cold action: ${action}`);
        console.error('Usage: piwin session cold status|plan|execute|restore|import|reconcile');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'pack') {
      const action = argv[2] ?? 'list';
      try {
        if (action === 'create') {
          const sessionId = argv[3];
          const outputDir = readOption(argv, '--out');
          const packId = readOption(argv, '--pack-id');
          if (!sessionId || !outputDir) {
            console.error(
              'Usage: piwin session pack create <sessionId> --out <host-dir> [--pack-id <id>] [--mock]',
            );
            process.exitCode = 1;
            return;
          }
          await runSessionPackCreate(
            runtime,
            {
              sessionId,
              outputDir,
              ...(packId ? { packId } : {}),
            },
            console.log,
          );
          return;
        }
        if (action === 'verify') {
          const packPath = argv[3];
          if (!packPath) {
            console.error('Usage: piwin session pack verify <packPath> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionPackVerify(runtime, packPath, console.log);
          return;
        }
        if (action === 'list') {
          const directory = readOption(argv, '--dir');
          if (!directory) {
            console.error('Usage: piwin session pack list --dir <host-dir> [--mock]');
            process.exitCode = 1;
            return;
          }
          await runSessionPackList(runtime, directory, console.log);
          return;
        }
        console.error(`Unknown pack action: ${action}`);
        console.error('Usage: piwin session pack create|verify|list ...');
        process.exitCode = 1;
        return;
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

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

    if (sub === 'queue') {
      const action = argv[2] ?? 'list';
      const sessionId = argv[3];
      if (!sessionId) {
        console.error(
          'Usage: piwin session queue list|edit|cancel|reorder <sessionId> [options] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        if (action === 'list') {
          await runSessionQueueList(runtime, sessionId, console.log);
          return;
        }
        const revisionOption = readOption(argv, '--revision');
        const expectedRevision =
          revisionOption === undefined ? undefined : parseCliRevision(revisionOption);
        if (action === 'edit') {
          const queuedTurnId = argv[4];
          const text = readOption(argv, '--text')?.trim();
          if (!queuedTurnId || !text) {
            throw new Error(
              'Usage: piwin session queue edit <sessionId> <queuedTurnId> --text <text> [--revision n] [--mock]',
            );
          }
          const updated = await runSessionQueueEdit(
            runtime,
            sessionId,
            queuedTurnId,
            text,
            expectedRevision,
          );
          console.log(JSON.stringify(updated, null, 2));
          return;
        }
        if (action === 'cancel') {
          const queuedTurnId = argv[4];
          if (!queuedTurnId) {
            throw new Error(
              'Usage: piwin session queue cancel <sessionId> <queuedTurnId> [--revision n] [--mock]',
            );
          }
          const cancelled = await runSessionQueueCancel(
            runtime,
            sessionId,
            queuedTurnId,
            expectedRevision,
          );
          console.log(JSON.stringify(cancelled, null, 2));
          return;
        }
        if (action === 'reorder') {
          const orderedIds = collectPositionals(argv.slice(4), ['--revision']);
          if (orderedIds.length === 0) {
            throw new Error(
              'Usage: piwin session queue reorder <sessionId> <queuedTurnId...> [--revision n] [--mock]',
            );
          }
          const reordered = await runSessionQueueReorder(
            runtime,
            sessionId,
            orderedIds,
            expectedRevision,
          );
          console.log(JSON.stringify(reordered, null, 2));
          return;
        }
        throw new Error(`Unknown queue action: ${action}`);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
        return;
      }
    }

    if (sub === 'replace') {
      const sessionId = argv[2];
      const runId = argv[3];
      const text = collectPositionals(argv.slice(4), ['--queued-id', '--user-message-id'])
        .join(' ')
        .trim();
      if (!sessionId || !runId || !text) {
        console.error(
          'Usage: piwin session replace <sessionId> <runId> <text> [--queued-id id] [--user-message-id id] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        const replaced = await runSessionReplaceRun(runtime, sessionId, runId, text, {
          queuedTurnId: readOption(argv, '--queued-id') ?? randomUUID(),
          userMessageId: readOption(argv, '--user-message-id') ?? randomUUID(),
        });
        console.log(JSON.stringify(replaced, null, 2));
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'pause' || sub === 'resume-run') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error(
          `Usage: piwin session ${sub} <sessionId>${
            sub === 'pause' ? ' [--run-id <runId>]' : ' [--checkpoint <checkpointId>]'
          } [--mock]`,
        );
        process.exitCode = 1;
        return;
      }
      const runId = readOption(argv, '--run-id');
      const checkpointId = readOption(argv, '--checkpoint');
      const command: HostCommand =
        sub === 'pause'
          ? { type: 'session/pause', sessionId, ...(runId ? { runId } : {}) }
          : { type: 'session/resume-run', sessionId, ...(checkpointId ? { checkpointId } : {}) };
      const response = await runtime.handleCommand(command);
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(response.data ?? {}, null, 2));
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

    if (sub === 'branches') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error('Usage: piwin session branches <sessionId> [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionBranches(runtime, sessionId, console.log);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'continue') {
      const sessionId = argv[2];
      if (!sessionId) {
        console.error('Usage: piwin session continue <sessionId> [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionContinue(runtime, sessionId, console.log);
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'retry') {
      const sessionId = argv[2];
      const userMessageId = argv[3];
      if (!sessionId || !userMessageId) {
        console.error(
          'Usage: piwin session retry <sessionId> <userMessageId> [--keep] [--confirm] [--mock]',
        );
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionRetry(runtime, sessionId, userMessageId, console.log, {
          keepPrevious: argv.includes('--keep'),
          confirm: argv.includes('--confirm'),
        });
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    if (sub === 'switch') {
      const sessionId = argv[2];
      const messageId = argv[3];
      if (!sessionId || !messageId) {
        console.error('Usage: piwin session switch <sessionId> <messageId> [--confirm] [--mock]');
        process.exitCode = 1;
        return;
      }
      try {
        await runSessionSwitch(runtime, sessionId, messageId, console.log, {
          confirm: argv.includes('--confirm'),
        });
      } catch (error) {
        console.error(formatError(error));
        process.exitCode = 1;
      }
      return;
    }

    console.error(`Unknown session subcommand: ${sub}`);
    console.error(
      'Usage: piwin session list|pin|unpin|pause|resume-run|queue|replace|search|export|branches|switch|retry|lifecycle|pack|cold',
    );
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

async function commandStatus(argv: string[]): Promise<void> {
  const runtime = await openCliHost({
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
    const resources = await runtime.handleCommand({ type: 'host/runtime-resources' });
    if (resources.success) {
      console.log('--- runtime residency ---');
      for (const line of formatRuntimeResourcesLines(resources.data as HostRuntimeResourcesData)) {
        console.log(`- ${line}`);
      }
    } else {
      console.log(`- runtime residency: (unavailable: ${resources.error})`);
    }
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
      token === '--permission-mode' ||
      token === '--scheme' ||
      token === '--ref'
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
  const resolvedChatPrompt = resolveCliChatPrompt(message);
  const imagePath = readOption(argv, '--image');
  if (!message && !imagePath) {
    console.error(
      'Usage: piwin chat <text> [--project <path>] [--mode sdk|rpc] [--mock] [--image <path>] [--permission-mode auto|ask-all|bypass] [--scheme <id>] [--ref <path>…]',
    );
    process.exitCode = 1;
    return;
  }

  const attachTarget = readCliHostAttachTarget();
  const attachments: PromptAttachment[] = [];
  if (imagePath && !attachTarget) {
    const saved = await saveLocalCliImageAttachment(imagePath);
    attachments.push(saved.attachment);
    console.error(`[media] saved ${saved.logPath}`);
    const config = await loadPiwinConfig(getPiwinRoot());
    const defaultProvider = config.providers.find((item) => item.id === config.defaultProviderId);
    const defaultModel = defaultProvider?.models.find((item) => item.id === config.defaultModelId);
    const supportsImage = defaultModel?.input?.includes('image') === true;
    if (!supportsImage) {
      if (config.visionDelegation?.enabled && config.visionDelegation.model) {
        console.error(
          `[media] default model is text-only; vision delegation will describe the image via ${config.visionDelegation.model.providerId}/${config.visionDelegation.model.modelId}`,
        );
      } else {
        console.error(
          '[media] default model is text-only (or input unset); host will path-inject the image. Mark model input as image or enable visionDelegation for descriptions.',
        );
      }
    }
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
  if (attachTarget) {
    if (projectPath && !/^project-[a-f0-9]{24}$/.test(projectPath)) {
      console.error(
        'PIWIN_HOST_URL is set; --project must be a Host projectId, not a local folder.',
      );
      process.exitCode = 1;
      return;
    }
    const client = await connectCliAttachedHost(attachTarget);
    let resolveAttachedCompletion: (() => void) | undefined;
    let rejectAttachedCompletion: ((error: Error) => void) | undefined;
    const attachedCompletion = new Promise<void>((resolve, reject) => {
      resolveAttachedCompletion = resolve;
      rejectAttachedCompletion = reject;
    });
    const attachedPromptTimeoutMs = 10 * 60 * 1000;
    const attachedTimeout = setTimeout(() => {
      rejectAttachedCompletion?.(
        new Error(
          `Attached Host prompt timed out after ${attachedPromptTimeoutMs}ms waiting for run/terminal`,
        ),
      );
    }, attachedPromptTimeoutMs);
    const attachedDisplay = createAssistantCliDisplay();
    const attachedWaiting = { printed: false };
    const unsubscribe = client.subscribePush((push) => {
      if (push.type === 'run/terminal') {
        resolveAttachedCompletion?.();
        return;
      }
      printCliWaitingResource(push, attachedWaiting);
      if (push.type !== 'event') {
        return;
      }
      const line = attachedDisplay.feed(push.event);
      if (line !== null) {
        process.stdout.write(line);
      }
    });
    try {
      const createResponse = await client.request(
        {
          type: 'session/create',
          input: projectPath ? { projectId: projectPath } : { scope: { kind: 'general' } },
        },
        { idempotencyKey: randomUUID() },
      );
      if (!createResponse.success) {
        throw new Error(createResponse.error);
      }
      const sessionId = (createResponse.data as { sessionId: string }).sessionId;
      console.error(`session ${sessionId}`);
      if (imagePath) {
        const saved = await saveAttachedCliImageAttachment({
          request: (command) => client.request(command),
          sessionId,
          imagePath,
        });
        attachments.push(saved.attachment);
        console.error(`[media] saved ${saved.logPath}`);
      }
      const schemeId = readOption(argv, '--scheme')?.trim();
      const refArgs = collectRefArgs(argv);
      const refsResult =
        refArgs.length > 0 ? await buildCliContextRefs(projectPath, refArgs) : null;
      if (refsResult && !refsResult.ok) {
        console.error(`[ref] ${refsResult.reason}`);
        process.exitCode = 1;
        return;
      }
      const promptResponse = await client.request(
        {
          type: 'session/prompt',
          sessionId,
          input: {
            text: resolvedChatPrompt.text,
            ...(resolvedChatPrompt.skillId ? { skillId: resolvedChatPrompt.skillId } : {}),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(refsResult && refsResult.ok && refsResult.refs.length > 0
              ? { contextRefs: refsResult.refs }
              : {}),
            ...(schemeId && schemeId !== 'off' ? { orchestrationSchemeId: schemeId } : {}),
          },
          foreground: { kind: 'if-idle' },
        },
        { idempotencyKey: randomUUID() },
      );
      if (!promptResponse.success) {
        throw new Error(promptResponse.error);
      }
      const attachedRunId = (promptResponse.data as { runId?: string } | undefined)?.runId;
      if (typeof attachedRunId === 'string') {
        console.error(`run ${attachedRunId}`);
      }
      await attachedCompletion;
      process.stdout.write('\n');
    } finally {
      clearTimeout(attachedTimeout);
      unsubscribe();
      await client.close();
    }
    return;
  }

  let resolvePromptCompletion: (() => void) | undefined;
  let rejectPromptCompletion: ((error: Error) => void) | undefined;
  const promptCompletion = new Promise<void>((resolve, reject) => {
    resolvePromptCompletion = resolve;
    rejectPromptCompletion = reject;
  });
  const localPromptTimeoutMs = 10 * 60 * 1000;
  const localPromptTimeout = setTimeout(() => {
    rejectPromptCompletion?.(
      new Error(
        `Local Host prompt timed out after ${localPromptTimeoutMs}ms waiting for run/terminal`,
      ),
    );
  }, localPromptTimeoutMs);
  const display = createAssistantCliDisplay();
  const localWaiting = { printed: false };
  const runtime = new HostRuntime({
    mode,
    mock,
    onPush: (push) => {
      if (push.type === 'run/terminal') {
        resolvePromptCompletion?.();
        return;
      }
      printCliWaitingResource(push, localWaiting);
      if (push.type !== 'event') {
        return;
      }
      const line = display.feed(push.event);
      if (line !== null) {
        process.stdout.write(line);
      }
    },
    ...(permissionModeOverride !== undefined ? { permissionModeOverride } : {}),
  });

  try {
    const createResponse = await runtime.handleCommand({
      type: 'session/create',
      input: projectPath
        ? { scope: { kind: 'project', projectPath }, projectPath }
        : { scope: { kind: 'general' } },
    });
    if (!createResponse.success) {
      throw new Error(createResponse.error);
    }
    const sessionId = (createResponse.data as { sessionId: string }).sessionId;
    console.error(`session ${sessionId}`);
    const schemeId = readOption(argv, '--scheme')?.trim();
    // CM-18: `--ref <path>` (repeatable) maps to structured context refs.
    const refArgs = collectRefArgs(argv);
    const refsResult = refArgs.length > 0 ? await buildCliContextRefs(projectPath, refArgs) : null;
    if (refsResult && !refsResult.ok) {
      console.error(`[ref] ${refsResult.reason}`);
      process.exitCode = 1;
      return;
    }
    const promptResponse = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: {
        text: resolvedChatPrompt.text,
        ...(resolvedChatPrompt.skillId ? { skillId: resolvedChatPrompt.skillId } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(refsResult && refsResult.ok && refsResult.refs.length > 0
          ? { contextRefs: refsResult.refs }
          : {}),
        ...(schemeId && schemeId !== 'off' ? { orchestrationSchemeId: schemeId } : {}),
      },
    });
    if (!promptResponse.success) {
      throw new Error(promptResponse.error);
    }
    const localRunId = (promptResponse.data as { runId?: string } | undefined)?.runId;
    if (typeof localRunId === 'string') {
      console.error(`run ${localRunId}`);
    }
    await promptCompletion;
    process.stdout.write('\n');
  } finally {
    clearTimeout(localPromptTimeout);
    await runtime.dispose();
  }
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
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: scanOptions.projectPath,
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    });
    const visibleSkills = discovered.skills.filter((s) => s.hidden !== true);
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
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: parseProject(argv),
      ...(config.extensions ? { extensionsConfig: config.extensions } : {}),
    });
    const extensions = discovered.extensions;
    if (extensions.length === 0) {
      console.log('(no extensions found under ~/.piwin/extensions or Pi packages)');
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
    const subdir = readOption(argv, '--subdir');
    const ref = readOption(argv, '--ref');
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
        source: {
          kind: 'git',
          url: gitUrl,
          ...(subdir ? { subdir } : {}),
          ...(ref ? { ref } : {}),
        },
      };
      if (name) installOptions.name = name;
      const result = await installExtension(installOptions);
      console.log(`installed extension ${result.extensionId} -> ${result.targetPath}`);
      return;
    }
    console.error(
      'Usage: piwin extension install --local <file|dir> | --git <url> [--subdir <path>] [--ref <branch|tag>] [--name <id>]',
    );
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
    const discovered = await loadDiscoveredResources({
      piwinRoot: root,
      projectPath: parseProject(argv),
      ...(config.prompts ? { promptsConfig: config.prompts } : {}),
    });
    const prompts = discovered.prompts;
    if (prompts.length === 0) {
      console.log('(no prompt templates under ~/.piwin/prompts or Pi packages)');
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

async function commandPlugin(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();

  if (sub === 'list') {
    const plugins = await loadInstalledPlugins(root);
    if (plugins.length === 0) {
      console.log('(no plugins installed)');
      return;
    }
    for (const plugin of plugins) {
      console.log(
        `${plugin.id}\tv${plugin.version}\t${plugin.name}\tskills:${plugin.skills.length}\tmcp:${plugin.mcpServerIds.length}`,
      );
    }
    return;
  }

  if (sub === 'install') {
    const localPath = readOption(argv, '--local');
    const gitUrl = readOption(argv, '--git');
    const registryId = readOption(argv, '--registry');
    const bundledId = readOption(argv, '--bundled');
    const secretArgs = argv.filter((a) => a.startsWith('--secret='));
    const secrets: Record<string, string> = {};
    for (const arg of secretArgs) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const key = arg.slice('--secret='.length, eq);
        const value = arg.slice(eq + 1);
        if (key && value) {
          secrets[key] = value;
        }
      }
    }

    let source: PluginInstallSource;
    if (localPath) {
      source = { kind: 'local', path: resolve(localPath) };
    } else if (gitUrl) {
      source = { kind: 'git', url: gitUrl };
    } else if (bundledId) {
      source = { kind: 'bundled', bundledId };
    } else if (registryId) {
      source = { kind: 'registry', registryId };
    } else {
      console.error(
        'plugin install requires --local <dir>, --git <url>, --registry <id>, or --bundled <id>',
      );
      process.exitCode = 1;
      return;
    }

    const secretResolver = createSecretResolver();
    try {
      const result = await installPlugin({
        piwinRoot: root,
        source,
        ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
        writeSecret: async (ref, value) => {
          await secretResolver.writeSecretByRef(ref, value);
        },
        mergeMcpServer: async (serverId, config) => {
          const doc = await loadMcpConfig(root);
          doc.mcpServers[serverId] = config;
          await saveMcpConfig(root, doc);
        },
        ...(registryId
          ? {
              resolveRegistrySource: async (id: string) => {
                const index = await fetchPluginRegistry(DEFAULT_PLUGIN_REGISTRY_URL);
                const entry = index.plugins.find((p) => p.id === id);
                if (!entry) {
                  throw new Error(`Plugin "${id}" not found in registry`);
                }
                return entry.source;
              },
            }
          : {}),
      });
      console.log(
        `installed ${result.pluginId}: ${result.installedSkills.length} skills, ${result.mcpServerIds.length} MCP servers, ${result.secretRefs.length} secrets`,
      );
    } catch (error) {
      const message = formatError(error);
      console.error(`plugin install failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'uninstall') {
    const pluginId = argv[2];
    if (!pluginId) {
      console.error('plugin uninstall requires a plugin id');
      process.exitCode = 1;
      return;
    }
    try {
      const removed = await removeInstalledPlugin(root, pluginId);
      if (!removed) {
        console.error(`Plugin "${pluginId}" is not installed`);
        process.exitCode = 1;
        return;
      }
      // Remove owned skills.
      for (const skillId of removed.skills) {
        const skillPath = resolve(root, 'skills', skillId);
        await import('node:fs/promises').then((fs) =>
          fs.rm(skillPath, { recursive: true, force: true }).catch(() => undefined),
        );
      }
      // Remove owned MCP servers.
      if (removed.mcpServerIds.length > 0) {
        const doc = await loadMcpConfig(root);
        for (const serverId of removed.mcpServerIds) {
          delete doc.mcpServers[serverId];
        }
        await saveMcpConfig(root, doc);
      }
      console.log(`uninstalled ${removed.id}`);
    } catch (error) {
      const message = formatError(error);
      console.error(`plugin uninstall failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === 'registry') {
    const url = readOption(argv, '--url') ?? DEFAULT_PLUGIN_REGISTRY_URL;
    try {
      const index = await fetchPluginRegistry(url);
      if (index.plugins.length === 0) {
        console.log('(registry is empty)');
        return;
      }
      for (const entry of index.plugins) {
        console.log(`${entry.id}\tv${entry.version}\t${entry.name}\t${entry.source.kind}`);
      }
    } catch (error) {
      const message = formatError(error);
      console.error(`registry fetch failed: ${message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown plugin subcommand: ${sub}`);
  process.exitCode = 1;
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
        const { resolveNotesEmbeddingApiKey } = await import('@piwin/host-runtime');
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
        const { resolveNotesEmbeddingApiKey } = await import('@piwin/host-runtime');
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
  if (argv[1] === 'study') {
    await commandStudy(argv.slice(2));
    return;
  }
  const sub = argv[1] ?? 'list';
  const root = getPiwinRoot();
  const config = await loadPiwinConfig(root);
  if (config.flashcards?.enabled === false) {
    console.error('Flashcards disabled (config.flashcards.enabled=false).');
    process.exitCode = 1;
    return;
  }

  const { createCardStore, buildReviewQueue, exportCardsToTsv, itemPreviewText } =
    await import('@piwin/flashcards');
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
      console.log(
        `${card.id}\t${card.deck}\t${itemPreviewText(card).replaceAll('\n', ' ').slice(0, 80)}`,
      );
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
    const cards = await store.listReviewCards();
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
        console.log(`${item.card.cardId}\t[${label}]\t${item.card.front.slice(0, 70)}`);
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
        const next = await store.rate(item.card.cardId, rating);
        console.log(`  next due: ${next.due.slice(0, 16).replace('T', ' ')}`);
      }
      console.log('\nreview session done');
    } finally {
      readline.close();
    }
    return;
  }

  if (sub === 'export') {
    const cards = await store.listReviewCards(deck ? { deck } : undefined);
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

  console.error('Usage: piwin cards add|list|decks|show|delete|due|review|export|study');
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

  const { createFolderRag, canonicalizeFolderPath } = await import('@piwin/doc-rag');
  const { createEmbeddingProvider } = await import('@piwin/notes');
  const { createCardStore, itemPreviewText } = await import('@piwin/flashcards');
  const { resolveNotesEmbeddingApiKey } = await import('@piwin/host-runtime');

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
  let host: CliHostHandle | undefined;

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
      // CLI index stays on FolderRag (same process). Desktop HostCommand is async.
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
        console.log(`  ${card.id}\t${itemPreviewText(card).slice(0, 70)}${source}`);
      }
      return;
    }

    if (sub === 'generate') {
      const folderPath = argv[2];
      if (!folderPath) {
        console.error(
          'Usage: piwin doccards generate <folder> [--topic t] [--files a,b] [--dry-run] [--show-context] [--legacy-print-prompt]',
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

      if (hasFlag(argv, '--legacy-print-prompt')) {
        const { assembleDoccardsGeneratePrompt } = await import('./doccards-generate.js');
        try {
          const prompt = await assembleDoccardsGeneratePrompt({
            rag,
            folderPath: canonical,
            ...(topic ? { topic } : {}),
            limit,
            ...(fileAllowlist?.length ? { fileAllowlist } : {}),
            ...(difficulty ? { difficulty } : {}),
            ...(count ? { count } : {}),
          });
          process.stdout.write(`${prompt}\n`);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      if (hasFlag(argv, '--dry-run') || hasFlag(argv, '--show-context')) {
        const query = topic.trim() || basename(canonical);
        try {
          const chunks = await rag.retrieve(canonical, query, {
            limit,
            ...(fileAllowlist?.length ? { fileAllowlist } : {}),
          });
          console.log(`query: ${query}`);
          console.log(`passages: ${chunks.length}`);
          if (hasFlag(argv, '--show-context')) {
            for (const chunk of chunks) {
              console.log(`--- ${chunk.filePath}:${chunk.startLine}`);
              console.log(chunk.content);
            }
          }
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exitCode = 1;
        }
        return;
      }

      if (hasFlag(argv, '--show-kp')) {
        console.error('--show-kp requires the two-stage pipeline (P5).');
        process.exitCode = 1;
        return;
      }

      host = await openCliHost({
        mode,
        mock,
        piwinRoot: root,
      });
      const started = await host.handleCommand({
        type: 'doccards/generate',
        folderPath: canonical,
        ...(fileAllowlist?.length ? { includeFiles: fileAllowlist } : {}),
        ...(topic ? { topic } : {}),
      });
      if (!started.success) {
        console.error(started.error);
        process.exitCode = 1;
        return;
      }
      for (;;) {
        const status = await host.handleCommand({
          type: 'doccards/generation-status',
          folderPath: canonical,
        });
        if (!status.success) {
          console.error(status.error);
          process.exitCode = 1;
          return;
        }
        const job = (
          status.data as {
            job?: {
              status: string;
              created?: number;
              skipped?: number;
              createdCardIds?: string[];
              sessionId?: string;
              error?: string;
            } | null;
          }
        ).job;
        if (job && ['COMPLETED', 'COMPLETED_DEGRADED', 'FAILED', 'CANCELED'].includes(job.status)) {
          if (job.status === 'FAILED' || job.status === 'CANCELED') {
            console.error(job.error ? `${job.status}: ${job.error}` : job.status);
            process.exitCode = 1;
            return;
          }
          console.log(
            `created ${job.created ?? job.createdCardIds?.length ?? 0}, skipped ${job.skipped ?? 0}${
              job.sessionId ? `, session ${job.sessionId}` : ''
            }`,
          );
          if (hasFlag(argv, '--json')) {
            process.stdout.write(`${JSON.stringify(job)}\n`);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
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
  const transport = createJsonlStdioTransport();
  const hostDataRoot = resolveHostDataRoot();
  const runtimeOptions: ConstructorParameters<typeof HostRuntime>[0] = {
    mode,
    mock,
    piwinRoot: hostDataRoot,
  };
  // Source-tree multi-process E2E may pair the live Host source with an
  // explicitly built worker artifact. Packaged Desktop passes this option at
  // its own composition boundary and does not depend on this environment hook.
  const agentWorkerScript = process.env.PIWIN_AGENT_WORKER_SCRIPT?.trim();
  if (agentWorkerScript) {
    runtimeOptions.agentWorkerScript = resolve(agentWorkerScript);
  }
  if (testFixture !== undefined) {
    runtimeOptions.testFixture = testFixture;
  }
  if (permissionModeOverride !== undefined) {
    runtimeOptions.permissionModeOverride = permissionModeOverride;
  }
  const clientToolBroker = await createDeviceToolBrokerForHost(hostDataRoot);
  if (clientToolBroker !== undefined) {
    runtimeOptions.clientToolExecution = clientToolBroker;
  }
  const runtime = new HostRuntime(runtimeOptions);
  const authority = createSidecarHostAuthority(runtime);
  authority.start();
  const egressHub = authority.egressHub;
  const egressChannel = egressHub.addClient({
    id: LOCAL_JSONL_CLIENT_ID,
    initialSeq: 0,
    supportsBatch: true,
    canSend: () => true,
    send: (message) => {
      const localMessage = message.type === 'push/batch' ? message : message.push;
      void transport.send(localMessage).catch((error: unknown) => {
        console.error(
          `[piwin host serve] egress write failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
    },
    onSlowConsumer: (reason) => {
      console.error(`[piwin host serve] local egress closed: ${reason}`);
    },
  });

  egressHub.ingest({
    type: 'host/status',
    mode: runtime.getMode(),
    ready: true,
    mock,
  });

  // ADR 0015: control-lane commands (abort, permission resolve, …) bypass
  // the serialized mutation queue so Stop can reach an in-flight turn.
  // ADR 0027: dispatcher is transport-agnostic — it takes a `send` function,
  // so a future WebSocketTransport/GatewayDialTransport reuses it unchanged.
  const dispatcher = createHostServeDispatcher({
    runtime,
    send: (message) => transport.send(message),
    commandTimeoutMs: 45_000,
    admit: (request, execute) =>
      admitAndExecuteHostCommand({
        registry: authority.idempotencyRegistry,
        principalId: request.clientPrincipalId ?? LOCAL_JSONL_CLIENT_ID,
        idempotencyKey: request.idempotencyKey,
        command: request.command,
        execute,
      }),
  });
  const hostInstanceId = authority.hostInstanceId;
  let mobileAccess: Awaited<ReturnType<typeof createSidecarMobileAccess>> | undefined;
  try {
    mobileAccess = await createSidecarMobileAccess({
      runtime,
      instanceId: hostInstanceId,
      piwinRoot: hostDataRoot,
      egressHub,
      idempotencyRegistry: authority.idempotencyRegistry,
      ...(clientToolBroker === undefined ? {} : { clientToolBroker }),
    });
  } catch (error) {
    console.error(
      `[piwin host serve] phone-access store unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }
    shutdownPromise = (async (): Promise<void> => {
      // Stop reading first so EOF and SIGINT cannot admit more commands while
      // the existing command and stream work is being drained.
      await transport.stop();
      await dispatcher.drain();
      await mobileAccess?.dispose();
      egressHub.flush();
      egressChannel.flushNow();
      authority.dispose();
      await runtime.dispose();
    })();
    return shutdownPromise;
  };

  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });

  await transport.start((request) => {
    void interceptSidecarMobileAccess(mobileAccess, request.command, (message) =>
      transport.send(message),
    ).then((handled) => {
      if (!handled) {
        dispatcher.dispatch(request);
      }
    });
  });

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
  const runtime = await openCliHost({
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
  const runtime = await openCliHost({
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
        `cache read: ${formatUsageNumber(rollup.cacheReadTokens ?? 0)}  ` +
        `cache write: ${formatUsageNumber(rollup.cacheWriteTokens ?? 0)}  ` +
        `cache hit: ${formatUsageRate(computePromptCacheHitRate(rollup))}  ` +
        `sessions: ${rollup.sessionCount}  turns: ${rollup.entryCount}`,
    );
    if (rollup.firstAt) {
      console.log(`range: ${rollup.firstAt.slice(0, 10)} → ${rollup.lastAt?.slice(0, 10) ?? ''}`);
    }
    if (rollup.byModelKey.length > 0) {
      console.log('--- by model + key ---');
      for (const bucket of rollup.byModelKey) {
        const keyLabel = bucket.providerId ?? 'unknown (legacy)';
        console.log(
          `${bucket.modelId}\tkey=${keyLabel}\t${formatUsageNumber(bucket.totalTokens)} total\t` +
            `${formatUsageNumber(bucket.promptTokens)} in\t${formatUsageNumber(bucket.completionTokens)} out\t` +
            `${formatUsageNumber(bucket.cacheReadTokens ?? 0)} cache-read\t` +
            `${formatUsageNumber(bucket.cacheWriteTokens ?? 0)} cache-write\t` +
            `${formatUsageRate(computePromptCacheHitRate(bucket))} cache-hit`,
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

function formatUsageRate(value: number | null): string {
  return value === null ? 'unknown' : `${Math.round(value * 100)}%`;
}

async function commandContext(argv: string[]): Promise<void> {
  const sessionId = argv[1];
  if (!sessionId || sessionId.startsWith('--')) {
    console.error('Usage: piwin context <sessionId> [--mock]');
    process.exitCode = 1;
    return;
  }
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const runtime = await openCliHost({ mode, mock });
  try {
    await runContextSummary(runtime, sessionId, console.log);
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

async function commandStudy(argv: string[]): Promise<void> {
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const client = await createStudyHostClient(mode, mock);
  try {
    await runStudyCommand(client, argv, console.log);
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await client.dispose();
  }
}

async function commandAuth(argv: string[]): Promise<void> {
  const client = await createWalkthroughHostClient('sdk', false);
  try {
    await runAuthCommand(client, argv);
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await client.dispose();
  }
}

async function commandWalkthrough(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  const mock = parseMock(argv);
  const mode = parseMode(argv);

  if (sub === 'list') {
    const sessionId = argv[2];
    if (!sessionId || sessionId.startsWith('--')) {
      console.error('Usage: piwin walkthrough list <session-id> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runWalkthroughList(client, sessionId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'generate') {
    const sessionId = argv[2];
    const messageId = argv[3];
    if (!sessionId || !messageId || sessionId.startsWith('--') || messageId.startsWith('--')) {
      console.error('Usage: piwin walkthrough generate <session-id> <message-id> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runWalkthroughGenerate(client, sessionId, messageId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'export') {
    const sessionId = argv[2];
    const messageId = argv[3];
    if (!sessionId || !messageId || sessionId.startsWith('--') || messageId.startsWith('--')) {
      console.error(
        'Usage: piwin walkthrough export <session-id> <message-id> [--output <path>] [--mock]',
      );
      process.exitCode = 1;
      return;
    }
    const outputPath = readOption(argv, '--output');
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runWalkthroughExport(client, sessionId, messageId, console.log, {
        ...(outputPath ? { outputPath } : {}),
      });
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  console.error(`Unknown walkthrough subcommand: ${sub || '(none)'}`);
  console.error('Usage: piwin walkthrough list|generate|export');
  process.exitCode = 1;
}

/**
 * CE-SUB-ORCH: CLI subagent batch observation and cancellation.
 * Usage: piwin subagent status <runId> | cancel <runId>
 */
async function commandSubagent(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  const mock = parseMock(argv);
  const mode = parseMode(argv);

  if (sub === 'status') {
    const runId = argv[2];
    if (!runId || runId.startsWith('--')) {
      console.error('Usage: piwin subagent status <runId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      const response = await client.handleCommand({
        type: 'subagent/batch-status',
        runId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
      } else {
        const result = response.data as {
          runId: string;
          status: string;
          results: Array<{ taskId: string; executionStatus: string; error?: string }>;
        };
        console.log(`Batch ${result.runId}: ${result.status}`);
        for (const task of result.results) {
          const errorSuffix = task.error ? ` — ${task.error}` : '';
          console.log(`  [${task.taskId}] ${task.executionStatus}${errorSuffix}`);
        }
      }
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'results') {
    const parentSessionId = argv[2];
    if (!parentSessionId || parentSessionId.startsWith('--')) {
      console.error('Usage: piwin subagent results <parentSessionId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runSubagentResults(client, parentSessionId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'result') {
    const resultId = argv[2];
    if (!resultId || resultId.startsWith('--')) {
      console.error('Usage: piwin subagent result <resultId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      await runSubagentResult(client, resultId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'cancel') {
    const runId = argv[2];
    if (!runId || runId.startsWith('--')) {
      console.error('Usage: piwin subagent cancel <runId> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createWalkthroughHostClient(mode, mock);
    try {
      const response = await client.handleCommand({
        type: 'subagent/batch-cancel',
        runId,
      });
      if (!response.success) {
        console.error(response.error);
        process.exitCode = 1;
      } else {
        console.log(`Batch ${runId} cancellation requested.`);
      }
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  console.error(`Unknown subagent subcommand: ${sub || '(none)'}`);
  console.error('Usage: piwin subagent status|cancel|results|result');
  process.exitCode = 1;
}

async function commandTurn(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  const changeSetId = argv[2];
  const versionFlag = argv.indexOf('--expected-version');
  const revisionRaw = versionFlag >= 0 ? argv[versionFlag + 1] : undefined;
  const revision = revisionRaw !== undefined ? Number(revisionRaw) : Number.NaN;
  if (
    (sub !== 'undo' && sub !== 'redo') ||
    !changeSetId ||
    changeSetId.startsWith('--') ||
    !Number.isInteger(revision)
  ) {
    console.error('Usage: piwin turn undo|redo <changeSetId> --expected-version <revision>');
    process.exitCode = 1;
    return;
  }
  const mock = parseMock(argv);
  const mode = parseMode(argv);
  const runtime = await openCliHost({ mode, mock });
  try {
    if (sub === 'undo') {
      await runTurnUndo(runtime, changeSetId, revision, console.log);
    } else {
      await runTurnRedo(runtime, changeSetId, revision, console.log);
    }
  } catch (error) {
    console.error(formatError(error));
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}

/**
 * CLI side-chat commands (spec §12).
 * Usage: piwin side-chat list|open|sync|send|resume
 */
async function commandSideChat(argv: string[]): Promise<void> {
  const sub = argv[1] ?? '';
  const mock = parseMock(argv);
  const mode = parseMode(argv);

  if (sub === 'list') {
    const sourceSessionId = argv[2];
    if (!sourceSessionId || sourceSessionId.startsWith('--')) {
      console.error(
        'Usage: piwin side-chat list <source-session-id> [--include-archived] [--mock]',
      );
      process.exitCode = 1;
      return;
    }
    const includeArchived = hasFlag(argv, '--include-archived');
    const client = await createSideChatHostClient(mode, mock);
    try {
      await runSideChatList(client, sourceSessionId, console.log, {
        ...(includeArchived ? { includeArchived: true } : {}),
      });
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'open') {
    const sourceSessionId = argv[2];
    if (!sourceSessionId || sourceSessionId.startsWith('--')) {
      console.error(
        'Usage: piwin side-chat open <source-session-id> [--name <name>] [--message <message-id>] [--mock]',
      );
      process.exitCode = 1;
      return;
    }
    const name = readOption(argv, '--name');
    const sourceMessageId = readOption(argv, '--message');
    const client = await createSideChatHostClient(mode, mock);
    try {
      await runSideChatOpen(client, sourceSessionId, console.log, {
        ...(name ? { name } : {}),
        ...(sourceMessageId ? { sourceMessageId } : {}),
      });
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'sync') {
    const sideChatSessionId = argv[2];
    if (!sideChatSessionId || sideChatSessionId.startsWith('--')) {
      console.error('Usage: piwin side-chat sync <side-chat-session-id> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createSideChatHostClient(mode, mock);
    try {
      await runSideChatSync(client, sideChatSessionId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'send') {
    const sideChatSessionId = argv[2];
    const text = argv
      .slice(3)
      .filter((arg) => !arg.startsWith('--'))
      .join(' ');
    if (!sideChatSessionId || !text || sideChatSessionId.startsWith('--')) {
      console.error('Usage: piwin side-chat send <side-chat-session-id> <text> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createSideChatHostClient(mode, mock);
    try {
      await runSideChatSend(client, sideChatSessionId, text, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  if (sub === 'resume') {
    const sideChatSessionId = argv[2];
    if (!sideChatSessionId || sideChatSessionId.startsWith('--')) {
      console.error('Usage: piwin side-chat resume <side-chat-session-id> [--mock]');
      process.exitCode = 1;
      return;
    }
    const client = await createSideChatHostClient(mode, mock);
    try {
      await runSideChatResume(client, sideChatSessionId, console.log);
    } catch (error) {
      console.error(formatError(error));
      process.exitCode = 1;
    } finally {
      await client.dispose();
    }
    return;
  }

  console.error(`Unknown side-chat subcommand: ${sub || '(none)'}`);
  console.error('Usage: piwin side-chat list|open|sync|send|resume');
  process.exitCode = 1;
}

/** Same attached/in-process Host as other CLI verbs. Study never opens a second flashcards root. */
async function createStudyHostClient(mode: HostMode, mock: boolean): Promise<StudyHostClient> {
  const host = await openCliHost({ mode, mock });
  return bindStudyHostClient(host);
}

/**
 * Build a {@link SideChatHostClient} on the live Host, or an in-process runtime.
 */
async function createSideChatHostClient(
  mode: HostMode,
  mock: boolean,
): Promise<SideChatHostClient> {
  const pushHandlers = new Set<(message: HostPush) => void>();
  const host = await openCliHost({
    mode,
    mock,
    onPush: (message) => {
      for (const handler of pushHandlers) {
        handler(message);
      }
    },
  });
  return bindSideChatHostClient(host, pushHandlers);
}

/**
 * Build a {@link WalkthroughHostClient} on the live Host, or an in-process runtime.
 * `onPush` is bridged so `generate` can wait for `walkthrough/updated`.
 */
async function createWalkthroughHostClient(
  mode: HostMode,
  mock: boolean,
): Promise<WalkthroughHostClient> {
  const pushHandlers = new Set<(message: HostPush) => void>();
  const host = await openCliHost({
    mode,
    mock,
    onPush: (message) => {
      for (const handler of pushHandlers) {
        handler(message);
      }
    },
  });
  return {
    handleCommand: (command) => host.handleCommand(command),
    onPush: (handler) => {
      pushHandlers.add(handler);
      return () => {
        pushHandlers.delete(handler);
      };
    },
    dispose: () => host.dispose(),
  };
}

async function commandScheme(argv: string[]): Promise<void> {
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

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command === 'doctor') {
    await commandDoctor(argv.slice(1));
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
  if (command === 'scheme') {
    await commandScheme(argv);
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
  if (command === 'plugin') {
    await commandPlugin(argv);
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
  if (command === 'study') {
    await commandStudy(argv.slice(1));
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
  if (command === 'auth') {
    await commandAuth(argv.slice(1));
    return;
  }
  if (command === 'walkthrough') {
    await commandWalkthrough(argv);
    return;
  }
  if (command === 'context') {
    await commandContext(argv);
    return;
  }
  if (command === 'subagent') {
    await commandSubagent(argv);
    return;
  }
  if (command === 'turn') {
    await commandTurn(argv);
    return;
  }
  if (command === 'side-chat') {
    await commandSideChat(argv);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
