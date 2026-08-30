// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { FlashcardDraftEditor } from './flashcard-draft-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FlashcardDraftEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('emits front/back/deck edits through the shared fields', () => {
    const onFrontChange = vi.fn();
    const onBackChange = vi.fn();
    const onDeckChange = vi.fn();
    const node: ReactElement = (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <FlashcardDraftEditor
          deckOptions={[
            { value: '生物', label: '生物' },
            { value: '细胞', label: '细胞' },
          ]}
          deck="生物"
          onDeckChange={onDeckChange}
          front="什么是「光合」？"
          onFrontChange={onFrontChange}
          back="短讲解"
          onBackChange={onBackChange}
          labels={{
            deck: '所属卡组',
            front: '正面（问题）',
            frontPlaceholder: '输入问题…',
            back: '背面（答案）',
            backPlaceholder: '输入答案与解析…',
          }}
        />
      </PiwinUiProvider>
    );
    act(() => {
      root.render(node);
    });
    const front = container.querySelector('[data-testid="flashcards-new-front"] textarea');
    const back = container.querySelector('[data-testid="flashcards-new-back"] textarea');
    expect(front).not.toBeNull();
    expect(back).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(front, 'Edited');
      front?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onFrontChange).toHaveBeenCalledWith('Edited', expect.anything());
  });
});
