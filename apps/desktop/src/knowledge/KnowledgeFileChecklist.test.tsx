// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeFileChecklist } from './KnowledgeFileChecklist.js';
import type { DocumentManifest, ScannedDocFile, ScannedFileV2 } from '@piwin/contracts';

describe('KnowledgeFileChecklist', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const files: ScannedDocFile[] = [
    { relativePath: 'a.md', sizeBytes: 10, language: 'markdown' },
    { relativePath: 'b.md', sizeBytes: 20, language: 'markdown' },
  ];
  const unsupported: ScannedFileV2[] = [
    {
      relativePath: 'scan.pdf',
      extension: '.pdf',
      sizeBytes: 100,
      support: 'unsupported',
      unsupportedReason: 'MINERU_NOT_CONFIGURED',
    },
  ];
  const documents: DocumentManifest[] = [
    {
      documentId: '1',
      folderKey: 'fk',
      relativePath: 'a.md',
      extension: '.md',
      fileSize: 10,
      fileHash: 'a',
      status: 'READY',
    },
  ];

  it('toggles a supported file and never checks unsupported', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeFileChecklist
            files={files}
            unsupported={unsupported}
            selected={['a.md', 'b.md']}
            documents={documents}
            disabled={false}
            onChange={onChange}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="file-ready-a.md"]')).not.toBeNull();
    expect(container.textContent).toContain('未配置 MinerU');
    const pdfBox = container.querySelector<HTMLInputElement>('input[data-path="scan.pdf"]');
    expect(pdfBox).toBeNull();
    const b = container.querySelector<HTMLInputElement>('input[data-path="b.md"]');
    expect(b?.checked).toBe(true);
    act(() => {
      b?.click();
    });
    expect(onChange).toHaveBeenCalledWith(['a.md']);
  });
});
