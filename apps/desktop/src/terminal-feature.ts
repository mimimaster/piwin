import {
  isExternalAgentNativeCliReady,
  isNativeCliSupported,
  type ExternalAgentStatus,
  type SessionBackendCapabilities,
} from '@piwin/contracts';

/** Only native Desktop can render the TUI; remote attachment must be explicit. */
export function canOpenEmbeddedTui(input: {
  nativePtyAvailable: boolean;
  transport: 'mock' | 'live' | 'remote';
  remoteTargetAvailable?: boolean;
}): boolean {
  return input.nativePtyAvailable && (
    input.transport === 'live' || (input.transport === 'remote' && input.remoteTargetAvailable === true)
  );
}

/** Pi's embedded TUI is not Host `nativeCli`. Never infer Pi native-CLI support. */
export function isPiEmbeddedTuiAgent(agentId: string): boolean {
  return agentId === 'pi';
}

function nativeCliExplicitlyDenied(input: {
  capabilities?: SessionBackendCapabilities | undefined;
  agentStatus?: ExternalAgentStatus | undefined;
}): boolean {
  if (input.capabilities?.nativeCli?.supported === false) return true;
  const status = input.agentStatus;
  return (status?.state === 'ready' || status?.state === 'unauthenticated')
    && status.nativeCli?.supported === false;
}

/**
 * Host-advertised native CLI for an external backend.
 * Session capabilities win when present; draft/hydration may use agent-level status.
 * Grok Host launch still allows omitted `nativeCli` (legacy adapters). Other
 * backends never get a silent Pi fallback.
 */
export function isNativeCliEligible(input: {
  agentId: string;
  capabilities?: SessionBackendCapabilities | undefined;
  agentStatus?: ExternalAgentStatus | undefined;
}): boolean {
  if (isPiEmbeddedTuiAgent(input.agentId)) return false;
  if (nativeCliExplicitlyDenied(input)) return false;
  if (isNativeCliSupported(input.capabilities) || isExternalAgentNativeCliReady(input.agentStatus)) {
    return true;
  }
  if (input.agentId !== 'grok') return false;
  const state = input.agentStatus?.state;
  return state === undefined || state === 'ready' || state === 'unauthenticated';
}

/** Titlebar Desktop/CLI switch: Pi embedded TUI or Host-advertised native CLI. */
export function canOfferConversationCli(input: {
  agentId: string;
  nativePtyAvailable: boolean;
  transport: 'mock' | 'live' | 'remote';
  remoteTargetAvailable?: boolean;
  capabilities?: SessionBackendCapabilities | undefined;
  agentStatus?: ExternalAgentStatus | undefined;
}): boolean {
  if (!canOpenEmbeddedTui(input)) return false;
  return isPiEmbeddedTuiAgent(input.agentId) || isNativeCliEligible(input);
}
