import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderIcon, resolveModelBrandKey } from './provider-icons';

describe('ProviderIcon', () => {
  it('renders a real brand mark for known preset ids', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { id: 'openai', size: 24 }));
    expect(html).toContain('data-provider-icon="openai"');
    expect(html).toContain('data-provider-brand="OpenAI"');
    expect(html).toContain('<svg');
  });

  it('falls back for unknown ids without throwing', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { id: 'unknown-vendor' }));
    expect(html).toContain('data-provider-icon="unknown-vendor"');
    expect(html).toContain('data-provider-brand="mono"');
    expect(html).toContain('U');
  });

  it('uses display name monogram for custom providers', () => {
    const html = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-local', name: 'Cpa' }),
    );
    expect(html).toContain('C');
    expect(html).toContain('data-provider-brand="mono"');
  });

  it('shows OpenAI brand for custom-openai / OAI-compatible ids', () => {
    const html = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-openai', name: 'Cpa' }),
    );
    expect(html).toContain('data-provider-brand="OpenAI"');
    expect(html).toContain('<svg');
  });

  it('matches common name fragments with brand icons', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { id: 'my-deepseek-proxy' }));
    expect(html).toContain('data-provider-icon="my-deepseek-proxy"');
    expect(html).toContain('data-provider-brand="DeepSeek"');
    expect(html).toContain('<svg');
  });

  it('resolves qwen and azure aliases', () => {
    const qwen = renderToStaticMarkup(createElement(ProviderIcon, { id: 'dashscope-qwen' }));
    expect(qwen).toContain('data-provider-brand="Qwen"');
    const azure = renderToStaticMarkup(createElement(ProviderIcon, { id: 'azure-openai' }));
    expect(azure).toContain('data-provider-brand=');
    expect(azure).toContain('<svg');
  });

  it('resolves official brand icon from modelId when provider is custom/proxy', () => {
    const geminiProxy = renderToStaticMarkup(
      createElement(ProviderIcon, {
        id: 'cpa',
        name: 'Cpa',
        modelId: 'gemini-3.7-flash-high',
      }),
    );
    expect(geminiProxy).toContain('data-provider-brand="Gemini"');
    expect(geminiProxy).toContain('<svg');

    const claudeProxy = renderToStaticMarkup(
      createElement(ProviderIcon, {
        id: 'custom-relay',
        name: 'Relay',
        modelId: 'claude-3-7-sonnet-20250219',
      }),
    );
    expect(claudeProxy).toMatch(/data-provider-brand="(Anthropic|Claude)"/);

    const deepseekProxy = renderToStaticMarkup(
      createElement(ProviderIcon, {
        id: 'custom-relay',
        modelId: 'deepseek-reasoner',
      }),
    );
    expect(deepseekProxy).toContain('data-provider-brand="DeepSeek"');
  });

  it('resolves Zhipu brand icon for zhipu preset and glm models', () => {
    const zhipu = renderToStaticMarkup(createElement(ProviderIcon, { id: 'zhipu' }));
    expect(zhipu).toContain('data-provider-icon="zhipu"');
    expect(zhipu).toContain('data-provider-brand="Zhipu"');
    expect(zhipu).toContain('<svg');

    const glmProxy = renderToStaticMarkup(
      createElement(ProviderIcon, {
        id: 'custom-relay',
        modelId: 'glm-4-plus',
      }),
    );
    expect(glmProxy).toContain('data-provider-brand="Zhipu"');
  });

  it('resolves Grok brand icon and applies custom circular radius', () => {
    const grokIcon = renderToStaticMarkup(
      createElement(ProviderIcon, {
        id: 'xai',
        modelId: 'grok-4.5',
        size: 22,
        radius: '50%',
      }),
    );
    expect(grokIcon).toContain('data-provider-brand="Grok"');
    expect(grokIcon).toContain('border-radius:50%');
    expect(grokIcon).toContain('<svg');
  });

  it('resolves official brand icons for OAuth subscription providers', () => {
    const kimi = renderToStaticMarkup(createElement(ProviderIcon, { id: 'kimi-coding' }));
    expect(kimi).toContain('data-provider-icon="kimi-coding"');
    expect(kimi).toContain('data-provider-brand="Kimi"');
    expect(kimi).toContain('<svg');

    const codex = renderToStaticMarkup(createElement(ProviderIcon, { id: 'openai-codex' }));
    expect(codex).toContain('data-provider-icon="openai-codex"');
    expect(codex).toContain('data-provider-brand="Codex"');
    expect(codex).toContain('<svg');

    const claude = renderToStaticMarkup(createElement(ProviderIcon, { id: 'anthropic' }));
    expect(claude).toContain('data-provider-icon="anthropic"');
    expect(claude).toContain('data-provider-brand="Anthropic"');
    expect(claude).toContain('<svg');

    const xai = renderToStaticMarkup(createElement(ProviderIcon, { id: 'xai' }));
    expect(xai).toContain('data-provider-icon="xai"');
    expect(xai).toMatch(/data-provider-brand="(XAI|Grok)"/);
    expect(xai).toContain('<svg');

    const copilot = renderToStaticMarkup(createElement(ProviderIcon, { id: 'github-copilot' }));
    expect(copilot).toContain('data-provider-icon="github-copilot"');
    expect(copilot).toContain('data-provider-brand="GithubCopilot"');
    expect(copilot).toContain('<svg');
  });

  it('resolves official brand icons for new cloud providers: opencode-go, mimo, stepfun, volcengine', () => {
    const opencode = renderToStaticMarkup(createElement(ProviderIcon, { id: 'opencode-go' }));
    expect(opencode).toContain('data-provider-icon="opencode-go"');
    expect(opencode).toContain('data-provider-brand="opencode"');
    expect(opencode).toContain('<svg');

    const mimo = renderToStaticMarkup(createElement(ProviderIcon, { id: 'mimo' }));
    expect(mimo).toContain('data-provider-icon="mimo"');
    expect(mimo).toContain('data-provider-brand="XiaomiMiMo"');
    expect(mimo).toContain('<svg');

    const stepfun = renderToStaticMarkup(createElement(ProviderIcon, { id: 'stepfun' }));
    expect(stepfun).toContain('data-provider-icon="stepfun"');
    expect(stepfun).toContain('data-provider-brand="Stepfun"');
    expect(stepfun).toContain('<svg');

    const volcengine = renderToStaticMarkup(createElement(ProviderIcon, { id: 'volcengine' }));
    expect(volcengine).toContain('data-provider-icon="volcengine"');
    expect(volcengine).toContain('data-provider-brand="Volcengine"');
    expect(volcengine).toContain('<svg');

    const doubao = renderToStaticMarkup(createElement(ProviderIcon, { id: 'doubao' }));
    expect(doubao).toContain('data-provider-icon="doubao"');
    expect(doubao).toContain('data-provider-brand="Doubao"');
    expect(doubao).toContain('<svg');

    // Model ID based resolution
    const mimoModel = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-gateway', modelId: 'mimo-v2.5-pro' }),
    );
    expect(mimoModel).toContain('data-provider-brand="XiaomiMiMo"');

    const stepModel = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-gateway', modelId: 'step-3.7-flash' }),
    );
    expect(stepModel).toContain('data-provider-brand="Stepfun"');

    const doubaoModel = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-gateway', modelId: 'doubao-seed-2.1-pro' }),
    );
    expect(doubaoModel).toContain('data-provider-brand="Doubao"');

    const arkModel = renderToStaticMarkup(
      createElement(ProviderIcon, { id: 'custom-gateway', modelId: 'volcengine-ark-model' }),
    );
    expect(arkModel).toContain('data-provider-brand="Volcengine"');
  });

  it('matches model brands by whole words, not fragments of words', () => {
    // "spark" contains "ark" (Volcengine Ark) — it must not match.
    expect(resolveModelBrandKey('gpt-5.3-codex-spark')).toBe('openai-codex');
    expect(resolveModelBrandKey('spark-lite')).toBeNull();
    expect(resolveModelBrandKey('maxai-1')).toBeNull();
    // Word prefixes still count: versioned and fused names.
    expect(resolveModelBrandKey('qwen3-max')).toBe('qwen');
    expect(resolveModelBrandKey('stepfun/step-3')).toBe('stepfun');
    expect(resolveModelBrandKey('gpt5-mini')).toBe('openai');
    // Short keywords need the whole word.
    expect(resolveModelBrandKey('o3-mini')).toBe('openai');
    expect(resolveModelBrandKey('ark-endpoint-1')).toBe('volcengine');
    expect(resolveModelBrandKey('lm-studio-local')).toBe('lmstudio');
    expect(resolveModelBrandKey('google/gemini-3.8-pro')).toBe('gemini');
    expect(resolveModelBrandKey('deepseek/deepseek-v4-flash-0731:free')).toBe('deepseek');
  });

  it('keeps a provider id containing "ark" inside a word off Volcengine', () => {
    const html = renderToStaticMarkup(createElement(ProviderIcon, { id: 'spark-relay' }));
    expect(html).not.toContain('data-provider-brand="Volcengine"');
  });
});
