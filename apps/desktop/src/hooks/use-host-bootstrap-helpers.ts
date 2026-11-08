/**
 * Pure helpers extracted from `use-host-bootstrap.ts`: session-plan cache,
 * extension deployment announcements, shell readiness, capability probing and
 * bootstrap theme/model selection. No React state — everything takes args.
 */
import type { Dispatch, SetStateAction } from 'react';
import type {
  ExtensionDeploymentRecord,
  HostResponse,
  SessionPlan,
  ThemeManifest,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import {
  capSeenKeys,
  MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS,
  MAX_SESSION_PLAN_CACHE,
  putRecordLru,
} from '../platform/record-budget';
import type { DesktopCopy } from '../i18n/desktop-locale';
import {
  PIWIN_APPEARANCE_DARK,
  resolveDesktopAppearance,
} from '../theme/appearance-tokens';
import { resolveBootstrapSelectedModelKey } from '../composer/composer-model-selection-policy.js';

export type SessionPlanCache = Readonly<Record<string, SessionPlan | null>>;

export function cacheSessionPlan(
  current: SessionPlanCache,
  sessionId: string,
  plan: SessionPlan | null,
  protectSessionId?: string | null,
): SessionPlanCache {
  return putRecordLru(
    current,
    sessionId,
    plan,
    MAX_SESSION_PLAN_CACHE,
    protectSessionId ? [protectSessionId] : [],
  );
}

export function selectSessionPlan(
  current: SessionPlanCache,
  activeSessionId: string | null,
): SessionPlan | null {
  return activeSessionId ? (current[activeSessionId] ?? null) : null;
}

/**
 * Map a durable extension deployment push to a user-visible failure message,
 * or null when nothing needs surfacing. Background activations (quick-ACKed
 * waiting-current-run applies) report their outcome only through this push,
 * so terminal failures must not stay silent. The transient `failed` phase is
 * always followed by a terminal rolled-back/restart-required write; reacting
 * to both would double-report the same failure.
 */
export function describeExtensionDeploymentFailure(
  deployment: ExtensionDeploymentRecord,
  copy?: Pick<
    DesktopCopy,
    | 'extensionDeploymentRolledBack'
    | 'extensionDeploymentRestartRequired'
    | 'extensionDeploymentSuperseded'
  >,
): string | null {
  const rolledBack = copy?.extensionDeploymentRolledBack ?? 'Extension deployment rolled back';
  const restartRequired =
    copy?.extensionDeploymentRestartRequired ??
    'Extension deployment needs a session restart to finish applying';
  const superseded =
    copy?.extensionDeploymentSuperseded ??
    'This extension deployment was superseded by a newer extension configuration';
  if (deployment.phase === 'rolled-back') {
    const detail = deployment.error ? `: ${deployment.error}` : '';
    return `${rolledBack}${detail}`;
  }
  if (deployment.phase === 'restart-required') {
    const detail = deployment.error ? ` (${deployment.error})` : '';
    return `${restartRequired}${detail}`;
  }
  if (deployment.phase === 'superseded') {
    const detail = deployment.error ? `: ${deployment.error}` : '';
    return `${superseded}${detail}`;
  }
  return null;
}

export function extensionDeploymentAnnouncementKey(deployment: ExtensionDeploymentRecord): string {
  return `${deployment.deploymentId}:${deployment.phase}`;
}

/** Dedup reconnect/replay of the same terminal failure for one deployment. */
export function shouldAnnounceExtensionDeploymentFailure(
  seenKeys: Set<string>,
  deployment: ExtensionDeploymentRecord,
  copy?: Pick<
    DesktopCopy,
    | 'extensionDeploymentRolledBack'
    | 'extensionDeploymentRestartRequired'
    | 'extensionDeploymentSuperseded'
  >,
): boolean {
  if (describeExtensionDeploymentFailure(deployment, copy) === null) {
    return false;
  }
  const key = extensionDeploymentAnnouncementKey(deployment);
  if (seenKeys.has(key)) {
    return false;
  }
  seenKeys.add(key);
  capSeenKeys(seenKeys, MAX_EXTENSION_DEPLOYMENT_ANNOUNCEMENTS);
  return true;
}

/** Remote shells admit on hello; local sidecar admits on host/status. */
export function resolveShellHostReady(input: {
  transport: ReturnType<HostClient['getTransport']>;
  wireReady: boolean;
  statusSuccess: boolean;
  statusReady?: boolean;
}): boolean {
  if (input.transport === 'remote') {
    return input.wireReady || (input.statusSuccess && input.statusReady === true);
  }
  return input.statusSuccess && input.statusReady === true;
}

/** Read the negotiated context telemetry capability from either local or remote status data. */
export function hasContextTelemetryCapability(data: unknown): boolean {
  if (!isRecord(data) || !isRecord(data.capabilities)) {
    return false;
  }
  return data.capabilities.contextTelemetryVersion === 1;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Normalize a `theme/get-active` response into the manifest the root theme
 * owner should apply. Built-in piwin ids resolve to the desktop-owned
 * manifest (a stale host copy must not override desktop tokens); failures
 * fall back to Inkstone's dark face. Pure so the bootstrap theme path is testable
 * without a HostClient stream.
 */
export function resolveThemeBootstrapResponse(response: HostResponse): ThemeManifest {
  if (!response.success) {
    return PIWIN_APPEARANCE_DARK;
  }
  const themeData = response.data as { theme?: ThemeManifest } | undefined;
  if (themeData?.theme === undefined) {
    return PIWIN_APPEARANCE_DARK;
  }
  return resolveDesktopAppearance(themeData.theme);
}

export function applyBootstrapSelectedModelKey(
  setSelectedModelKey: Dispatch<SetStateAction<string>>,
  defaultProviderId: string | undefined,
  defaultModelId: string | undefined,
): void {
  if (!defaultProviderId || !defaultModelId) {
    return;
  }
  setSelectedModelKey((current) =>
    resolveBootstrapSelectedModelKey(current, defaultProviderId, defaultModelId),
  );
}
