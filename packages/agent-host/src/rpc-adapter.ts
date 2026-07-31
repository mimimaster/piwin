import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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
  /**
   * When true (default), real sessions use PiSdkAdapter so extensions/tools load.
   * Stock `pi --mode rpc` cannot register custom tools (ADR 0008 / D-EXT-07).
   * Set PIWIN_RPC_STOCK=1 to attempt stock binary only (will fail product path).
   */
  useSdkFallback?: boolean;
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
  private warnedSdkFallback = false;

  constructor(private readonly options: PiRpcAdapterOptions) {}

  /** True when product sessions run via SDK backend under rpc hostMode. */
  usesSdkFallback(): boolean {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      return false;
    }
    if (process.env.PIWIN_RPC_STOCK === '1') {
      return false;
    }
    return this.options.useSdkFallback !== false;
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    if (this.options.mock || process.env.PIWIN_MOCK === '1') {
      const session = createMockSessionHandle(input);
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
    if (this.usesSdkFallback() && this.sdkBackend) {
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
}
