import type { AgentHost, AgentHostFactoryOptions, PermissionDecision } from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import { PiRpcAdapter } from './rpc-adapter.js';
import { PiSdkAdapter, type PiSdkAdapterOptions, type PiSdkPermissionRequest } from './sdk-adapter.js';

export type CreateAgentHostOptions = AgentHostFactoryOptions & {
  mock?: boolean;
  /**
   * Interactive permission path (Desktop HostRuntime).
   * When omitted, web tools that evaluate to "ask" are denied.
   */
  onPermissionRequest?: (
    request: PiSdkPermissionRequest,
  ) => Promise<PermissionDecision>;
  /**
   * HostRuntime-owned MCP process manager. When omitted (CLI bare host),
   * PiSdkAdapter creates and owns a short-lived manager for the host instance
   * so session tools still share one process model.
   */
  lifecycleManager?: McpLifecycleManager;
  onExtensionUiRequest?: PiSdkAdapterOptions['onExtensionUiRequest'];
  onExtensionNotify?: PiSdkAdapterOptions['onExtensionNotify'];
};

export function createAgentHost(options: CreateAgentHostOptions): AgentHost {
  const mock = options.mock === true || process.env.PIWIN_MOCK === '1';

  if (options.mode === 'rpc') {
    const rpcOptions: ConstructorParameters<typeof PiRpcAdapter>[0] = {
      command: options.rpcCommand ?? 'pi',
      args: ['--mode', 'rpc'],
      mock,
      useSdkFallback: true,
    };
    if (typeof options.piwinRoot === 'string') {
      rpcOptions.piwinRoot = options.piwinRoot;
    }
    if (options.onPermissionRequest) {
      rpcOptions.onPermissionRequest = options.onPermissionRequest;
    }
    if (options.lifecycleManager) {
      rpcOptions.lifecycleManager = options.lifecycleManager;
    }
    if (options.onExtensionUiRequest) {
      rpcOptions.onExtensionUiRequest = options.onExtensionUiRequest;
    }
    if (options.onExtensionNotify) {
      rpcOptions.onExtensionNotify = options.onExtensionNotify;
    }
    return new PiRpcAdapter(rpcOptions);
  }

  const sdkOptions: PiSdkAdapterOptions = { mock };
  if (typeof options.piwinRoot === 'string') {
    sdkOptions.piwinRoot = options.piwinRoot;
  }
  if (options.onPermissionRequest) {
    sdkOptions.onPermissionRequest = options.onPermissionRequest;
  }
  if (options.lifecycleManager) {
    sdkOptions.lifecycleManager = options.lifecycleManager;
  }
  if (options.onExtensionUiRequest) {
    sdkOptions.onExtensionUiRequest = options.onExtensionUiRequest;
  }
  if (options.onExtensionNotify) {
    sdkOptions.onExtensionNotify = options.onExtensionNotify;
  }
  return new PiSdkAdapter(sdkOptions);
}
