/**
 * The conversation in the terminal shell (`piwin tui --embedded`), ADR 0086.
 *
 * The pane owns no session state: the TUI is another shell on the same Host,
 * and the current view stays mounted across Desktop/CLI switches. It follows
 * Desktop’s active session by restarting on that session; with none, it starts a new
 * conversation in the active scope. When the TUI itself starts a conversation
 * it announces the session, Desktop opens that session, and the pane keeps the
 * running process instead of restarting it on the id it already shows.
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import type { HostAttachTarget } from '@piwin/contracts';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import type { DesktopLocale } from './desktop-locale';
import type { AgentCliHost } from './agent-cli-pty.js';
import { createAgentCliPty } from './agent-cli-pty.js';
import { isTauriPtyAvailable } from './tauri-pty';
import { XtermSurface, type PtyStatus } from './xterm-surface';

export type TuiPaneProps = {
  sessionId: string | null;
  visible?: boolean | undefined;
  agentId?: string | undefined;
  hostClient?: AgentCliHost | undefined;
  /** Project of the active scope: where a new conversation is created. */
  projectPath?: string | null;
  locale: DesktopLocale;
  remoteTarget?: HostAttachTarget | undefined;
  hostKey?: string | undefined;
  /** The terminal shell started or opened this session: make it the one Desktop shows. */
  onSessionChange?: (sessionId: string) => void;
  /** Show a file the agent's own TUI generated (native agent terminals only). */
  onOpenImage?: ((fileName: string) => void) | undefined;
};

type TuiPaneCopy = { unavailable: string; restart: string; exited: string };

const COPY: Record<'en' | 'zh', TuiPaneCopy> = {
  en: {
    unavailable: 'The terminal UI runs in the desktop app.',
    restart: 'Restart',
    exited: 'The terminal UI exited.',
  },
  zh: {
    unavailable: '终端界面需要在桌面应用里使用。',
    restart: '重新启动',
    exited: '终端界面已退出。',
  },
};

export function TuiPane(props: TuiPaneProps): ReactElement {
  const copy = props.locale === 'zh-CN' ? COPY.zh : COPY.en;
  const [status, setStatus] = useState<{ kind: PtyStatus; message?: string }>({ kind: 'idle' });
  /** Bumped to start a fresh process after an exit or a failed start. */
  const [generation, setGeneration] = useState(0);

  // The process is restarted when the session Desktop shows changes, except to
  // the one the TUI itself reported: it is already on it.
  const shown = useRef<{
    desired: string; hostKey: string; process: number; reported: string | null;
    remoteTarget: HostAttachTarget | undefined;
    sessionId: string | null; projectPath: string | null;
  }>({
    desired: '',
    hostKey: '',
    remoteTarget: props.remoteTarget,
    process: 0,
    reported: null,
    sessionId: props.sessionId,
    projectPath: props.projectPath ?? null,
  });
  const hostKey = props.hostKey ?? props.remoteTarget?.endpoint ?? 'local';
  const agentId = props.agentId ?? 'pi';
  const desired = `${agentId}:${hostKey}:${props.sessionId ?? `new:${props.projectPath ?? ''}`}`;
  if (shown.current.desired !== desired) {
    const followsTui = shown.current.hostKey === hostKey && props.sessionId !== null && props.sessionId === shown.current.reported;
    shown.current = {
      desired,
      hostKey,
      remoteTarget: followsTui ? shown.current.remoteTarget : props.remoteTarget,
      // A counter, not the session id: starting a new conversation after the
      // TUI adopted one must still replace the process.
      process: followsTui ? shown.current.process : shown.current.process + 1,
      reported: null,
      sessionId: followsTui ? shown.current.sessionId : props.sessionId,
      projectPath: followsTui ? shown.current.projectPath : props.projectPath ?? null,
    };
  }

  const onSessionRef = useRef(props.onSessionChange);
  onSessionRef.current = props.onSessionChange;
  const snapshot = shown.current;
  const agentPty = useMemo(() => {
    if (agentId === 'pi' || props.hostClient === undefined) return undefined;
    return createAgentCliPty(props.hostClient, {
      agentId,
      ...(snapshot.sessionId === null ? {} : { sessionId: snapshot.sessionId }),
      ...(snapshot.projectPath === null ? {} : { projectPath: snapshot.projectPath }),
    }, (sessionId) => {
      shown.current.reported = sessionId;
      onSessionRef.current?.(sessionId);
    });
  }, [agentId, props.hostClient, snapshot.process, generation]);

  if (!isTauriPtyAvailable() || (agentId !== 'pi' && agentPty === undefined)) {
    return <div className="muted terminal-empty">{copy.unavailable}</div>;
  }

  const stopped = status.kind === 'exited' || status.kind === 'error';
  return (
    <div className="tui-pane" data-testid="tui-pane" data-agent={agentId}>
      {stopped ? (
        <Notice tone={status.kind === 'error' ? 'error' : 'info'} testId="tui-pane-stopped">
          {status.kind === 'error' ? (status.message ?? copy.exited) : copy.exited}{' '}
          <Button
            type="button"
            data-testid="tui-pane-restart"
            onClick={() => {
              shown.current.sessionId = props.sessionId;
              shown.current.projectPath = props.projectPath ?? null;
              shown.current.reported = null;
              shown.current.remoteTarget = props.remoteTarget;
              setStatus({ kind: 'idle' });
              setGeneration((value) => value + 1);
            }}
          >
            {copy.restart}
          </Button>
        </Notice>
      ) : null}
      {status.kind === 'idle' || status.kind === 'starting' ? <div className="tui-pane-starting">
        <Spinner label={props.locale === 'zh-CN' ? '正在打开终端…' : 'Opening terminal…'} />
      </div> : null}
      <div className="tui-pane-surface">
        <XtermSurface
          key={`${shown.current.process}:${generation}`}
          cwd=""
          visible={props.visible}
          {...(shown.current.projectPath ? { projectPath: shown.current.projectPath } : {})}
          pty={agentPty}
          onOpenImage={agentPty === undefined ? undefined : props.onOpenImage}
          fullBleed={agentId !== 'pi'}
          tui={agentId === 'pi' ? {
            ...(shown.current.sessionId === null ? {} : { sessionId: shown.current.sessionId }),
            ...(shown.current.remoteTarget === undefined ? {} : { remoteTarget: shown.current.remoteTarget }),
          } : undefined}
          onTuiSession={(sessionId) => {
            shown.current.reported = sessionId;
            props.onSessionChange?.(sessionId);
          }}
          onStatus={(kind, _ptyId, message) => {
            setStatus(message === undefined ? { kind } : { kind, message });
          }}
        />
      </div>
    </div>
  );
}
