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

/**
 * Where the conversation's terminal runs. `desktop-pty`: Desktop starts Pi's
 * TUI in its own terminal (ADR 0086). `host-pty`: the Host's machine runs it
 * and streams it over the Host connection — always for native agent CLIs,
 * and for Pi's TUI on shells without a terminal of their own (ADR 0102).
 */
export type ConversationCliRoute = 'desktop-pty' | 'host-pty';

export type ConversationCliRouteInput = {
  agentId: string;
  nativePtyAvailable: boolean;
  transport: 'mock' | 'live' | 'remote';
  remoteTargetAvailable?: boolean;
  /** The Host advertises `tui/open` (`capabilities.embeddedTui`). */
  hostRunsTui?: boolean;
  capabilities?: SessionBackendCapabilities | undefined;
  agentStatus?: ExternalAgentStatus | undefined;
};

export function resolveConversationCliRoute(input: ConversationCliRouteInput): ConversationCliRoute | null {
  const desktopTerminal = canOpenEmbeddedTui(input);
  // A shell without its own terminal (phone, browser) reaches the Host remotely.
  const hostStreamOnly = !input.nativePtyAvailable && input.transport === 'remote';
  if (isPiEmbeddedTuiAgent(input.agentId)) {
    if (desktopTerminal) return 'desktop-pty';
    return hostStreamOnly && input.hostRunsTui === true ? 'host-pty' : null;
  }
  if (!isNativeCliEligible(input)) return null;
  return desktopTerminal || hostStreamOnly ? 'host-pty' : null;
}

/** Titlebar Desktop/CLI switch: Pi embedded TUI or Host-advertised native CLI. */
export function canOfferConversationCli(input: ConversationCliRouteInput): boolean {
  return resolveConversationCliRoute(input) !== null;
}

/**
 * Split-pane terminal: Pi's embedded TUI, or any backend whose Host-advertised
 * native CLI is eligible. Never a hardcoded Pi/Grok allowlist.
 */
export function canRenderSessionTuiPane(input: {
  agentId: string;
  capabilities?: SessionBackendCapabilities | undefined;
  agentStatus?: ExternalAgentStatus | undefined;
}): boolean {
  if (isPiEmbeddedTuiAgent(input.agentId)) return true;
  return isNativeCliEligible(input);
}

/**
 * Agents whose sessions open in the CLI shell by default (ADR 0082 §8). Grok's
 * own TUI is the reference interface; the Desktop projection stays one click
 * away. The default only applies where `canOfferConversationCli` already holds,
 * and not on a touch-first screen: a full-screen terminal on a phone keyboard
 * is the harder way to read the same conversation.
 */
export function defaultsToConversationCli(agentId: string, options: { touchFirst?: boolean } = {}): boolean {
  return agentId === 'grok' && options.touchFirst !== true;
}
