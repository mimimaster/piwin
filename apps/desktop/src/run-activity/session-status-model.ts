/**
 * Pure derivation for `SessionStatusPanel` — headerless session identity,
 * system-prompt / Purge state, and external plugin status rows.
 *
 * Metrics already permanent in the composer bar (model, effort, mode, context
 * ring, token/turn/cost totals, workspace path) are intentionally excluded so
 * the status sheet never duplicates chrome below the stage.
 */
import type { ExtensionUiSurfaceSnapshot } from '@piwin/contracts';
import { sanitizePreviewSnippet } from '../session/session-row-item.js';

export type SessionStatusRuntimeInfo = {
  agentId?: string | undefined;
  sessionId?: string | null | undefined;
  nativeSessionId?: string | undefined;
  /** Human-readable session name from the sidebar list when available. */
  sessionTitle?: string | undefined;
  /** Fallback snippet when `sessionTitle` is unset or a machine id. */
  sessionPreview?: string | undefined;
  extensionSurface?: ExtensionUiSurfaceSnapshot | undefined;
};

export type SessionHeaderRowView = {
  title: string;
  /** Underlying session id copied on click, never shown as raw label text. */
  copyId?: string | undefined;
};

export type PromptRowView = {
  engine: 'pi-purge' | 'agy-purge' | 'context-system' | 'default';
  tone: 'override' | 'muted' | 'warning';
  /** Shortened right-hand meta (`默认 · AGENTS ×1` or `…/.pi/SYSTEM.md`). */
  meta: string;
  isMonoMeta: boolean;
  /** Full path copied on click when an external prompt file is active. */
  activePath?: string | undefined;
  tooltip: string;
};

export type PluginStatusRowView = {
  id: string;
  title: string;
  meta: string;
  isMonoMeta?: boolean | undefined;
  tone: 'ready' | 'warning' | 'muted';
  tooltip?: string | undefined;
};

export type SessionStatusInsights = {
  session: SessionHeaderRowView | null;
  prompt: PromptRowView | null;
  plugins: readonly PluginStatusRowView[];
  /** Any row exists for the headerless top group. */
  hasTopGroup: boolean;
  /** Non-default prompt or live plugin signal worth auto-docking on wide stage. */
  hasAutoDockSignal: boolean;
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

const MACHINE_SESSION_NAME_RE =
  /^(?:session|sess|conv|chat|draft|untitled|new[-_ ]?session|new[-_ ]?chat)(?:[-_][a-z0-9_-]{3,})?$/i;

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

export function shortenPathMiddle(path: string, max = 26): string {
  if (path.length <= max) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return `…${path.slice(-(max - 1))}`;
  const tail = parts.slice(-2).join('/');
  if (tail.length + 2 <= max) return `…/${tail}`;
  const base = parts.at(-1) ?? tail;
  return base.length + 2 <= max ? `…/${base}` : `…${base.slice(-(max - 1))}`;
}

function firstCleanLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const cleaned = sanitizePreviewSnippet(text)
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function isHumanSessionTitle(
  candidate: string | undefined,
  sessionId: string | null | undefined,
  nativeSessionId: string | undefined,
): candidate is string {
  if (!candidate) return false;
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (trimmed === sessionId || trimmed === nativeSessionId) return false;
  if (MACHINE_SESSION_NAME_RE.test(trimmed)) return false;
  return true;
}

function deriveSessionRow(
  runtime: SessionStatusRuntimeInfo,
  zh: boolean,
): SessionHeaderRowView | null {
  const copyId = runtime.nativeSessionId ?? runtime.sessionId ?? undefined;
  const humanTitle = isHumanSessionTitle(
    runtime.sessionTitle,
    runtime.sessionId,
    runtime.nativeSessionId,
  )
    ? runtime.sessionTitle.trim()
    : firstCleanLine(runtime.sessionPreview);

  if (!humanTitle && !copyId) return null;

  return {
    title: humanTitle ?? (zh ? '当前会话' : 'Current session'),
    ...(copyId ? { copyId } : {}),
  };
}

function formatAgentsSuffix(agentsCount: number | undefined): string {
  return agentsCount !== undefined && agentsCount > 0 ? ` · AGENTS ×${agentsCount}` : '';
}

function derivePromptRow(
  runtime: SessionStatusRuntimeInfo,
  statuses: ReadonlyMap<string, string>,
  zh: boolean,
): PromptRowView | null {
  const piMeta = tryParseJsonRecord(statuses.get('meta:pi-purge'));
  const piStatus = statuses.get('pi-purge');
  const piPath = statuses.get('meta:pi-purge-path');

  const agyMeta = tryParseJsonRecord(statuses.get('meta:agy-purge'));
  const agyStatus = statuses.get('agy-purge');
  const agyPath = statuses.get('meta:agy-purge-path');

  const ctxMeta = tryParseJsonRecord(statuses.get('meta:context-prompt'));
  const ctxSysPath = statuses.get('meta:context-sys-path');
  const ctxAppPath = statuses.get('meta:context-app-path');

  const agentsCount = typeof ctxMeta?.agents === 'number' ? ctxMeta.agents : undefined;
  const isAntigravity =
    runtime.agentId === 'antigravity' || agyMeta !== undefined || agyStatus !== undefined;

  const piPurgeOn = piMeta ? piMeta.on === true : Boolean(piStatus);
  const agyPurgeOn = agyMeta ? agyMeta.on === true : Boolean(agyStatus);

  if (agyPurgeOn) {
    const error = typeof agyMeta?.err === 'string' ? agyMeta.err : undefined;
    const meta = error
      ? zh
        ? '加载异常'
        : 'Error'
      : agyPath
        ? shortenPathMiddle(agyPath)
        : zh
          ? '自定义生效'
          : 'Custom active';
    const tooltipParts = [
      error
        ? error
        : zh
          ? '自定义提示词生效中（点击复制完整路径）'
          : 'Custom prompt active (click to copy path)',
      agyPath,
    ].filter(Boolean);
    return {
      engine: 'agy-purge',
      tone: error ? 'warning' : 'override',
      meta,
      isMonoMeta: Boolean(agyPath) && !error,
      ...(agyPath ? { activePath: agyPath } : {}),
      tooltip: tooltipParts.join('\n'),
    };
  }

  if (piPurgeOn) {
    const source = typeof piMeta?.source === 'string' ? piMeta.source : '';
    const error = typeof piMeta?.err === 'string' ? piMeta.err : undefined;
    const resolvedPath =
      piPath ?? (source === 'builtin-strict' ? undefined : ctxSysPath);
    const meta = error
      ? zh
        ? '加载异常'
        : 'Error'
      : resolvedPath
        ? shortenPathMiddle(resolvedPath)
        : source === 'builtin-strict'
          ? zh
            ? '内置精简'
            : 'Built-in strict'
          : zh
            ? '自定义生效'
            : 'Custom active';
    const tooltipParts = [
      error
        ? error
        : resolvedPath
          ? zh
            ? '自定义提示词生效中（点击复制完整路径）'
            : 'Custom prompt active (click to copy path)'
          : zh
            ? '内置精简系统提示词生效中'
            : 'Built-in strict system prompt active',
      resolvedPath,
      ctxAppPath ? `${zh ? '追加' : 'Append'}: ${ctxAppPath}` : undefined,
    ].filter(Boolean);
    return {
      engine: 'pi-purge',
      tone: error ? 'warning' : 'override',
      meta,
      isMonoMeta: Boolean(resolvedPath) && !error,
      ...(resolvedPath ? { activePath: resolvedPath } : {}),
      tooltip: tooltipParts.join('\n'),
    };
  }

  if (ctxSysPath) {
    return {
      engine: 'context-system',
      tone: 'override',
      meta: shortenPathMiddle(ctxSysPath),
      isMonoMeta: true,
      activePath: ctxSysPath,
      tooltip: [
        zh ? '外部系统提示词生效中（点击复制完整路径）' : 'System prompt file active (click to copy path)',
        ctxSysPath,
        ctxAppPath ? `${zh ? '追加' : 'Append'}: ${ctxAppPath}` : undefined,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  const hasPromptPresence =
    piMeta !== undefined ||
    agyMeta !== undefined ||
    ctxMeta !== undefined ||
    Boolean(runtime.agentId) ||
    Boolean(runtime.sessionId) ||
    Boolean(runtime.nativeSessionId);
  if (!hasPromptPresence) return null;

  const baseMeta = zh ? '默认' : 'Default';
  const tooltip = isAntigravity
    ? zh
      ? '当前使用默认提示词（可通过 /agy 指定外部提示词文件）'
      : 'Using default prompt (/agy <filepath> to override)'
    : zh
      ? '当前使用默认提示词（可通过 /purge 指定外部提示词文件）'
      : 'Using default prompt (/purge <filepath> to override)';

  return {
    engine: 'default',
    tone: 'muted',
    meta: `${baseMeta}${formatAgentsSuffix(agentsCount)}`,
    isMonoMeta: false,
    tooltip: ctxAppPath
      ? `${tooltip}\n${zh ? '追加' : 'Append'}: ${ctxAppPath}`
      : tooltip,
  };
}

function deriveAntigravityPluginRow(
  runtime: SessionStatusRuntimeInfo,
  statuses: ReadonlyMap<string, string>,
  zh: boolean,
): PluginStatusRowView | null {
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
    typeof accMeta?.label === 'string' && accMeta.label
      ? accMeta.label
      : typeof accMeta?.id === 'string' && accMeta.id
        ? accMeta.id
        : accStatus;
  const isCustomAccount =
    Boolean(accountLabel) && accountLabel !== 'default' && accMeta?.isSystem === false;
  const proxyLabel =
    typeof accMeta?.proxy === 'string' && accMeta.proxy ? accMeta.proxy : undefined;
  const cooldownCount =
    typeof accMeta?.cooldown === 'number' && accMeta.cooldown > 0
      ? accMeta.cooldown
      : undefined;

  const routeDegraded = Boolean(
    routeText && (routeText.includes('⚠') || routeText.toLowerCase().includes('degrad')),
  );
  const quotaError =
    typeof quotaMeta?.err === 'string' && quotaMeta.err ? quotaMeta.err : undefined;

  let lowestPct: number | undefined;
  const bucketNotes: string[] = [];
  if (Array.isArray(quotaMeta?.buckets)) {
    for (const raw of quotaMeta.buckets) {
      if (typeof raw !== 'object' || raw === null) continue;
      const bucket = raw as Record<string, unknown>;
      const label =
        typeof bucket.label === 'string'
          ? bucket.label
          : typeof bucket.id === 'string'
            ? bucket.id
            : '';
      const rem = typeof bucket.remainingPct === 'number' ? bucket.remainingPct : Number.NaN;
      if (!label || !Number.isFinite(rem)) continue;
      const pct = Math.max(0, Math.min(100, Math.round(rem)));
      lowestPct = lowestPct === undefined ? pct : Math.min(lowestPct, pct);
      const reset = typeof bucket.reset === 'string' && bucket.reset ? ` (${bucket.reset})` : '';
      bucketNotes.push(`${label}: ${pct}%${reset}`);
    }
  }

  const stateWord = routeDegraded
    ? zh
      ? '路由降级'
      : 'Degraded'
    : quotaError
      ? zh
        ? '配额异常'
        : 'Quota error'
      : zh
        ? '正常'
        : 'Normal';

  const quotaWord =
    lowestPct !== undefined
      ? zh
        ? `余量 ${lowestPct}%`
        : `${lowestPct}% left`
      : quotaStatus;

  const metaParts = [
    isCustomAccount ? accountLabel : undefined,
    stateWord,
    !routeDegraded && quotaWord ? quotaWord : undefined,
  ].filter(Boolean);

  const rebuildNote = rebuildMeta
    ? rebuildMeta.auto === true
      ? zh
        ? `自动重建开启 (${typeof rebuildMeta.count === 'number' ? rebuildMeta.count : 0} 次)`
        : `Auto-rebuild ON (${typeof rebuildMeta.count === 'number' ? rebuildMeta.count : 0}x)`
      : undefined
    : undefined;

  const tooltipLines = [
    accountLabel ? `${zh ? '账号' : 'Account'}: ${accountLabel}` : undefined,
    proxyLabel ? `${zh ? '代理' : 'Proxy'}: ${proxyLabel}` : undefined,
    cooldownCount ? `${zh ? '冷却池' : 'Cooldown'}: ${cooldownCount}` : undefined,
    routeText ? `${zh ? '路由' : 'Route'}: ${routeText}` : undefined,
    rebuildNote,
    ...bucketNotes,
    quotaError,
  ].filter(Boolean);

  const isWarn = routeDegraded || Boolean(quotaError) || (lowestPct !== undefined && lowestPct <= 15);

  return {
    id: 'antigravity',
    title: zh ? 'Antigravity 通道' : 'Antigravity',
    meta: metaParts.join(' · '),
    isMonoMeta: lowestPct !== undefined || Boolean(isCustomAccount),
    tone: isWarn ? 'warning' : 'ready',
    ...(tooltipLines.length > 0 ? { tooltip: tooltipLines.join('\n') } : {}),
  };
}

function humanizePluginKey(key: string, zh: boolean): string {
  if (key === 'piwin-surge') return zh ? '网络代理 (Surge)' : 'Surge';
  if (key === 'deepseek-cache') return zh ? 'DeepSeek 缓存' : 'DeepSeek cache';
  return key
    .replace(/^piwin[-_]/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export function deriveSessionStatusInsights(
  runtime: SessionStatusRuntimeInfo | undefined,
  zh: boolean,
): SessionStatusInsights {
  if (!runtime) {
    return {
      session: null,
      prompt: null,
      plugins: [],
      hasTopGroup: false,
      hasAutoDockSignal: false,
    };
  }

  const statuses = new Map<string, string>();
  for (const item of runtime.extensionSurface?.statuses ?? []) {
    statuses.set(item.key, item.text);
  }

  const session = deriveSessionRow(runtime, zh);
  const prompt = derivePromptRow(runtime, statuses, zh);
  const plugins: PluginStatusRowView[] = [];

  const surgeText = statuses.get('piwin-surge')?.trim();
  if (surgeText) {
    plugins.push({
      id: 'piwin-surge',
      title: humanizePluginKey('piwin-surge', zh),
      meta: surgeText,
      tone: surgeText.includes('⚠') ? 'warning' : 'ready',
    });
  }

  const antigravityRow = deriveAntigravityPluginRow(runtime, statuses, zh);
  if (antigravityRow) {
    plugins.push(antigravityRow);
  }

  for (const item of runtime.extensionSurface?.statuses ?? []) {
    if (item.key.startsWith('meta:') || DEDICATED_STATUS_KEYS.has(item.key)) continue;
    const text = item.text.trim();
    if (!text) continue;
    plugins.push({
      id: item.key,
      title: humanizePluginKey(item.key, zh),
      meta: text,
      isMonoMeta: /[0-9%/:]/.test(text),
      tone: text.includes('⚠') || /err|fail/i.test(text) ? 'warning' : 'ready',
    });
  }

  const hasTopGroup = session !== null || prompt !== null || plugins.length > 0;
  const hasAutoDockSignal =
    (prompt !== null && prompt.engine !== 'default') || plugins.length > 0;

  return {
    session,
    prompt,
    plugins,
    hasTopGroup,
    hasAutoDockSignal,
  };
}
