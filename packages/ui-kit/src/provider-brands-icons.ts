/**
 * modelicons brand table. Loaded on demand so the cold main chunk does not
 * parse every vendor SVG at startup.
 */
import type { CSSProperties, ComponentType } from 'react';
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
  Devin,
  Doubao,
  Gemini,
  Github,
  GithubCopilot,
  Grok,
  Groq,
  Kimi,
  LmStudio,
  Minimax,
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

type BrandMarkProps = { size?: number | string; style?: CSSProperties; className?: string };

export type BrandIcon = ComponentType<BrandMarkProps> & {
  Avatar?: ComponentType<BrandMarkProps>;
  Color?: ComponentType<BrandMarkProps>;
  colorPrimary?: string;
  title?: string;
};

export type BrandEntry = {
  Icon: BrandIcon;
  softBg: string;
  softFg: string;
};

export const BRANDS: Record<string, BrandEntry> = {
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
  minimax: { Icon: Minimax as BrandIcon, softBg: '#fdecef', softFg: '#f23f5d' },
  xai: { Icon: XAI as BrandIcon, softBg: '#f1f5f9', softFg: '#09090b' },
  grok: { Icon: Grok as BrandIcon, softBg: '#f1f5f9', softFg: '#09090b' },
  'github-copilot': { Icon: GithubCopilot as BrandIcon, softBg: '#f0f6ff', softFg: '#0969da' },
  devin: { Icon: Devin as BrandIcon, softBg: '#e8f1ff', softFg: Devin.colorPrimary || '#111111' },
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
