import { Suspense, useEffect, useRef, useState, type ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';
import type { HostAttachTarget } from '@piwin/contracts';
import type { AgentCliHost } from '../agents/agent-cli-pty.js';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { DeferredTuiPane } from '../conversation/deferred-desktop-surfaces.js';

export function useWorkbenchTui(input: {
  available: boolean;
  sessionId: string | null;
  scopeKey: string;
  hostKey?: string;
}) {
  // Shell selection is transient; an old preference cannot bypass rollout.
  const [selection, setSelection] = useState({ selected: false, retained: false });
  const previous = useRef(input);
  const adopting = useRef<string | null>(null);
  const adoption = input.sessionId === adopting.current && input.sessionId !== null;
  const contextChanged = previous.current.hostKey !== input.hostKey ||
    (previous.current.scopeKey !== input.scopeKey && !adoption) ||
    (previous.current.sessionId !== null && input.sessionId === null);
  const hiddenSessionChanged = !selection.selected && previous.current.sessionId !== input.sessionId && !adoption;
  useEffect(() => {
    // Session selection arrives before asynchronous workspace hydration. Keep
    // the announcement until that scope transition has actually committed.
    const adoption = input.sessionId === adopting.current && input.sessionId !== null;
    if (!input.available || contextChanged || hiddenSessionChanged) {
      setSelection({ selected: false, retained: false });
    }
    if ((adoption && previous.current.scopeKey !== input.scopeKey) || !input.available ||
      previous.current.hostKey !== input.hostKey || (adopting.current !== null && input.sessionId !== null && input.sessionId !== adopting.current)) adopting.current = null;
    previous.current = input;
  }, [input.available, input.scopeKey, input.hostKey, input.sessionId, contextChanged, hiddenSessionChanged]);
  return {
    active: input.available && !contextChanged && selection.selected,
    mounted: input.available && !contextChanged && !hiddenSessionChanged && selection.retained,
    open: () => { if (input.available) setSelection({ selected: true, retained: true }); },
    close: () => { setSelection((current) => ({ ...current, selected: false })); },
    reset: () => { adopting.current = null; setSelection({ selected: false, retained: false }); },
    adopt: (sessionId: string) => { if (input.sessionId === null) adopting.current = sessionId; },
  };
}

export function WorkbenchTuiStage(props: {
  sessionId: string | null;
  visible?: boolean | undefined;
  agentId?: string | undefined;
  hostClient?: AgentCliHost | undefined;
  projectPath: string | null;
  locale: DesktopLocale;
  remoteTarget?: HostAttachTarget | undefined;
  hostKey?: string | undefined;
  onSessionChange: (sessionId: string) => void;
  onOpenImage?: ((fileName: string) => void) | undefined;
}): ReactElement {
  return (
    <div className="conversation-tui-stage" hidden={props.visible === false} data-testid="conversation-tui-stage">
      <Suspense fallback={<div className="deferred-surface-fallback"><Spinner label={props.locale === 'zh-CN' ? '正在打开终端…' : 'Opening terminal…'} /></div>}>
        <DeferredTuiPane {...props} />
      </Suspense>
    </div>
  );
}
