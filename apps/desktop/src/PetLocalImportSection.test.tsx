// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PetLocalImportPreview } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PetLocalImportSection } from './PetLocalImportSection';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function renderSection(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

const preview: PetLocalImportPreview = {
  sourcePath: '/Users/test/.codex/pets',
  candidates: [
    {
      sourcePath: '/Users/test/.codex/pets/alpha',
      petId: 'alpha',
      displayName: 'Alpha',
      valid: true,
      issues: [],
    },
    {
      sourcePath: '/Users/test/.codex/pets/broken',
      displayName: 'Broken',
      valid: false,
      issues: ['missing spritesheet: sheet.webp'],
    },
    {
      sourcePath: '/Users/test/.codex/pets/beta',
      petId: 'beta',
      displayName: 'Beta',
      valid: true,
      issues: [],
    },
  ],
};

describe('PetLocalImportSection', () => {
  afterEach(() => {
    document.body.replaceChildren();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders valid and invalid candidates and delegates select-all', () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const onToggleAll = vi.fn();
    const { container, root } = renderSection(
      <PetLocalImportSection
        isChinese
        installPath="/Users/test/.codex/pets"
        preview={preview}
        selectedPaths={[]}
        busy={false}
        onPathChange={vi.fn()}
        onScan={vi.fn()}
        onInstallDirect={vi.fn()}
        onTogglePath={vi.fn()}
        onToggleAll={onToggleAll}
        onInstallBatch={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('[data-testid="pet-local-candidate"]')).toHaveLength(3);
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="pet-local-candidate"]:disabled'),
    ).not.toBeNull();
    const batchButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pet-local-batch-install"]',
    );
    expect(batchButton?.disabled).toBe(true);

    act(() => {
      container.querySelector<HTMLInputElement>('[data-testid="pet-local-select-all"]')?.click();
    });
    expect(onToggleAll).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
