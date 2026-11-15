/**
 * Pure derivation for `SessionStatusPanel` — aggregates runtime metadata,
 * token/context stats, system-prompt / Purge state + exact active prompt path,
 * and Antigravity ACP controls from `ExtensionUiSurfaceSnapshot`.
 */
import type { ExtensionUiSurfaceSnapshot, SessionUsageTotals } from '@piwin/contracts';

export type SessionStatusRuntimeInfo = {
  agentId?: string | undefined;
  backendLabel?: string | undefined;
  modelLabel?: string | undefined;
  effortLabel?: string | undefined;
  modeLabel?: string | undefined;
  permissionMode?: string | undefined;
  sessionId?: string | null | undefined;
  nativeSessionId?: string | undefined;
  workspacePath?: string | null | undefined;
  contextPercent?: number | undefined;
  contextTokensUsed?: number | undefined;
  contextTokensLimit?: number | undefined;
  contextQuality?: 'measured' | 'estimated' | undefined;
  usageTotals?: SessionUsageTotals | null | undefined;
  extensionSurface?: ExtensionUiSurfaceSnapshot | undefined;
};

export type PromptStatusView = {
  engine: 'pi-purge' | 'agy-purge' | 'context-system' | 'default';
  badge: string;
  tone: 'active' | 'override' | 'muted' | 'warning';
  activePath?: string | undefined;
  candidatePath?: string | undefined;
  appendPath?: string | undefined;
  agentsCount?: number | undefined;
  charsLabel?: string | undefined;
  surgeLabel?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
};

export type AntigravityQuotaBucketView = {
  id: string;
  label: string;
  remainingPct: number;
  resetLabel?: string | undefined;
};

export type AntigravityPanelView = {
  accountLabel: string;
  isSystemAccount: boolean;
  proxyLabel?: string | undefined;
  cooldownCount?: number | undefined;
  routeText?: string | undefined;
  routeDegraded: boolean;
  autoRebuildLabel?: string | undefined;
  quotaHeadline?: string | undefined;
  quotaAccountId?: string | undefined;
  quotaBuckets: readonly AntigravityQuotaBucketView[];
  quotaError?: string | undefined;
};

export type SessionOverviewView = {
  agentLabel: string;
  modelLabel?: string | undefined;
  effortLabel?: string | undefined;
  modeLabel?: string | undefined;
  permissionMode?: string | undefined;
  sessionId?: string | undefined;
  nativeSessionId?: string | undefined;
  workspacePath?: string | undefined;
  contextPercent?: number | undefined;
  contextSummary?: string | undefined;
  usageSummary?: string | undefined;
  cacheSummary?: string | undefined;
  costSummary?: string | undefined;
};

export type SessionStatusInsights = {
  overview: SessionOverviewView | null;
  prompt: PromptStatusView | null;
  antigravity: AntigravityPanelView | null;
  extraStatuses: readonly { key: string; text: string }[];
  hasDetails: boolean;
};

const DEDICATED_STATUS_KEYS = new Set([
  'pi-purge',
  'agy-purge',
  'agy-account',
  'agy-quota',
  'agy-route',
  'agy-rebuild',
  'piwin-surge',
]);

function tryParseJsonRecord(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function formatCompactTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(Math.round(value));
}

function deriveOverview(
  runtime: SessionStatusRuntimeInfo,
  zh: boolean,
): SessionOverviewView | null {
  const hasAnySignal =
    Boolean(runtime.agentId) ||
    Boolean(runtime.backendLabel) ||
    Boolean(runtime.modelLabel) ||
    Boolean(runtime.sessionId) ||
    Boolean(runtime.workspacePath) ||
    runtime.contextPercent !== undefined ||
    (runtime.usageTotals?.entryCount ?? 0) > 0;
  if (!hasAnySignal) return null;

  const agentLabel =
    runtime.backendLabel ??
    (runtime.agentId === 'antigravity'
      ? 'Antigravity ACP'
      : runtime.agentId === 'pi' || !runtime.agentId
        ? 'Pi'
        : runtime.agentId);

  let contextSummary: string | undefined;
  if (runtime.contextTokensUsed !== undefined && runtime.contextTokensLimit !== undefined) {
    const pct =
      runtime.contextPercent ??
      Math.min(100, Math.round((runtime.contextTokensUsed / Math.max(1, runtime.contextTokensLimit)) * 100));
    const est = runtime.contextQuality === 'estimated' ? (zh ? '约 ' : '~') : '';
    contextSummary = `${est}${pct}% · ${formatCompactTokenCount(runtime.contextTokensUsed)} / ${formatCompactTokenCount(runtime.contextTokensLimit)}`;
  } else if (runtime.contextPercent !== undefined) {
    contextSummary = `${runtime.contextPercent}%`;
  } else if (runtime.contextTokensLimit !== undefined) {
    contextSummary = `/${formatCompactTokenCount(runtime.contextTokensLimit)}`;
  }

  let usageSummary: string | undefined;
  let cacheSummary: string | undefined;
  let costSummary: string | undefined;
  const totals = runtime.usageTotals;
  if (totals && totals.entryCount > 0) {
    const turns =
      totals.userTurnCount > 0
        ? zh
          ? `${totals.userTurnCount} 轮`
          : `${totals.userTurnCount}t`
        : undefined;
    const uncachedIn = totals.promptTokens + totals.cacheWriteTokens;
    const out = totals.completionTokens;
    const parts = [
      turns,
      `↑${formatCompactTokenCount(uncachedIn)} ↓${formatCompactTokenCount(out)}`,
    ].filter(Boolean);
    usageSummary = parts.join(' · ');

    const req = totals.latestRequest;
    const cacheIn = (req?.promptTokens ?? totals.promptTokens) + (req?.cacheReadTokens ?? totals.cacheReadTokens) + (req?.cacheWriteTokens ?? totals.cacheWriteTokens);
    const cacheHit = req?.cacheReadTokens ?? totals.cacheReadTokens;
    if (cacheIn > 0 && cacheHit > 0) {
      const pct = Math.round((cacheHit / cacheIn) * 100);
      cacheSummary = zh ? `缓存 ${pct}%` : `Cache ${pct}%`;
    }
    if (typeof totals.estimatedCostUsd === 'number' && totals.estimatedCostUsd > 0) {
      costSummary =
        totals.estimatedCostUsd >= 0.01
          ? `$${totals.estimatedCostUsd.toFixed(2)}`
          : `$${totals.estimatedCostUsd.toFixed(4)}`;
    }
  }

  return {
    agentLabel,
    ...(runtime.modelLabel ? { modelLabel: runtime.modelLabel } : {}),
    ...(runtime.effortLabel && runtime.effortLabel !== 'off' ? { effortLabel: runtime.effortLabel } : {}),
    ...(runtime.modeLabel ? { modeLabel: runtime.modeLabel } : {}),
    ...(runtime.permissionMode ? { permissionMode: runtime.permissionMode } : {}),
    ...(runtime.sessionId ? { sessionId: runtime.sessionId } : {}),
    ...(runtime.nativeSessionId ? { nativeSessionId: runtime.nativeSessionId } : {}),
    ...(runtime.workspacePath ? { workspacePath: runtime.workspacePath } : {}),
    ...(runtime.contextPercent !== undefined ? { contextPercent: runtime.contextPercent } : {}),
    ...(contextSummary ? { contextSummary } : {}),
    ...(usageSummary ? { usageSummary } : {}),
    ...(cacheSummary ? { cacheSummary } : {}),
    ...(costSummary ? { costSummary } : {}),
  };
}

function derivePromptView(
  runtime: SessionStatusRuntimeInfo,
  statuses: ReadonlyMap<string, string>,
  zh: boolean,
): PromptStatusView | null {
  const piMeta = tryParseJsonRecord(statuses.get('meta:pi-purge'));
  const piStatus = statuses.get('pi-purge');
  const piPath = statuses.get('meta:pi-purge-path');

  const agyMeta = tryParseJsonRecord(statuses.get('meta:agy-purge'));
  const agyStatus = statuses.get('agy-purge');
  const agyPath = statuses.get('meta:agy-purge-path');

  const ctxMeta = tryParseJsonRecord(statuses.get('meta:context-prompt'));
  const ctxSysPath = statuses.get('meta:context-sys-path');
  const ctxAppPath = statuses.get('meta:context-app-path');
  const surgeText = statuses.get('piwin-surge');

  const agentsCount = typeof ctxMeta?.agents === 'number' ? ctxMeta.agents : undefined;
  const isAntigravity = runtime.agentId === 'antigravity' || agyMeta !== undefined || agyStatus !== undefined;

  const piPurgeOn = piMeta ? piMeta.on === true : Boolean(piStatus);
  const agyPurgeOn = agyMeta ? agyMeta.on === true : Boolean(agyStatus);

  if (agyPurgeOn) {
    const mode = typeof agyMeta?.mode === 'string' ? agyMeta.mode : 'replace';
    const source = typeof agyMeta?.source === 'string' ? agyMeta.source : '';
    const chars = typeof agyMeta?.chars === 'number' && agyMeta.chars > 0 ? agyMeta.chars : undefined;
    const error = typeof agyMeta?.err === 'string' ? agyMeta.err : undefined;
    return {
      engine: 'agy-purge',
      badge: `AGY PURGE ON · ${mode}${source ? ` (${source})` : ''}`,
      tone: error ? 'warning' : 'active',
      ...(agyPath ? { activePath: agyPath } : {}),
      ...(chars !== undefined ? { charsLabel: `${chars} chars` } : {}),
      ...(surgeText ? { surgeLabel: surgeText } : {}),
      ...(error ? { error } : {}),
    };
  }

  if (piPurgeOn) {
    const mode = typeof piMeta?.mode === 'string' ? piMeta.mode : 'strict';
    const source = typeof piMeta?.source === 'string' ? piMeta.source : '';
    const chars = typeof piMeta?.chars === 'number' && piMeta.chars > 0 ? piMeta.chars : undefined;
    const error = typeof piMeta?.err === 'string' ? piMeta.err : undefined;
    const fallbackPath = piPath ?? (source === 'builtin-strict' ? 'builtin:strict' : ctxSysPath);
    return {
      engine: 'pi-purge',
      badge: `PURGE ON · ${mode}${source ? ` (${source})` : ''}`,
      tone: error ? 'warning' : 'active',
      ...(fallbackPath ? { activePath: fallbackPath } : {}),
      ...(ctxAppPath ? { appendPath: ctxAppPath } : {}),
      ...(agentsCount !== undefined ? { agentsCount } : {}),
      ...(chars !== undefined ? { charsLabel: `${chars} chars` } : {}),
      ...(surgeText ? { surgeLabel: surgeText } : {}),
      ...(error ? { error } : {}),
    };
  }

  if (ctxSysPath) {
    const sysSrc = ctxMeta?.sysSrc === 'project' ? (zh ? '项目级' : 'project') : (zh ? '全局' : 'global');
    return {
      engine: 'context-system',
      badge: `SYSTEM.md (${sysSrc})`,
      tone: 'override',
      activePath: ctxSysPath,
      ...(piPath && piPath !== ctxSysPath ? { candidatePath: piPath } : {}),
      ...(ctxAppPath ? { appendPath: ctxAppPath } : {}),
      ...(agentsCount !== undefined ? { agentsCount } : {}),
      ...(surgeText ? { surgeLabel: surgeText } : {}),
      hint: piMeta ? (zh ? 'pi-purge OFF · /purge on 可精简或替换' : 'pi-purge OFF · run /purge on') : undefined,
    };
  }

  const hasContextOrPurgePresence =
    piMeta !== undefined ||
    agyMeta !== undefined ||
    ctxMeta !== undefined ||
    surgeText !== undefined ||
    Boolean(runtime.agentId) ||
    Boolean(runtime.modelLabel);
  if (!hasContextOrPurgePresence) return null;

  const commandHint = isAntigravity
    ? zh
      ? 'Antigravity 原生提示词 · `/agy <文件路径>` 可替换'
      : 'Native prompt · `/agy <filepath>` to replace'
    : piMeta
      ? zh
        ? 'Pi 默认系统提示词 · `/purge <文件路径>` 或 `/purge on`'
        : 'Pi default prompt · `/purge <filepath>` or `/purge on`'
      : zh
        ? 'Pi 默认系统提示词 · `/purge <文件路径>` 可指定替换文件'
        : 'Pi default prompt · `/purge <filepath>` to override';

  return {
    engine: 'default',
    badge: isAntigravity
      ? zh
        ? 'Antigravity 原生 (PURGE OFF)'
        : 'Antigravity Native (PURGE OFF)'
      : zh
        ? 'Pi 默认 (PURGE OFF)'
        : 'Pi Default (PURGE OFF)',
    tone: 'muted',
    ...(piPath ? { candidatePath: piPath } : agyPath ? { candidatePath: agyPath } : {}),
    ...(ctxAppPath ? { appendPath: ctxAppPath } : {}),
    ...(agentsCount !== undefined ? { agentsCount } : {}),
    ...(surgeText ? { surgeLabel: surgeText } : {}),
    hint: commandHint,
  };
}

function deriveAntigravityView(
  runtime: SessionStatusRuntimeInfo,
  statuses: ReadonlyMap<string, string>,
  zh: boolean,
): AntigravityPanelView | null {
  const accMeta = tryParseJsonRecord(statuses.get('meta:agy-account'));
  const rebuildMeta = tryParseJsonRecord(statuses.get('meta:agy-rebuild'));
  const quotaMeta = tryParseJsonRecord(statuses.get('meta:agy-quota'));
  const accStatus = statuses.get('agy-account');
  const quotaStatus = statuses.get('agy-quota');
  const routeText = statuses.get('agy-route');

  const isAntigravity =
    runtime.agentId === 'antigravity' ||
    accMeta !== undefined ||
    rebuildMeta !== undefined ||
    quotaMeta !== undefined ||
    accStatus !== undefined ||
    quotaStatus !== undefined ||
    routeText !== undefined;
  if (!isAntigravity) return null;

  const accountLabel =
    typeof accMeta?.label === 'string'
      ? accMeta.label
      : typeof accMeta?.id === 'string'
        ? accMeta.id
        : accStatus ?? (zh ? 'default (系统账号)' : 'default (system)');
  const isSystemAccount = accMeta?.isSystem !== false && (accMeta?.id === undefined || accMeta?.id === 'default');
  const proxyLabel = typeof accMeta?.proxy === 'string' && accMeta.proxy ? accMeta.proxy : undefined;
  const cooldownCount = typeof accMeta?.cooldown === 'number' ? accMeta.cooldown : undefined;

  let autoRebuildLabel: string | undefined;
  if (rebuildMeta) {
    const autoOn = rebuildMeta.auto === true;
    const count = typeof rebuildMeta.count === 'number' ? rebuildMeta.count : 0;
    autoRebuildLabel = autoOn
      ? zh
        ? `自动重建 ON (本会话 ${count} 次)`
        : `Auto-rebuild ON (${count}x)`
      : zh
        ? `自动重建 OFF${count > 0 ? ` (已重建 ${count} 次)` : ''}`
        : `Auto-rebuild OFF${count > 0 ? ` (${count}x)` : ''}`;
  }

  const quotaBuckets: AntigravityQuotaBucketView[] = [];
  if (Array.isArray(quotaMeta?.buckets)) {
    for (const raw of quotaMeta.buckets) {
      if (typeof raw !== 'object' || raw === null) continue;
      const b = raw as Record<string, unknown>;
      const id = typeof b.id === 'string' ? b.id : '';
      const label = typeof b.label === 'string' ? b.label : id;
      const rem = typeof b.remainingPct === 'number' ? b.remainingPct : Number.NaN;
      if (!label || !Number.isFinite(rem)) continue;
      quotaBuckets.push({
        id: id || label,
        label,
        remainingPct: Math.max(0, Math.min(100, Math.round(rem))),
        ...(typeof b.reset === 'string' && b.reset ? { resetLabel: b.reset } : {}),
      });
    }
  }

  return {
    accountLabel,
    isSystemAccount,
    ...(proxyLabel ? { proxyLabel } : {}),
    ...(cooldownCount !== undefined && cooldownCount > 0 ? { cooldownCount } : {}),
    ...(routeText ? { routeText } : {}),
    routeDegraded: Boolean(routeText && (routeText.includes('⚠') || routeText.toLowerCase().includes('degrad'))),
    ...(autoRebuildLabel ? { autoRebuildLabel } : {}),
    ...(quotaStatus ? { quotaHeadline: quotaStatus } : {}),
    ...(typeof quotaMeta?.accountId === 'string' ? { quotaAccountId: quotaMeta.accountId } : {}),
    quotaBuckets,
    ...(typeof quotaMeta?.err === 'string' && quotaMeta.err ? { quotaError: quotaMeta.err } : {}),
  };
}

export function deriveSessionStatusInsights(
  runtime: SessionStatusRuntimeInfo | undefined,
  zh: boolean,
): SessionStatusInsights {
  if (!runtime) {
    return { overview: null, prompt: null, antigravity: null, extraStatuses: [], hasDetails: false };
  }
  const statuses = new Map<string, string>();
  for (const item of runtime.extensionSurface?.statuses ?? []) {
    statuses.set(item.key, item.text);
  }

  const overview = deriveOverview(runtime, zh);
  const prompt = derivePromptView(runtime, statuses, zh);
  const antigravity = deriveAntigravityView(runtime, statuses, zh);
  const extraStatuses: { key: string; text: string }[] = [];
  for (const item of runtime.extensionSurface?.statuses ?? []) {
    if (item.key.startsWith('meta:') || DEDICATED_STATUS_KEYS.has(item.key)) continue;
    extraStatuses.push({ key: item.key, text: item.text });
  }

  return {
    overview,
    prompt,
    antigravity,
    extraStatuses,
    hasDetails:
      overview !== null ||
      prompt !== null ||
      antigravity !== null ||
      extraStatuses.length > 0,
  };
}
