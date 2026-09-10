import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderIcon } from './provider-icons';

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
});
