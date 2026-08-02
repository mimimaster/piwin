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
});
