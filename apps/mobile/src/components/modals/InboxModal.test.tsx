// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { InboxModal } from './InboxModal.js';
import { MOBILE_THEME } from '../../mobile-theme.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('InboxModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders Host-wide activity rows instead of the open chat run', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <InboxModal
            isOpen
            onClose={() => undefined}
            items={[
              {
                sessionId: 'sess-other',
                runId: 'run-other',
                status: 'running',
                pendingPermission: false,
              },
            ]}
            sessions={[{ sessionId: 'sess-other', name: '后台任务', scope: 'general' }]}
            isResolvingPermission={false}
            onResolvePermission={() => undefined}
            onAbortRun={() => undefined}
            onNavigateToSession={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('后台任务');
    expect(container.textContent).toContain('run-other');
    expect(container.textContent).not.toContain('暂无进行中的任务');
  });
});
