import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_TEMPLATES,
  renderStatusLine,
  renderStatusTemplate,
  unknownStatusFields,
} from './status-template.js';

describe('renderStatusTemplate', () => {
  it('fills fields and drops pieces that are empty', () => {
    expect(
      renderStatusTemplate('{model} · {thinking} · {context}', { model: 'Grok 4.5', thinking: undefined, context: '上下文 4%' }),
    ).toBe('Grok 4.5 · 上下文 4%');
  });

  it('keeps literal text around a field and drops it with the field', () => {
    expect(renderStatusTemplate('[{project}] · {model}', { project: 'proj', model: 'm' })).toBe('[proj] · m');
    expect(renderStatusTemplate('[{project}] · {model}', { model: 'm' })).toBe('m');
  });

  it('keeps a piece that has text but no fields', () => {
    expect(renderStatusTemplate('piwin · {model}', { model: 'm' })).toBe('piwin · m');
  });

  it('groups with │ and drops an empty group with its divider', () => {
    expect(renderStatusTemplate('{model} │ {ttft} · {tps} │ {ctx}', { model: 'm', ctx: 'ctx 4%' })).toBe('m │ ctx 4%');
    expect(renderStatusTemplate('{model} │ {ttft}', { model: 'm', ttft: '首字 0.8s' })).toBe('m │ 首字 0.8s');
  });

  it('uses styled separators when given', () => {
    expect(renderStatusTemplate('{model} · {permission} │ {ctx}', { model: 'm', permission: 'YOLO', ctx: 'c' }, { piece: '.', group: '|' })).toBe('m.YOLO|c');
  });

  it('leaves an unknown field visible rather than hiding the mistake', () => {
    expect(renderStatusTemplate('{modle}', {})).toBe('{modle}');
    expect(unknownStatusFields('{modle} · {ttft}')).toEqual(['modle']);
  });
});

describe('renderStatusLine', () => {
  const values = {
    model: 'grok-4', thinking: '高', permission: 'YOLO', scheme: '编排 Ultra Code',
    elapsed: '上轮 18.4s', ttft: '首字 0.82s', tps: '86 tok/s',
    ctxbar: 'ctx ▰▰▰▱▱▱ 46% 92k/200k', ctx: 'ctx 46% 92k/200k', context: 'ctx 46%',
    tokens: '↑1.2M ↓38k', cache: '缓存 71%',
  };
  const measure = (text: string) => [...text].length;

  it('uses the full three-group line when wide', () => {
    expect(renderStatusLine({ templates: DEFAULT_STATUS_TEMPLATES, values, width: 160, measure })).toBe(
      'grok-4 · 高 · YOLO · 编排 Ultra Code │ 上轮 18.4s · 首字 0.82s · 86 tok/s │ ctx ▰▰▰▱▱▱ 46% 92k/200k · ↑1.2M ↓38k · 缓存 71%',
    );
  });

  it('drops resources first when the wide line does not fit', () => {
    const wide = (text: string) => measure(text) + 25;
    const line = renderStatusLine({ templates: DEFAULT_STATUS_TEMPLATES, values, width: 121, measure: wide });
    expect(line).not.toContain('缓存');
    expect(line).toContain('ctx ▰▰▰▱▱▱');
    expect(wide(line)).toBeLessThanOrEqual(121);
  });

  it('uses the medium and narrow tiers', () => {
    expect(renderStatusLine({ templates: DEFAULT_STATUS_TEMPLATES, values, width: 100, measure })).toBe(
      'grok-4 · 高 · YOLO · 编排 Ultra Code │ 首字 0.82s · 86 tok/s │ ctx 46% 92k/200k',
    );
    expect(renderStatusLine({ templates: DEFAULT_STATUS_TEMPLATES, values, width: 60, measure })).toBe('grok-4 · YOLO · ctx 46%');
  });

  it('never drops permission or context', () => {
    const line = renderStatusLine({ templates: DEFAULT_STATUS_TEMPLATES, values, width: 20, measure });
    expect(line).toContain('YOLO');
    expect(line).toContain('ctx 46%');
  });
});

describe('StatusLine', () => {
  it('draws alerts on their own line above a width-aware status line', async () => {
    const { StatusLine } = await import('./status-line.js');
    const line = new StatusLine();
    line.setContent({ alerts: ['⚠ 重连中…'], line: (width) => (width >= 80 ? 'wide' : 'narrow') });
    expect(line.render(100)).toEqual([expect.stringContaining('⚠ 重连中…'), expect.stringContaining('wide')]);
    expect(line.render(60)[1]).toContain('narrow');
    expect(line.getText()).toBe('⚠ 重连中… · narrow');
    line.setContent({ alerts: [], line: () => 'only' });
    expect(line.render(100)).toHaveLength(1);
  });
});
