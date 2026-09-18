import type { ReactElement } from 'react';
import type { ContextUsageSnapshot, ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import { formatTimestamp } from './format-timestamp.js';
import { ProviderIcon } from './provider-icons.js';

/**
 * Inkstone turn marginalia (proto-01 §1 block 06).
 *
 * One column-left rail per turn: who produced it, when, and what it cost.
 * A byline anchored to the top of its turn — it scrolls away with the message
 * (not sticky: a tall virtualized turn stranded the label at the viewport top
 * over unrelated content). The inline head repeats who/usage for cramped
 * stages. User turns have no 「你」 byline. Assistant age sits on the left
 * rail as a reserved clock; user age sits on the card and appears on hover.
 * CSS shows the rail via
 * `@container transcript-stage (min-width: 1000px)` on `.chat-stage`
 * (proto-01 `.stage`), never on the scrollport — querying the scrollport
 * oscillates at the threshold. The leftover gutter is `100cqw` of that
 * named stage so a `--chat-max`-sized thread cannot collapse `.who`.
 */

export function formatTurnClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** User-card age: `1min ago` / `1h ago` / `1d ago`. Number sticks to the unit. */
export function formatTurnRelativeAge(iso: string, nowMs = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const delta = Math.max(0, nowMs - date.getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTurnExactStamp(iso: string, locale?: 'zh-CN' | 'en'): string {
  return formatTimestamp(iso, locale !== 'en');
}

/**
 * Short, clean label for display in marginalia.
 *
 * Normalizes vendor prefixes, snapshot dates, and version patterns:
 * - 'claude-3-7-sonnet-20250219' → 'Sonnet 3.7'
 * - 'claude-sonnet-4-6' → 'Sonnet 4.6'
 * - 'gemini-2-5-pro' → 'Gemini 2.5 Pro'
 * - 'deepseek-reasoner' → 'DeepSeek R1'
 * - 'deepseek-chat' → 'DeepSeek V3'
 * - 'openai-gpt-5-4' → 'GPT-5.4'
 * - 'gpt-4o-2024-11-20' → 'GPT-4o'
 */
export function shortModelLabel(modelId: string): string {
  if (!modelId) return '';
  const trimmed = modelId.trim();

  // Strip org prefix before slash (e.g. 'anthropic/claude-3-7-sonnet' -> 'claude-3-7-sonnet')
  const afterSlash = trimmed.split(/[\\/]/).pop() ?? trimmed;

  // Specific canonical mappings first
  if (/^deepseek-reasoner/i.test(afterSlash)) return 'DeepSeek R1';
  if (/^deepseek-chat/i.test(afterSlash)) return 'DeepSeek V3';

  // Strip date stamps at the end: e.g. -20250219, -2024-11-20, -20241022, -01-21, -latest, -preview
  const clean = afterSlash
    .replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}$/, '')
    .replace(/[-_]\d{8}$/, '')
    .replace(/[-_]\d{2}-\d{2}$/, '')
    .replace(/[-_](latest|preview|exp)$/i, '');

  // Claude: claude-3-7-sonnet -> Sonnet 3.7; claude-sonnet-4-6 -> Sonnet 4.6
  const claudeMatch = clean.match(/^claude-(?:(\d+)[-_](\d+)[-_])?([a-z]+)(?:[-_](\d+)(?:[-_](\d+))?)?/i);
  if (claudeMatch) {
    const major = claudeMatch[1] ?? claudeMatch[4];
    const minor = claudeMatch[2] ?? claudeMatch[5];
    const familyRaw = claudeMatch[3] ?? '';
    const family = familyRaw.charAt(0).toUpperCase() + familyRaw.slice(1).toLowerCase();
    if (major && minor) return `${family} ${major}.${minor}`;
    if (major) return `${family} ${major}`;
    if (family) return family;
  }

  // Gemini: gemini-2-5-pro -> Gemini 2.5 Pro; gemini-2.0-flash... -> Gemini 2.0 Flash
  const geminiMatch = clean.match(/^gemini[-_](\d+)(?:[._-](\d+))?[-_]([a-z]+)/i);
  if (geminiMatch) {
    const major = geminiMatch[1];
    const minor = geminiMatch[2] ?? '0';
    const tierRaw = geminiMatch[3] ?? '';
    const tier = tierRaw.charAt(0).toUpperCase() + tierRaw.slice(1).toLowerCase();
    return `Gemini ${major}.${minor} ${tier}`;
  }

  // GPT: gpt-4o, gpt-4o-mini, gpt-5-4, openai-gpt-5-4
  const gptMatch = clean.match(/^(?:openai[-_])?gpt[-_]([0-9a-z.-]+)/i);
  if (gptMatch) {
    const rest = gptMatch[1] ?? '';
    if (/^\d+[-_.]\d+$/.test(rest)) {
      return `GPT-${rest.replace(/[-_]/g, '.')}`;
    }
    if (/^4o[-_]mini$/i.test(rest)) return 'GPT-4o mini';
    if (/^4o$/i.test(rest)) return 'GPT-4o';
    return `GPT-${rest}`;
  }

  // o1 / o3: o1-mini, o3-mini, o1
  if (/^o[13](?:-mini)?$/i.test(clean)) {
    return clean;
  }

  // DeepSeek: DeepSeek-V3, DeepSeek-R1, deepseek-v4-1-flash -> DeepSeek V4.1 Flash
  const dsMatch = clean.match(/^deepseek[-_]([rv]\d+)(?:[-_.](\d+))?(?:[-_]([a-z]+))?/i);
  if (dsMatch) {
    const ver = `${dsMatch[1]?.toUpperCase() ?? ''}${dsMatch[2] ? `.${dsMatch[2]}` : ''}`;
    const tierRaw = dsMatch[3] ?? '';
    const tier = tierRaw ? ` ${tierRaw.charAt(0).toUpperCase()}${tierRaw.slice(1).toLowerCase()}` : '';
    return `DeepSeek ${ver}${tier}`;
  }

  // Fallback cleanup: strip leading vendor prefixes
  const stripped = clean.replace(/^(claude|anthropic|openai|google|gemini|deepseek|gpt)-/i, '');
  const parts = stripped.split(/[-_.]/).filter(Boolean);
  if (parts.length === 0) return clean;
  const head = parts[0] ?? '';
  let tailParts = parts.slice(1);
  let name = head.charAt(0).toUpperCase() + head.slice(1);
  // A versioned head keeps its minor: v4-1-flash -> V4.1 flash, not "V4 1 flash".
  if (/\d$/.test(head)) {
    while (tailParts[0] !== undefined && /^\d+$/.test(tailParts[0])) {
      name += `.${tailParts[0]}`;
      tailParts = tailParts.slice(1);
    }
  }
  if (tailParts.length === 0) return name;
  const tail = tailParts.every((p) => /^\d+$/.test(p))
    ? tailParts.join('.')
    : tailParts.join(' ');
  return `${name} ${tail}`;
}

export function resolveModelAvatarInitial(
  modelId?: string,
  providerId?: string,
  themeId?: string,
): string {
  const target = `${providerId ?? ''} ${modelId ?? ''}`.toLowerCase();
  if (target.includes('claude') || target.includes('anthropic')) return 'C';
  if (target.includes('gemini') || target.includes('google')) return 'G';
  if (target.includes('deepseek')) return 'D';
  if (target.includes('qwen')) return 'Q';
  if (target.includes('openai') || target.includes('gpt') || target.includes('o1') || target.includes('o3')) return 'O';
  if (target.includes('grok') || target.includes('xai')) return 'G';
  if (themeId && !themeId.includes('inkstone')) {
    return '智';
  }
  return '墨';
}

export function formatTokensK(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(tokens);
}

export type TurnMarginaliaData = {
  who: string;
  fullModelId?: string | null | undefined;
  avatar: string | null;
  clock: string;
  clockExact?: string;
  usage: string | null;
  status?: string | null;
  /** Live-run tone. Running stays a pulse on the glyph (the body's fold row
   *  already says 运行中); waiting keeps its label because it needs the user. */
  statusTone?: TurnStatusTone | null;
  model?: ModelRef | null | undefined;
};

export type TurnStatusTone = 'running' | 'waiting';

export type ResolveTurnMarginaliaOptions = {
  editingMessageId?: string | null | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  contextUsage?: ContextUsageSnapshot | null | undefined;
  status?: string | null | undefined;
  statusTone?: TurnStatusTone | null | undefined;
  model?: ModelRef | null | undefined;
  forceRole?: 'user' | 'assistant' | undefined;
  themeId?: string | undefined;
  isConversationSession?: boolean | undefined;
  nowMs?: number | undefined;
};

function resolveAssistantClocks(
  iso: string | undefined,
  options?: ResolveTurnMarginaliaOptions,
): Pick<TurnMarginaliaData, 'clock' | 'clockExact'> {
  const createdAt = iso ?? '';
  return {
    clock: formatTurnRelativeAge(createdAt, options?.nowMs),
    clockExact: formatTurnExactStamp(createdAt, options?.locale),
  };
}

export function resolveTurnMarginalia(
  messages: readonly ChatMessageUi[],
  options?: ResolveTurnMarginaliaOptions,
): TurnMarginaliaData {
  const lead = messages[0];
  const isAssistant =
    options?.forceRole === 'assistant' ||
    (options?.forceRole === undefined && lead !== undefined && lead.role === 'assistant');

  if (!isAssistant) {
    const isEditing = Boolean(
      options?.editingMessageId &&
        messages.some((m) => m.id === options.editingMessageId),
    );
    const isIntervention = lead?.instructionDelivery !== undefined;
    const isChinese = options?.locale !== 'en';
    const usage = isEditing
      ? isChinese
        ? '编辑中'
        : 'Editing'
      : isIntervention
        ? isChinese
          ? '介入'
          : 'Intervention'
        : null;
    return {
      who: '',
      avatar: null,
      clock: '',
      usage,
    };
  }

  // Find the assistant message in the turn (could be lead or subsequent)
  const assistantMsg = messages.find((m) => m.role === 'assistant') ?? lead;
  const model = assistantMsg?.model ?? options?.model ?? null;
  const modelId = model?.modelId ?? '';
  const label = modelId.length > 0 ? shortModelLabel(modelId) : 'piwin';
  const avatar = resolveModelAvatarInitial(modelId, model?.providerId, options?.themeId);

  // Conversation byline is who + age. Cost/duration stay off the rail.
  if (options?.isConversationSession === true) {
    return {
      who: label,
      fullModelId: modelId.length > 0 ? modelId : label,
      avatar,
      ...resolveAssistantClocks(assistantMsg?.createdAt, options),
      usage: null,
      ...(model ? { model } : {}),
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.status && options.statusTone ? { statusTone: options.statusTone } : {}),
    };
  }

  const totalTools = messages.reduce((acc, m) => acc + (m.tools?.length ?? 0), 0);

  // Tokens live in the turn colophon (`.colo-meta`), not the rail — model is
  // already `.who`, and repeating "13k" next to "Opus 5" at the foot reads as
  // duplicate chrome. Duration already lives on the work fold; thinking-span
  // next to a tool count on this rail is both duplicate and usually wrong.
  const usage = totalTools > 0 ? `${totalTools} 工具` : null;

  return {
    who: label,
    fullModelId: modelId.length > 0 ? modelId : label,
    avatar,
    ...resolveAssistantClocks(assistantMsg?.createdAt, options),
    usage,
    ...(model ? { model } : {}),
    ...(options?.status ? { status: options.status } : {}),
    ...(options?.status && options.statusTone ? { statusTone: options.statusTone } : {}),
  };
}

export function hasTurnByline(data: TurnMarginaliaData): boolean {
  return (
    data.who.length > 0 ||
    data.clock.length > 0 ||
    data.usage !== null ||
    Boolean(data.status) ||
    data.avatar !== null
  );
}

export function ChatTurnMarginalia(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  const isAssistant = data.avatar !== null;
  const modelRef = data.model ?? (data.fullModelId && data.fullModelId !== 'piwin' ? { providerId: '', modelId: data.fullModelId } : null);
  const avatarContent = modelRef ? (
    <ProviderIcon
      id={modelRef.providerId || 'piwin'}
      modelId={modelRef.modelId}
      name={data.who}
      size={14}
      variant="glyph"
      className="turn-model-icon"
    />
  ) : (
    data.avatar
  );

  return (
    <aside
      className={`marg chat-marginalia ${isAssistant ? 'is-assistant' : 'is-user'}`}
      aria-hidden="true"
      {...(data.statusTone ? { 'data-status-tone': data.statusTone } : {})}
    >
      {data.who.length > 0 || data.avatar !== null ? (
        // Name then glyph on one lead row; the row clips a glyph that would
        // wrap, so a long name drops the mark instead of losing its tail.
        <div className="turn-byline">
          {data.who.length > 0 ? (
            <span
              className={isAssistant ? 'who' : 'who is-user'}
              {...(data.fullModelId ? { title: data.fullModelId } : {})}
            >
              {data.who}
            </span>
          ) : null}
          {data.avatar !== null ? (
            <div className={`av${modelRef ? ' has-model-icon' : ''}`}>{avatarContent}</div>
          ) : null}
        </div>
      ) : null}
      {data.clock.length > 0 ? (
        <span className="turn-clock" title={data.clockExact || undefined}>
          {data.clock}
        </span>
      ) : null}
      {data.usage !== null ? <span>{data.usage}</span> : null}
      {data.status ? <span data-st="status">{data.status}</span> : null}
    </aside>
  );
}

export function ChatTurnHead(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  const isAssistant = data.avatar !== null;
  const modelRef = data.model ?? (data.fullModelId && data.fullModelId !== 'piwin' ? { providerId: '', modelId: data.fullModelId } : null);
  const avatarContent = modelRef ? (
    <ProviderIcon
      id={modelRef.providerId || 'piwin'}
      modelId={modelRef.modelId}
      name={data.who}
      size={14}
      variant="glyph"
      className="turn-model-icon"
    />
  ) : (
    data.avatar
  );

  return (
    <div
      className={`head chat-turn-head ${isAssistant ? 'is-assistant' : 'is-user'}`}
      aria-hidden="true"
      {...(data.statusTone ? { 'data-status-tone': data.statusTone } : {})}
    >
      {data.avatar !== null ? (
        <span className={`av${modelRef ? ' has-model-icon' : ''}`}>{avatarContent}</span>
      ) : null}
      {data.who.length > 0 ? (
        <span
          className={isAssistant ? 'who' : 'who is-user'}
          {...(data.fullModelId ? { title: data.fullModelId } : {})}
        >
          {data.who}
        </span>
      ) : null}
      {data.usage !== null ? <span>{data.usage}</span> : null}
      {data.status ? <span data-st="status">{data.status}</span> : null}
    </div>
  );
}

/** proto-00 `.colo-meta` at the foot of a reply — tokens only.
 *  Model already lives in the left rail (`.who`); repeating it here as a lone
 *  "Opus 5" pill is duplicate chrome. When usage is unknown, return null. */
export function buildAssistantColophonMeta(input: {
  message: ChatMessageUi;
  locale: 'zh-CN' | 'en';
  contextUsage?: ContextUsageSnapshot | null | undefined;
}): string | null {
  const tokens =
    input.contextUsage?.totalTokens ??
    input.contextUsage?.completionTokens ??
    input.contextUsage?.promptTokens;

  if (typeof tokens !== 'number' || tokens <= 0) return null;

  const amount = formatTokensK(tokens);
  return input.locale === 'zh-CN'
    ? `本轮消耗 ${amount} tokens`
    : `${amount} tokens this turn`;
}
