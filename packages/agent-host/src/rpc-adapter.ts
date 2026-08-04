import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import type {
  AgentHost,
  CreateSessionInput,
  SessionHandle,
  SessionScope,
  SessionSummary,
} from '@piwin/contracts';
import { mapPiSessionEvent } from './event-map.js';
import { createMockSessionHandle } from './mock-session.js';
import { PiSdkAdapter, type PiSdkAdapterOptions } from './sdk-adapter.js';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { ProcessRegistry } from '@piwin/process';
import type { PiSessionBackend, BackendSessionHandle } from './backends/pi-session-backend.js';
import { WorkerRpcSessionBackend } from './backends/worker-rpc-session-backend.js';
import type { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';

export type PiRpcAdapterOptions = {
  /** e.g. "pi" or absolute path (stock pi binary; unused when using SDK fallback) */
  command: string;
  args?: string[];
  mock?: boolean;
  piwinRoot?: string;
  lifecycleManager?: McpLifecycleManager;
  onPermissionRequest?: PiSdkAdapterOptions['onPermissionRequest'];
  onExtensionUiRequest?: PiSdkAdapterOptions['onExtensionUiRequest'];
  onExtensionNotify?: PiSdkAdapterOptions['onExtensionNotify'];
  onLog?: PiSdkAdapterOptions['onLog'];
  processRegistry?: ProcessRegistry;
  /** Session-level permission mode override (ADR 0019 §3). */
  permissionModeOverride?: PiSdkAdapterOptions['permissionModeOverride'];
  /** Host-owned browser session getter (ADR 0020). */
  getBrowserSession?: PiSdkAdapterOptions['getBrowserSession'];
  getPermissionMode?: PiSdkAdapterOptions['getPermissionMode'];
  /** Plan tool progress → `plan/updated` (ADR 0025; SDK fallback path). */
  onPlanUpdated?: PiSdkAdapterOptions['onPlanUpdated'];
  /**
   * When true (default), real sessions use PiSdkAdapter so extensions/tools load.
   * Stock `pi --mode rpc` cannot register custom tools (ADR 0008 / D-EXT-07).
   * Set PIWIN_RPC_STOCK=1 to attempt stock binary only (will fail product path).
   */
  useSdkFallback?: boolean;
  /**
   * Phase 7 WP5: when true, real sessions use the WorkerRpcSessionBackend
   * (piwin-owned worker process with tool proxying). Defaults to false
   * during rollout; set PIWIN_RPC_WORKER=1 to enable.
   */
  useWorkerBackend?: boolean;
  /** Worker script path for the worker backend (defaults to bundled entry). */
  workerScript?: string;
  /** Parent-owned tool execution router for worker proxy tool calls. */
  toolRouter?: HostToolExecutionRouter;
};

/**
 * RPC host mode.
 *
 * Product path (default): SDK session backend with the same tools/extensions/prompts
 * as sdk mode. Stock Pi `--mode rpc` cannot inject host custom tools or ResourceLoader
 * paths, so process isolation remains residual (D-HOST-01b worker).
 */
export class PiRpcAdapter implements AgentHost {
  readonly mode = 'rpc' as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly sessions = new Map<string, SessionHandle>();
  private sdkBackend: PiSdkAdapter | null = null;
  private workerBackend: WorkerRpcSessionBackend | null = null;
  private warnedSdkFallback = false;

  constructor(private readonly options: PiRpcAdapterOptions) {}

  /** True when product sessions run via SDK backend under rpc hostMode. */
  usesSdkFallback(): boolean {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      return false;
    }
    if (this.usesWorkerBackend()) {
      return false;
    }
    if (process.env.PIWIN_RPC_STOCK === '1') {
      return false;
    }
    return this.options.useSdkFallback !== false;
  }

  /**
   * Phase 7 WP5: true when product sessions run via the worker backend
   * (piwin-owned worker process with tool proxying + real isolation).
   * Falls back to SDK when PIWIN_RPC_SDK_FALLBACK=1 (§10.1 temporary flag).
   */
  usesWorkerBackend(): boolean {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      return false;
    }
    // §10.1: PIWIN_RPC_SDK_FALLBACK=1 forces old in-process SDK path
    // even when worker is enabled. Used during rollout for emergency fallback.
    if (process.env.PIWIN_RPC_SDK_FALLBACK === '1') {
      return false;
    }
    if (process.env.PIWIN_RPC_WORKER === '1') {
      return true;
    }
    return this.options.useWorkerBackend === true;
  }

  /** True when the backend provides real process isolation. */
  isIsolated(): boolean {
    return this.usesWorkerBackend();
  }

  /** Backend mode for doctor/status reporting. */
  backendMode(): 'sdk' | 'rpc-worker' | 'rpc-fallback' | 'mock' {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      return 'mock';
    }
    if (this.usesWorkerBackend()) {
      return 'rpc-worker';
    }
    if (this.usesSdkFallback()) {
      return 'rpc-fallback';
    }
    return 'sdk';
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      const session = createMockSessionHandle(input);
      this.sessions.set(session.id, session);
      return session;
    }

    // Phase 7 WP5: worker backend path (real process isolation).
    if (this.usesWorkerBackend()) {
      const backend = this.getWorkerBackend();
      // Compile the real SerializableBlueprint from live config + resource
      // discovery. This is the product path — the worker receives the exact
      // same capability projection that the SDK path would use.
      const { blueprint, providers, productSessionId } = await compileBlueprintForWorker(input, {
        ...(this.options.piwinRoot ? { piwinRoot: this.options.piwinRoot } : {}),
      });
      const handle = await backend.createSession({
        productSessionId,
        serializable: blueprint,
        providers,
      });
      const session = adaptBackendToSessionHandle(handle, input);
      this.sessions.set(session.id, session);
      return session;
    }

    if (this.usesSdkFallback()) {
      if (!this.warnedSdkFallback) {
        this.warnedSdkFallback = true;
        console.warn(
          '[piwin] hostMode=rpc uses SDK session backend for tools/extensions/prompts ' +
            '(stock pi --mode rpc cannot register custom tools). ' +
            'True process isolation is residual D-HOST-01b. Set PIWIN_RPC_STOCK=1 to force stock path.',
        );
      }
      const sdk = this.getSdkBackend();
      const session = await sdk.createSession(input);
      this.sessions.set(session.id, session);
      return session;
    }

    try {
      await this.ensureChild();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `PiRpcAdapter could not start RPC process (${message}). ` +
          'Use --mock for offline mode, or install pi and ensure rpcCommand is correct.',
      );
    }

    throw new Error(
      'PiRpcAdapter: stock pi --mode rpc does not support piwin custom tools ' +
        '(web/MCP/bash gate) or extensions/prompts (ADR 0008 / D-EXT-07). ' +
        'Default rpc mode uses SDK fallback; unset PIWIN_RPC_STOCK or use --mode sdk.',
    );
  }

  async resumeSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    if (this.usesSdkFallback() && this.sdkBackend) {
      const session = await this.sdkBackend.resumeSession(sessionId);
      this.sessions.set(sessionId, session);
      return session;
    }
    throw new Error(`PiRpcAdapter.resumeSession: unknown session ${sessionId}`);
  }

  async dropSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (session) {
      try {
        await session.abort();
      } catch {
        // best-effort
      }
    }
    if (this.usesWorkerBackend() && this.workerBackend) {
      try {
        await this.workerBackend.dropSession(sessionId);
      } catch {
        // best-effort
      }
    } else if (this.usesSdkFallback() && this.sdkBackend) {
      try {
        await this.sdkBackend.dropSession(sessionId);
      } catch {
        // best-effort
      }
    }
  }

  async listSessions(scopeOrProjectPath: string | SessionScope): Promise<SessionSummary[]> {
    if (this.usesSdkFallback() && this.sdkBackend) {
      return this.sdkBackend.listSessions(scopeOrProjectPath);
    }
    const now = new Date().toISOString();
    const scope: SessionScope =
      typeof scopeOrProjectPath === 'string'
        ? { kind: 'project', projectPath: scopeOrProjectPath }
        : scopeOrProjectPath;
    const projectPath = scope.kind === 'project' ? scope.projectPath : '';
    const workingDirectory = scope.kind === 'project' ? scope.projectPath : '';
    return [...this.sessions.keys()].map((id) => ({
      id,
      scope,
      workingDirectory,
      projectPath,
      updatedAt: now,
      messageCount: 0,
    }));
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
    if (this.workerBackend) {
      await this.workerBackend.dispose();
      this.workerBackend = null;
    }
    if (this.sdkBackend) {
      await this.sdkBackend.dispose();
      this.sdkBackend = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
    }
    this.child = null;
  }

  private getSdkBackend(): PiSdkAdapter {
    if (!this.sdkBackend) {
      const sdkOptions: PiSdkAdapterOptions = {
        mock: false,
      };
      if (typeof this.options.piwinRoot === 'string') {
        sdkOptions.piwinRoot = this.options.piwinRoot;
      }
      if (this.options.onPermissionRequest) {
        sdkOptions.onPermissionRequest = this.options.onPermissionRequest;
      }
      if (this.options.lifecycleManager) {
        sdkOptions.lifecycleManager = this.options.lifecycleManager;
      }
      if (this.options.onExtensionUiRequest) {
        sdkOptions.onExtensionUiRequest = this.options.onExtensionUiRequest;
      }
      if (this.options.onExtensionNotify) {
        sdkOptions.onExtensionNotify = this.options.onExtensionNotify;
      }
      if (this.options.onLog) {
        sdkOptions.onLog = this.options.onLog;
      }
      if (this.options.processRegistry) {
        sdkOptions.processRegistry = this.options.processRegistry;
      }
      if (this.options.permissionModeOverride) {
        sdkOptions.permissionModeOverride = this.options.permissionModeOverride;
      }
      if (this.options.getBrowserSession) {
        sdkOptions.getBrowserSession = this.options.getBrowserSession;
      }
      if (this.options.getPermissionMode) {
        sdkOptions.getPermissionMode = this.options.getPermissionMode;
      }
      if (this.options.onPlanUpdated) {
        sdkOptions.onPlanUpdated = this.options.onPlanUpdated;
      }
      this.sdkBackend = new PiSdkAdapter(sdkOptions);
    }
    return this.sdkBackend;
  }

  private async ensureChild(): Promise<void> {
    if (this.child) {
      return;
    }
    const args = this.options.args ?? ['--mode', 'rpc'];
    const child = spawn(this.options.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw: unknown = JSON.parse(trimmed);
          mapPiSessionEvent(raw);
        } catch {
          // ignore non-JSON noise
        }
      }
    });
  }

  private getWorkerBackend(): WorkerRpcSessionBackend {
    if (!this.workerBackend) {
      // §10.3: worker script path resolution. In dev (tsx), use
      // import.meta.url. In bundled builds, the packaging script must
      // set `options.workerScript` to the resolved bundled path.
      const workerScript =
        this.options.workerScript ??
        resolvePath(new URL('./rpc-sdk-worker-entry.ts', import.meta.url).pathname);
      this.workerBackend = new WorkerRpcSessionBackend({
        worker: {
          workerScript,
          // --import tsx is needed for dev; bundled builds should override
          // via options.worker.nodeArgs or set workerScript to a .js path.
          nodeArgs: ['--import', 'tsx'],
          ...(this.options.onLog ? { onLog: this.options.onLog } : {}),
        },
        ...(this.options.toolRouter ? { toolRouter: this.options.toolRouter } : {}),
      });
    }
    return this.workerBackend;
  }
}

/**
 * Adapt a BackendSessionHandle to a SessionHandle for the adapter's
 * internal session map. The backend handle's prompt receives a
 * PreparedPromptInput; the SessionHandle's prompt receives a PromptInput.
 */
function adaptBackendToSessionHandle(
  handle: BackendSessionHandle,
  _input: CreateSessionInput,
): SessionHandle {
  return {
    id: handle.id,
    async prompt(promptInput) {
      await handle.prompt({
        text: promptInput.text,
        ...(promptInput.streamingBehavior
          ? { streamingBehavior: promptInput.streamingBehavior }
          : {}),
        ...(promptInput.model ? { model: promptInput.model } : {}),
        ...(promptInput.thinkingLevel ? { thinkingLevel: promptInput.thinkingLevel } : {}),
      });
    },
    async steer(message) {
      if (handle.steer) {
        await handle.steer(message);
      }
    },
    async followUp(message) {
      if (handle.followUp) {
        await handle.followUp(message);
      }
    },
    async abort() {
      await handle.abort();
    },
    async getMessages() {
      return [];
    },
    async getTree() {
      return { root: null, activeLeafId: null };
    },
    subscribe(listener) {
      return handle.subscribe(listener);
    },
  };
}
