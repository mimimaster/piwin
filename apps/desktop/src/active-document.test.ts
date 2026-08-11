import { describe, expect, it } from 'vitest';
import {
  activeDocumentContent,
  isActiveDocumentCopyable,
  provenanceLabel,
  type ActiveDocument,
} from './active-document';

describe('active-document helpers', () => {
  it('exposes content only for ready docs', () => {
    const loading: ActiveDocument = {
      status: 'loading',
      requestId: 'r1',
      title: 'x',
      displayRef: 'skill:x',
    };
    expect(activeDocumentContent(loading)).toBeUndefined();
    expect(isActiveDocumentCopyable(loading)).toBe(false);

    const ready: ActiveDocument = {
      status: 'ready',
      requestId: 'r2',
      title: 'executing-plans',
      content: '# hi',
      displayRef: 'skill:executing-plans',
      provenance: 'current-resource',
    };
    expect(activeDocumentContent(ready)).toBe('# hi');
    expect(isActiveDocumentCopyable(ready)).toBe(true);
  });

  it('localizes provenance labels', () => {
    expect(provenanceLabel('current-resource', 'zh-CN')).toContain('当前安装');
    expect(provenanceLabel('tool-snapshot', 'en')).toContain('tool call');
  });
});
