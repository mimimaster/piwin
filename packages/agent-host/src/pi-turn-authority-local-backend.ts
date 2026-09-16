/**
 * Real Pi 0.84 backends pointed at the local OpenAI SSE fixture.
 * Not a production module.
 */

import type {
  BackendSessionBlueprint,
  HostToolExecutionPort,
  SessionCapabilitySnapshot,
} from '@piwin/contracts';
import type { BackendSessionHandle } from './backends/pi-session-backend.js';
import { createBackendSdkSession } from './backends/sdk-backend-session.js';
import { WorkerSessionBackend } from './backends/worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from './agent-worker-supervisor.js';
import { PIWIN_PI_AGENT_DIR_ENV } from './pi-runtime-agent-dir.js';
import type { SerializableProviderRuntime } from './rpc/serializable-blueprint.js';
import {
  FIXTURE_API_KEY,
  FIXTURE_API_KEY_ENV,
  FIXTURE_MODEL_ID,
  FIXTURE_PROVIDER_ID,
  type TurnAuthorityLocalHome,
} from './pi-turn-authority-local-home.js';

export type TurnAuthorityBackendMode = 'sdk' | 'rpc';

export type TurnAuthorityBackend = {
  mode: TurnAuthorityBackendMode;
  handle: BackendSessionHandle;
  close: () => Promise<void>;
};

const unusedHostTools: HostToolExecutionPort = {
  execute: async () => ({
    ok: false,
    code: 'tool-not-available',
    message: 'local turn-authority fixture has no Host tools',
  }),
};

export function createTurnAuthorityBlueprint(
  home: TurnAuthorityLocalHome,
  sessionId: string,
): BackendSessionBlueprint {
  const snapshot: SessionCapabilitySnapshot = {
    version: 1,
    snapshotId: `snap-${sessionId}`,
    inputs: {
      rulesRevision: 'rules-1',
      settingsRevision: 'settings-1',
      projectRevision: 'project-1',
      mcpRevision: 'mcp-1',
      resourceCatalogRevision: 'resources-1',
    },
    scope: { kind: 'general' },
    workingDirectory: home.workingDirectory,
    trust: { kind: 'general' },
    resources: {
      skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
      prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
    },
    resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
    context: {
      allowPiNativeInstructions: true,
      allowProjectAgentsFiles: true,
      allowProjectSystemPrompts: true,
    },
    contextManifest: { agentsFiles: [] },
    tools: {
      hostTools: [],
      piBuiltinToolNames: [],
      enabledMcpServerIds: [],
      enabledFamilies: [],
    },
  };
  return {
    version: 1,
    sessionId,
    runtimeGenerationId: `generation-${sessionId}`,
    capabilitySnapshot: snapshot,
    model: {
      protocol: 'openai-compatible',
      providerId: FIXTURE_PROVIDER_ID,
      modelId: FIXTURE_MODEL_ID,
    },
  };
}

export function createTurnAuthorityProviders(
  baseUrl: string,
  mode: TurnAuthorityBackendMode,
): SerializableProviderRuntime[] {
  const models = [
    {
      id: FIXTURE_MODEL_ID,
      label: 'Fixture',
      input: ['text'] as Array<'text' | 'image'>,
      reasoning: true,
    },
  ];
  if (mode === 'sdk') {
    return [
      {
        providerId: FIXTURE_PROVIDER_ID,
        protocol: 'openai-compatible',
        baseUrl,
        models,
        auth: { kind: 'inline', apiKey: FIXTURE_API_KEY },
      },
    ];
  }
  return [
    {
      providerId: FIXTURE_PROVIDER_ID,
      protocol: 'openai-compatible',
      baseUrl,
      models,
      auth: { kind: 'env', envName: FIXTURE_API_KEY_ENV },
    },
  ];
}

export async function openTurnAuthorityBackend(input: {
  mode: TurnAuthorityBackendMode;
  home: TurnAuthorityLocalHome;
  baseUrl: string;
  sessionId: string;
}): Promise<TurnAuthorityBackend> {
  const blueprint = createTurnAuthorityBlueprint(input.home, input.sessionId);
  if (input.mode === 'sdk') {
    const handle = await createBackendSdkSession(
      {
        blueprint,
        providers: createTurnAuthorityProviders(input.baseUrl, 'sdk'),
        hostToolExecution: unusedHostTools,
      },
      { agentDir: input.home.agentDir },
    );
    return {
      mode: 'sdk',
      handle,
      close: async () => {
        await handle.abort().catch(() => undefined);
      },
    };
  }

  process.env[FIXTURE_API_KEY_ENV] = FIXTURE_API_KEY;
  const supervisor = new AgentWorkerSupervisor();
  const backend = new WorkerSessionBackend({
    supervisor,
    disposeSupervisor: true,
    worker: {
      env: {
        HOME: input.home.homeDir,
        // Name the agentDir outright, as the SDK branch does. The worker
        // resolves it via resolvePiRuntimeAgentDir, which no longer derives
        // `$HOME/.pi/agent`; without this it reads no fixture settings.json
        // and falls back to Pi's default retry count and idle timeout.
        [PIWIN_PI_AGENT_DIR_ENV]: input.home.agentDir,
        [FIXTURE_API_KEY_ENV]: FIXTURE_API_KEY,
      },
    },
  });
  const handle = await backend.createSession({
    blueprint,
    providers: createTurnAuthorityProviders(input.baseUrl, 'rpc'),
    hostToolExecution: unusedHostTools,
  });
  return {
    mode: 'rpc',
    handle,
    close: async () => {
      await backend.dispose();
    },
  };
}
