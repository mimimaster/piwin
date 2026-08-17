// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeReadyView } from './KnowledgeReadyView.js';

describe('KnowledgeReadyView', () => {
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

  it('generates with the optional topic and shows no library button', () => {
    const onGenerate = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeReadyView
            folderName="Notes"
            topic="Architecture"
            onTopicChange={() => undefined}
            onGenerate={onGenerate}
            generateEnabled
            disabledReason={null}
            busy={false}
            retrievalLine={null}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).not.toContain('浏览卡片库');
    const generate = container.querySelector<HTMLButtonElement>('[data-testid="generate-cards-btn"]');
    expect(generate?.textContent).toContain('生成闪卡');
    act(() => {
      generate?.click();
    });
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
