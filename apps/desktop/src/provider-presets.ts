/**
 * Built-in provider catalog — interaction model from Cherry Studio ProviderList
 * (preset chips → add configured provider) and Open WebUI connection list.
 *
 * Presets are convenience only. Custom providers use one of the protocol adapters.
 */

export type ProviderProtocol =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'google-gemini';

export type ProviderPreset = {
  /** Stable preset key (not necessarily config id). */
  presetId: string;
  /** Default config id when adding. */
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKeyEnv: string;
  /** Suggested default models (first becomes default model). */
  models: Array<{ id: string; label?: string }>;
  /** Short badge in the preset grid. */
  badge: string;
  /** Group for UI sections. */
  group: 'cloud' | 'gateway' | 'local' | 'custom';
  docsHint?: string;
  icon?: string;
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    presetId: 'openai',
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
    badge: 'OA',
    group: 'cloud',
  },
  {
    presetId: 'anthropic',
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    ],
    badge: 'AN',
    group: 'cloud',
  },
  {
    presetId: 'gemini',
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
    badge: 'GM',
    group: 'cloud',
    docsHint: 'Google Generative Language API endpoint',
  },
  {
    presetId: 'gemini-proxy',
    id: 'gemini-proxy',
    name: 'Gemini (compatible proxy)',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    badge: 'GX',
    group: 'gateway',
    docsHint: 'Any OpenAI-compatible proxy that fronts Gemini models',
  },
  {
    presetId: 'openrouter',
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    models: [
      { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
    ],
    badge: 'OR',
    group: 'gateway',
    docsHint: 'OpenAI-compatible gateway',
  },
  {
    presetId: 'deepseek',
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    badge: 'DS',
    group: 'cloud',
  },
  {
    presetId: 'siliconflow',
    id: 'siliconflow',
    name: 'SiliconFlow',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    models: [{ id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' }],
    badge: 'SF',
    group: 'cloud',
  },
  {
    presetId: 'moonshot',
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: [{ id: 'kimi-k2-0711-preview', label: 'Kimi K2' }],
    badge: 'MS',
    group: 'cloud',
  },
  {
    presetId: 'zhipu',
    id: 'zhipu',
    name: 'Zhipu (GLM)',
    protocol: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    models: [{ id: 'glm-4.5', label: 'GLM-4.5' }],
    badge: 'ZP',
    group: 'cloud',
  },
  {
    presetId: 'groq',
    id: 'groq',
    name: 'Groq',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    models: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' }],
    badge: 'GQ',
    group: 'cloud',
  },
  {
    presetId: 'ollama',
    id: 'ollama',
    name: 'Ollama',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: '',
    models: [{ id: 'llama3.2', label: 'llama3.2' }],
    badge: 'OL',
    group: 'local',
    docsHint: 'Local OpenAI-compatible API (no key required)',
  },
  {
    presetId: 'lmstudio',
    id: 'lmstudio',
    name: 'LM Studio',
    protocol: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKeyEnv: '',
    models: [{ id: 'local-model', label: 'Local model' }],
    badge: 'LM',
    group: 'local',
  },
  {
    presetId: 'custom-openai',
    id: 'custom-openai',
    name: 'Custom (OpenAI-compatible)',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'CUSTOM_API_KEY',
    models: [],
    badge: '∞',
    group: 'custom',
  },
  {
    presetId: 'custom-anthropic',
    id: 'custom-anthropic',
    name: 'Custom (Anthropic-compatible)',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.example.com',
    apiKeyEnv: 'CUSTOM_ANTHROPIC_KEY',
    models: [],
    badge: '∞',
    group: 'custom',
  },
] as const;

export function getProviderPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.presetId === presetId);
}

export function presetsByGroup(): Record<ProviderPreset['group'], ProviderPreset[]> {
  const groups: Record<ProviderPreset['group'], ProviderPreset[]> = {
    cloud: [],
    gateway: [],
    local: [],
    custom: [],
  };
  for (const preset of PROVIDER_PRESETS) {
    groups[preset.group].push(preset);
  }
  return groups;
}

export const PROVIDER_GROUP_LABELS: Record<ProviderPreset['group'], string> = {
  cloud: 'Cloud',
  gateway: 'Gateways',
  local: 'Local',
  custom: 'Custom',
};
