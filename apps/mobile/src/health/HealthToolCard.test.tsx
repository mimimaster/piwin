import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HealthToolCard } from './HealthToolCard.js';

describe('HealthToolCard', () => {
  it('renders typed health presentation without raw JSON', () => {
    const html = renderToStaticMarkup(
      <HealthToolCard
        presentation={{
          kind: 'health',
          title: '读取 Apple Health',
          summary: '近 7 天：睡眠、步数',
          health: {
            metrics: ['steps', 'sleep-duration'],
            periodLabel: '近 7 天',
            status: 'completed',
            freshnessLabel: '08:42',
            timezone: 'Asia/Shanghai',
          },
        }}
      />,
    );
    expect(html).toContain('读取 Apple Health');
    expect(html).toContain('已完成');
    expect(html).not.toContain('schemaVersion');
  });

  it('defaults a health card without status to waiting-for-phone, never completed', () => {
    const html = renderToStaticMarkup(
      <HealthToolCard
        presentation={{
          kind: 'health',
          title: '读取 Apple Health',
        }}
      />,
    );
    expect(html).toContain('等待 iPhone');
    expect(html).not.toContain('已完成');
  });

  it('maps a running tool without health.status to waiting-for-phone', () => {
    const html = renderToStaticMarkup(
      <HealthToolCard
        presentation={{ kind: 'health', title: '读取 Apple Health' }}
        toolStatus="running"
      />,
    );
    expect(html).toContain('等待 iPhone');
    expect(html).not.toContain('已完成');
  });
});
