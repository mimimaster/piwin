/**
 * Provider brand icons via `modelicons` (official AI brand SVGs).
 * Known vendors → Avatar chip; unknown/custom → monogram from display name.
 */

import type { CSSProperties, ComponentType, ReactElement } from 'react';
import {
  AlibabaCloud,
  Anthropic,
  Azure,
  AzureAI,
  ByteDance,
  Claude,
  Codex,
  Copilot,
  DeepSeek,
  Doubao,
  Gemini,
  Github,
  GithubCopilot,
  Grok,
  Groq,
  Kimi,
  LmStudio,
  Moonshot,
  Ollama,
  OpenAI,
  OpenCode,
  OpenRouter,
  Qwen,
  SiliconCloud,
  Stepfun,
  Volcengine,
  XAI,
  XiaomiMiMo,
  Zhipu,
} from 'modelicons';

export type ProviderIconProps = {
  /** Preset id or provider config id. */
  id: string;
  /** Display name — used for monogram when no brand mark matches. */
  name?: string;
  /** Model ID for fallback brand detection when provider ID is custom (e.g. OpenAI proxy / custom gateway). */
  modelId?: string;
  size?: number;
  radius?: number | string;
  /** `avatar` (default) is the brand chip; `glyph` is the bare mark with no
   *  tile, for quiet bylines where a filled disc would out-shout the text. */
  variant?: 'avatar' | 'glyph';
  className?: string;
  style?: CSSProperties;
};

type BrandIcon = ComponentType<{
  size?: number | string;
  style?: CSSProperties;
  className?: string;
}> & {
  Avatar?: ComponentType<{ size?: number | string; style?: CSSProperties; className?: string }>;
  Color?: ComponentType<{ size?: number | string; style?: CSSProperties; className?: string }>;
  colorPrimary?: string;
  title?: string;
};

type BrandEntry = {
  Icon: BrandIcon;
  /** Soft pastel tile behind mono glyph when Avatar is unavailable. */
  softBg: string;
  softFg: string;
};

/** Soft pastel pairs for monogram avatars (unknown / custom providers). */
const MONO_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#e8eefc', fg: '#3b5bdb' },
  { bg: '#e9f7ef', fg: '#0f9d63' },
  { bg: '#fdecec', fg: '#d64545' },
  { bg: '#fdf1dd', fg: '#b06a00' },
  { bg: '#eee9fe', fg: '#6a4df4' },
  { bg: '#e6f0fa', fg: '#2f6fb2' },
  { bg: '#f8ece4', fg: '#c9603f' },
  { bg: '#e9edf2', fg: '#334155' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function monogramFromName(
  name: string | undefined,
  id: string,
): { bg: string; fg: string; mono: string } {
  const source = (name?.trim() || id).trim();
  const letterMatch = source.match(/[\p{L}\p{N}]/u);
  const mono = (letterMatch?.[0] ?? '?').toUpperCase();
  const palette = MONO_PALETTE[hashString(source.toLowerCase()) % MONO_PALETTE.length] ?? {
    bg: '#edf1f6',
    fg: '#64748b',
  };
  return { bg: palette.bg, fg: palette.fg, mono };
}

const BRANDS: Record<string, BrandEntry> = {
  openai: { Icon: OpenAI as BrandIcon, softBg: '#e8f8f0', softFg: '#10a37f' },
  'openai-codex': { Icon: Codex as BrandIcon, softBg: '#e8f8f0', softFg: '#10a37f' },
  codex: { Icon: Codex as BrandIcon, softBg: '#e8f8f0', softFg: '#10a37f' },
  anthropic: { Icon: Anthropic as BrandIcon, softBg: '#f8ece4', softFg: '#d97757' },
  claude: { Icon: Claude as BrandIcon, softBg: '#f8ece4', softFg: '#d97757' },
  gemini: { Icon: Gemini as BrandIcon, softBg: '#e8f0fe', softFg: '#4285f4' },
  'gemini-proxy': { Icon: Gemini as BrandIcon, softBg: '#e8f0fe', softFg: '#4285f4' },
  google: { Icon: Gemini as BrandIcon, softBg: '#e8f0fe', softFg: '#4285f4' },
  deepseek: { Icon: DeepSeek as BrandIcon, softBg: '#e8ecff', softFg: '#4d6bfe' },
  moonshot: { Icon: Moonshot as BrandIcon, softBg: '#edf1f6', softFg: '#16191d' },
  kimi: { Icon: Kimi as BrandIcon, softBg: '#eef4ff', softFg: '#2563eb' },
  'kimi-coding': { Icon: Kimi as BrandIcon, softBg: '#eef4ff', softFg: '#2563eb' },
  xai: { Icon: XAI as BrandIcon, softBg: '#f1f5f9', softFg: '#09090b' },
  grok: { Icon: Grok as BrandIcon, softBg: '#f1f5f9', softFg: '#09090b' },
  'github-copilot': { Icon: GithubCopilot as BrandIcon, softBg: '#f0f6ff', softFg: '#0969da' },
  copilot: { Icon: Copilot as BrandIcon, softBg: '#f0f6ff', softFg: '#0969da' },
  github: { Icon: Github as BrandIcon, softBg: '#f1f5f9', softFg: '#181717' },
  zhipu: { Icon: Zhipu as BrandIcon, softBg: '#e8f3ff', softFg: '#3859FF' },
  glm: { Icon: Zhipu as BrandIcon, softBg: '#e8f3ff', softFg: '#3859FF' },
  chatglm: { Icon: Zhipu as BrandIcon, softBg: '#e8f3ff', softFg: '#3859FF' },
  qwen: { Icon: Qwen as BrandIcon, softBg: '#eee9fe', softFg: '#6a4df4' },
  dashscope: { Icon: Qwen as BrandIcon, softBg: '#eee9fe', softFg: '#6a4df4' },
  tongyi: { Icon: Qwen as BrandIcon, softBg: '#eee9fe', softFg: '#6a4df4' },
  alibaba: { Icon: AlibabaCloud as BrandIcon, softBg: '#fff1e8', softFg: '#ff6a00' },
  alibabacloud: { Icon: AlibabaCloud as BrandIcon, softBg: '#fff1e8', softFg: '#ff6a00' },
  siliconflow: { Icon: SiliconCloud as BrandIcon, softBg: '#eef2ff', softFg: '#6366f1' },
  siliconcloud: { Icon: SiliconCloud as BrandIcon, softBg: '#eef2ff', softFg: '#6366f1' },
  silicon: { Icon: SiliconCloud as BrandIcon, softBg: '#eef2ff', softFg: '#6366f1' },
  'opencode-go': { Icon: OpenCode as BrandIcon, softBg: '#e8edf2', softFg: '#09090b' },
  opencode: { Icon: OpenCode as BrandIcon, softBg: '#e8edf2', softFg: '#09090b' },
  mimo: { Icon: XiaomiMiMo as BrandIcon, softBg: '#fff0e6', softFg: '#ff6700' },
  xiaomi: { Icon: XiaomiMiMo as BrandIcon, softBg: '#fff0e6', softFg: '#ff6700' },
  xiaomimimo: { Icon: XiaomiMiMo as BrandIcon, softBg: '#fff0e6', softFg: '#ff6700' },
  stepfun: { Icon: Stepfun as BrandIcon, softBg: '#e8f0fe', softFg: '#005aff' },
  step: { Icon: Stepfun as BrandIcon, softBg: '#e8f0fe', softFg: '#005aff' },
  volcengine: { Icon: Volcengine as BrandIcon, softBg: '#e8f1ff', softFg: '#1664ff' },
  'volcengine-ark': { Icon: Volcengine as BrandIcon, softBg: '#e8f1ff', softFg: '#1664ff' },
  ark: { Icon: Volcengine as BrandIcon, softBg: '#e8f1ff', softFg: '#1664ff' },
  doubao: { Icon: Doubao as BrandIcon, softBg: '#e8f7f0', softFg: '#00b42a' },
  bytedance: { Icon: ByteDance as BrandIcon, softBg: '#e8f1ff', softFg: '#1664ff' },
  groq: { Icon: Groq as BrandIcon, softBg: '#f3e8ff', softFg: '#f55036' },
  openrouter: { Icon: OpenRouter as BrandIcon, softBg: '#ebe4ff', softFg: '#6566f1' },
  ollama: { Icon: Ollama as BrandIcon, softBg: '#edf1f6', softFg: '#1a1a1a' },
  lmstudio: { Icon: LmStudio as BrandIcon, softBg: '#e8f0fe', softFg: '#3b82f6' },
  'lm-studio': { Icon: LmStudio as BrandIcon, softBg: '#e8f0fe', softFg: '#3b82f6' },
  azure: { Icon: Azure as BrandIcon, softBg: '#e8f0fe', softFg: '#0078d4' },
  'azure-openai': { Icon: AzureAI as BrandIcon, softBg: '#e8f0fe', softFg: '#0078d4' },
  azureai: { Icon: AzureAI as BrandIcon, softBg: '#e8f0fe', softFg: '#0078d4' },
};

/**
 * Words of an id: "openai/gpt-5.3-codex-spark" → openai, gpt, 5, 3, codex, spark.
 * Brand keywords match whole words or word prefixes, never the middle of a
 * word — plain substring matching read "sp·ark" as Volcengine Ark.
 */
function idWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Brand of a model id, if its words name a vendor. Exported for tests. */
export function resolveModelBrandKey(modelId: string): string | null {
  const words = idWords(modelId);
  // Prefix: "qwen3", "stepfun", "gpt5" still name their vendor.
  const has = (prefix: string): boolean => words.some((word) => word.startsWith(prefix));
  // Exact: short keywords that are also fragments of ordinary words.
  const is = (word: string): boolean => words.includes(word);

  if (has('grok')) return 'grok';
  if (has('gemini') || has('google')) return 'gemini';
  if (has('claude') || has('anthropic')) return 'claude';
  if (has('deepseek')) return 'deepseek';
  if (has('qwen') || has('dashscope') || has('tongyi')) return 'qwen';
  if (has('kimi')) return 'kimi';
  if (has('moonshot')) return 'moonshot';
  if (has('copilot')) return 'github-copilot';
  if (has('zhipu') || has('glm') || has('chatglm')) return 'zhipu';
  if (has('silicon')) return 'siliconflow';
  if (has('mimo')) return 'mimo';
  if (has('step')) return 'stepfun';
  if (has('doubao') || has('seedance') || has('seedream')) return 'doubao';
  if (has('volc') || is('ark')) return 'volcengine';
  if (has('opencode')) return 'opencode-go';
  if (has('groq')) return 'groq';
  if (has('ollama')) return 'ollama';
  if (has('lmstudio') || (is('lm') && is('studio'))) return 'lmstudio';
  if (has('codex')) return 'openai-codex';
  if (has('openai') || has('gpt') || has('chatgpt') || is('o1') || is('o3') || is('o4')) {
    return 'openai';
  }
  if (has('xai')) return 'xai';
  return null;
}

function resolveBrand(id: string, modelId?: string): BrandEntry | null {
  // A proxied model (gemini via a relay, grok via openrouter…) shows its own
  // vendor, so the model id is checked before the provider id.
  if (modelId) {
    const key = resolveModelBrandKey(modelId);
    const brand = key ? BRANDS[key] : undefined;
    if (brand) return brand;
  }

  const direct = BRANDS[id];
  if (direct) return direct;

  const lower = id.toLowerCase();

  // Protocol-style custom presets: custom-openai / custom-anthropic still
  // show the protocol brand mark (OAI protocol → OpenAI icon is correct).
  if (lower.includes('custom-anthropic') || lower === 'custom_anthropic') {
    return BRANDS.anthropic!;
  }
  if (
    lower.includes('custom-openai') ||
    lower === 'custom_openai' ||
    lower.includes('openai-compatible')
  ) {
    return BRANDS.openai!;
  }
  // Bare "custom" with no protocol hint → monogram.
  if (lower === 'custom') {
    return null;
  }

  // Specific before generic (azure-openai before openai).
  if (lower.includes('azure')) return BRANDS.azure!;
  if (lower.includes('openrouter')) return BRANDS.openrouter!;
  if (lower.includes('gemini') || lower.includes('google')) return BRANDS.gemini!;
  if (lower.includes('copilot')) return BRANDS['github-copilot'] ?? BRANDS.copilot!;
  if (lower.includes('grok')) return BRANDS.grok!;
  if (lower.includes('xai')) return BRANDS.xai!;
  if (lower.includes('claude')) return BRANDS.claude ?? BRANDS.anthropic!;
  if (lower.includes('anthropic')) return BRANDS.anthropic!;
  if (lower.includes('deepseek')) return BRANDS.deepseek!;
  if (lower.includes('silicon')) return BRANDS.siliconflow!;
  if (lower.includes('kimi')) return BRANDS.kimi!;
  if (lower.includes('moonshot')) return BRANDS.moonshot!;
  if (lower.includes('zhipu') || lower.includes('glm') || lower.includes('chatglm')) {
    return BRANDS.zhipu!;
  }
  if (
    lower.includes('qwen') ||
    lower.includes('dashscope') ||
    lower.includes('tongyi') ||
    lower.includes('alibaba')
  ) {
    return BRANDS.qwen!;
  }
  if (lower.includes('opencode')) return BRANDS['opencode-go'] ?? BRANDS.opencode!;
  if (lower.includes('mimo') || lower.includes('xiaomi')) return BRANDS.mimo!;
  if (lower.includes('stepfun') || lower.includes('step-') || lower === 'step') return BRANDS.stepfun!;
  if (lower.includes('doubao')) return BRANDS.doubao!;
  if (
    lower.includes('volcengine') ||
    lower.includes('volces') ||
    idWords(lower).includes('ark') ||
    lower.includes('bytedance')
  ) {
    return BRANDS.volcengine!;
  }
  if (lower.includes('groq')) return BRANDS.groq!;
  if (lower.includes('ollama')) return BRANDS.ollama!;
  if (lower.includes('lmstudio') || lower.includes('lm-studio')) return BRANDS.lmstudio!;
  if (lower.includes('codex')) return BRANDS['openai-codex'] ?? BRANDS.codex!;
  if (lower.includes('openai') || lower.includes('gpt')) return BRANDS.openai!;

  const keys = Object.keys(BRANDS).sort((a, b) => b.length - a.length);
  const words = idWords(lower);
  for (const key of keys) {
    // Short keys (ark, xai, glm) are fragments of ordinary words: whole word only.
    const matches = key.length <= 3 ? words.includes(key) : lower.includes(key);
    if (matches) return BRANDS[key]!;
  }
  return null;
}

/** Soft pastel tile with real brand SVG (or monogram fallback). */
export function ProviderIcon(props: ProviderIconProps): ReactElement {
  const size = props.size ?? 28;
  const brand = resolveBrand(props.id, props.modelId);
  const radius = props.radius ?? Math.max(8, Math.round(size * 0.29));
  const className = ['provider-icon', props.className].filter(Boolean).join(' ');

  if (props.variant === 'glyph') {
    const Glyph = brand ? (brand.Icon.Color ?? brand.Icon) : null;
    return (
      <span
        className={`${className} is-glyph`}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand ? (brand.Icon.title ?? 'brand') : 'mono'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        {Glyph ? (
          <Glyph size={size} style={{ display: 'block' }} />
        ) : (
          <span style={{ fontSize: Math.round(size * 0.78), fontWeight: 600, lineHeight: 1 }}>
            {monogramFromName(props.name, props.id).mono}
          </span>
        )}
      </span>
    );
  }

  // Prefer modelicons Avatar (official brand chip).
  if (brand?.Icon.Avatar) {
    const Avatar = brand.Icon.Avatar;
    return (
      <span
        className={className}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand.Icon.title ?? 'brand'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        <Avatar
          size={size}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            display: 'block',
          }}
        />
      </span>
    );
  }

  // Mono glyph on soft pastel when Avatar is missing.
  if (brand) {
    const Icon = brand.Icon;
    const glyph = Math.round(size * 0.58);
    return (
      <span
        className={className}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand.Icon.title ?? 'brand'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: radius,
          background: brand.softBg,
          color: brand.softFg,
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        <Icon size={glyph} style={{ display: 'block', color: brand.softFg }} />
      </span>
    );
  }

  // Custom / unknown → monogram from display name.
  const mono = monogramFromName(props.name, props.id);
  const monoSize = Math.round(size * 0.4);
  return (
    <span
      className={className}
      aria-hidden
      data-provider-icon={props.id}
      data-provider-brand="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        background: mono.bg,
        color: mono.fg,
        flexShrink: 0,
        userSelect: 'none',
        ...props.style,
      }}
    >
      <span
        style={{
          fontSize: monoSize,
          fontWeight: 700,
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {mono.mono}
      </span>
    </span>
  );
}
