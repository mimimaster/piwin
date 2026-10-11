import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUS_TEMPLATE, renderStatusTemplate, unknownStatusFields } from './status-template.js';

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

  it('renders the default template like the built-in line', () => {
    expect(
      renderStatusTemplate(DEFAULT_STATUS_TEMPLATE, { session: '会话', project: 'proj', model: 'Grok', context: '上下文 4%' }),
    ).toBe('会话 · proj · Grok · 上下文 4%');
  });

  it('leaves an unknown field visible rather than hiding the mistake', () => {
    expect(renderStatusTemplate('{modle}', {})).toBe('{modle}');
  });
});

describe('unknownStatusFields', () => {
  it('names the fields a template misspells', () => {
    expect(unknownStatusFields('{model} · {modle} · {cost}')).toEqual(['modle', 'cost']);
    expect(unknownStatusFields(DEFAULT_STATUS_TEMPLATE)).toEqual([]);
  });
});
