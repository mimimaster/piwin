/**
 * Vendor brand table + id → brand resolution for ProviderIcon.
 * Pure lookup: no rendering here, so the matching rules stay testable on their own.
 * Brand SVG assets load on demand via provider-brands-icons.
 */

import type { BrandEntry } from './provider-brands-icons.js';

export type { BrandEntry, BrandIcon } from './provider-brands-icons.js';

let brands: Record<string, BrandEntry> | null = null;
let brandsLoad: Promise<Record<string, BrandEntry>> | null = null;

/** Load modelicons brand marks once. Safe to call from many ProviderIcon mounts. */
export function loadProviderBrandIcons(): Promise<Record<string, BrandEntry>> {
  if (brands) return Promise.resolve(brands);
  if (!brandsLoad) {
    brandsLoad = import('./provider-brands-icons.js').then((module) => {
      brands = module.BRANDS;
      return brands;
    });
  }
  return brandsLoad;
}

export function areProviderBrandIconsReady(): boolean {
  return brands !== null;
}

/**
 * Words of an id: "openai/gpt-5.3-codex-spark" → openai, gpt, 5, 3, codex, spark.
 * Brand keywords match whole words or word prefixes, never the middle of a
 * word — plain substring matching read "sp·ark" as Volcengine Ark.
 */
function idWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Brand of a model id, if its words name a vendor. */
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
  if (has('minimax') || has('abab')) return 'minimax';
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

function resolveBrandFromMap(
  table: Record<string, BrandEntry>,
  id: string,
  modelId?: string,
): BrandEntry | null {
  // A proxied model (gemini via a relay, grok via openrouter…) shows its own
  // vendor, so the model id is checked before the provider id.
  if (modelId) {
    const key = resolveModelBrandKey(modelId);
    const brand = key ? table[key] : undefined;
    if (brand) return brand;
  }

  const direct = table[id];
  if (direct) return direct;

  const lower = id.toLowerCase();

  // Protocol-style custom presets: custom-openai / custom-anthropic still
  // show the protocol brand mark (OAI protocol → OpenAI icon is correct).
  if (lower.includes('custom-anthropic') || lower === 'custom_anthropic') {
    return table.anthropic ?? null;
  }
  if (
    lower.includes('custom-openai') ||
    lower === 'custom_openai' ||
    lower.includes('openai-compatible')
  ) {
    return table.openai ?? null;
  }
  // Bare "custom" with no protocol hint → monogram.
  if (lower === 'custom') {
    return null;
  }

  // Specific before generic (azure-openai before openai).
  if (lower.includes('azure')) return table.azure ?? null;
  if (lower.includes('openrouter')) return table.openrouter ?? null;
  if (lower.includes('gemini') || lower.includes('google')) return table.gemini ?? null;
  if (lower.includes('copilot')) return table['github-copilot'] ?? table.copilot ?? null;
  if (lower.includes('grok')) return table.grok ?? null;
  if (lower.includes('xai')) return table.xai ?? null;
  if (lower.includes('claude')) return table.claude ?? table.anthropic ?? null;
  if (lower.includes('anthropic')) return table.anthropic ?? null;
  if (lower.includes('deepseek')) return table.deepseek ?? null;
  if (lower.includes('silicon')) return table.siliconflow ?? null;
  if (lower.includes('kimi')) return table.kimi ?? null;
  if (lower.includes('moonshot')) return table.moonshot ?? null;
  if (lower.includes('minimax')) return table.minimax ?? null;
  if (lower.includes('zhipu') || lower.includes('glm') || lower.includes('chatglm')) {
    return table.zhipu ?? null;
  }
  if (
    lower.includes('qwen') ||
    lower.includes('dashscope') ||
    lower.includes('tongyi') ||
    lower.includes('alibaba')
  ) {
    return table.qwen ?? null;
  }
  if (lower.includes('opencode')) return table['opencode-go'] ?? table.opencode ?? null;
  if (lower.includes('mimo') || lower.includes('xiaomi')) return table.mimo ?? null;
  if (lower.includes('stepfun') || lower.includes('step-') || lower === 'step') return table.stepfun ?? null;
  if (lower.includes('doubao')) return table.doubao ?? null;
  if (
    lower.includes('volcengine') ||
    lower.includes('volces') ||
    idWords(lower).includes('ark') ||
    lower.includes('bytedance')
  ) {
    return table.volcengine ?? null;
  }
  if (lower.includes('groq')) return table.groq ?? null;
  if (lower.includes('ollama')) return table.ollama ?? null;
  if (lower.includes('lmstudio') || lower.includes('lm-studio')) return table.lmstudio ?? null;
  if (lower.includes('codex')) return table['openai-codex'] ?? table.codex ?? null;
  if (lower.includes('openai') || lower.includes('gpt')) return table.openai ?? null;

  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  const words = idWords(lower);
  for (const key of keys) {
    // Short keys (ark, xai, glm) are fragments of ordinary words: whole word only.
    const matches = key.length <= 3 ? words.includes(key) : lower.includes(key);
    if (matches) return table[key] ?? null;
  }
  return null;
}

/** Brand for a provider id (+ optional model id); null when nothing matches or icons are still loading. */
export function resolveBrand(id: string, modelId?: string): BrandEntry | null {
  if (!brands) {
    void loadProviderBrandIcons();
    return null;
  }
  return resolveBrandFromMap(brands, id, modelId);
}
