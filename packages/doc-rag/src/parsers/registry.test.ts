import { describe, expect, it } from 'vitest';
import { createParserRegistry } from './registry.js';

describe('parser registry', () => {
  it('marks pdf unsupported when MinerU is off', () => {
    const registry = createParserRegistry();
    const classified = registry.classify({ relativePath: 'notes.pdf', sizeBytes: 10 });
    expect(classified).toMatchObject({
      support: 'unsupported',
      unsupportedReason: 'MINERU_NOT_CONFIGURED',
    });
    expect(registry.getSupportedExtensions()).not.toContain('.pdf');
  });

  it('marks docx unsupported when Unstructured is off', () => {
    const registry = createParserRegistry();
    expect(registry.classify({ relativePath: 'a.docx', sizeBytes: 1 }).unsupportedReason).toBe(
      'UNSTRUCTURED_NOT_CONFIGURED',
    );
  });

  it('supports markdown and pdf when MinerU is enabled', () => {
    const registry = createParserRegistry({ mineruEnabled: true });
    expect(registry.classify({ relativePath: 'a.md', sizeBytes: 1 }).support).toBe('supported');
    expect(registry.classify({ relativePath: 'a.pdf', sizeBytes: 1 }).support).toBe('supported');
    expect(registry.getSupportedExtensions()).toContain('.pdf');
  });
});
