import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { SessionToolOutputData } from '@piwin/contracts';
import type { MobileToolCall } from '../../mobile-transcript.js';
import { projectToolRow } from './tool-row-view.js';

export type ToolOutputReader = (messageId: string, toolCallId: string) => Promise<SessionToolOutputData>;

type OutputState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; text: string; truncated: boolean }
  | { kind: 'empty'; reason: string };

/**
 * One node on the ink line. The collapsed head is Host presentation only; the
 * body fetches the bounded tool output on demand (`session/tool-output`),
 * because transcript hydration deliberately ships without output bodies.
 */
export function ToolRow({
  tool,
  messageId,
  readOutput,
  onOpenSession,
}: {
  tool: MobileToolCall;
  messageId: string;
  readOutput: ToolOutputReader;
  onOpenSession: (sessionId: string) => void;
}): ReactElement {
  const row = projectToolRow(tool);
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<OutputState>({ kind: 'idle' });
  const liveOutput = tool.output !== undefined && tool.output.length > 0 ? tool.output : undefined;
  const requestedRef = useRef(false);
  // Delegation rows show the task and Host run status; the raw control-tool
  // receipt (`subagent accepted (runId=…)`) is plumbing, not content.
  const showsOutput = row.subagent === undefined;

  useEffect(() => {
    if (!open || !showsOutput || liveOutput !== undefined || tool.status === 'running' || requestedRef.current) {
      return;
    }
    requestedRef.current = true;
    let cancelled = false;
    setOutput({ kind: 'loading' });
    readOutput(messageId, tool.id)
      .then((data) => {
        if (cancelled) return;
        if (data.status === 'ready' && data.output.trim().length > 0) {
          setOutput({ kind: 'ready', text: data.output, truncated: data.truncated });
        } else {
          setOutput({
            kind: 'empty',
            reason:
              data.status === 'ready'
                ? '工具没有输出。'
                : data.reason === 'not-readable-tool'
                  ? '此工具的输出不在 Host 快照中。'
                  : 'Host 没有保存这次输出。',
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOutput({ kind: 'empty', reason: error instanceof Error ? error.message : '读取输出失败。' });
        }
      });
    return () => {
      cancelled = true;
      // An unmounted/closed row may ask again next time it opens.
      requestedRef.current = false;
    };
  }, [open, showsOutput, liveOutput, tool.status, tool.id, messageId, readOutput]);

  const nodeClass =
    row.status === 'run' ? 'run' : row.status === 'fail' ? 'fail' : row.subagent !== undefined ? 'bg' : 'done';
  const subagent = row.subagent;
  const truncation = tool.presentation?.output?.truncation;

  return (
    <div className="tr-wrap">
      <span className={`node ${nodeClass}`} aria-hidden="true" />
      <button
        className="tr"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <b>{row.verb}</b>
        {row.question !== undefined ? (
          <span className="q">{row.question}</span>
        ) : row.arg !== undefined ? (
          <code>{row.arg}</code>
        ) : null}
        <span className="meta">
          {row.status === 'run' ? (
            <span className="run-m">
              <span className="grind" />
              运行中
            </span>
          ) : null}
          {row.meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
          {row.failure !== undefined && row.status === 'fail' ? <span className="bad">失败</span> : null}
        </span>
      </button>
      {open ? (
        <div className="tr-body">
          {subagent !== undefined ? (
            <SubagentDetail view={subagent} onOpenSession={onOpenSession} />
          ) : null}
          {row.command !== undefined ? <pre className="cmd">$ {row.command}</pre> : null}
          {row.targetPaths.length > 0 && row.command === undefined ? (
            <div className="tr-paths">
              {row.targetPaths.map((path) => (
                <code key={path}>{path}</code>
              ))}
            </div>
          ) : null}
          {row.changedPaths.length > 0 ? (
            <div className="tr-note">已写入 {row.changedPaths.length} 个文件</div>
          ) : null}
          {row.failure !== undefined ? <div className="tr-err">{row.failure}</div> : null}
          {!showsOutput ? null : liveOutput !== undefined ? (
            <pre>{liveOutput}</pre>
          ) : output.kind === 'loading' ? (
            <div className="tr-note">正在向 Host 读取输出…</div>
          ) : output.kind === 'ready' ? (
            <>
              <pre>{output.text}</pre>
              {output.truncated ? <div className="tr-note">输出较长，已截断显示。</div> : null}
            </>
          ) : output.kind === 'empty' ? (
            <div className="tr-note">{output.reason}</div>
          ) : tool.status === 'running' ? (
            <div className="tr-note">工具仍在运行…</div>
          ) : null}
          {truncation?.totalLines !== undefined ? (
            <div className="tr-note">共 {truncation.totalLines} 行</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SubagentDetail({
  view,
  onOpenSession,
}: {
  view: NonNullable<ReturnType<typeof projectToolRow>['subagent']>;
  onOpenSession: (sessionId: string) => void;
}): ReactElement {
  return (
    <>
      {view.task !== undefined ? (
        <>
          <div className="tr-label">任务</div>
          <p className="tr-task">{view.task}</p>
        </>
      ) : null}
      {view.runs.length > 0 ? (
        <ul className="tr-runs">
          {view.runs.map((run) => (
            <li key={run.runId}>
              <span className={`node-inline ${run.status}`} aria-hidden="true" />
              <span className="grow">
                <strong>{run.title}</strong>
                {run.activity !== undefined ? <small>{run.activity}</small> : null}
              </span>
              <em>{run.statusLabel}</em>
              {run.childSessionId !== undefined ? (
                <button type="button" className="chip" onClick={() => onOpenSession(run.childSessionId ?? '')}>
                  打开
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {view.childSessionId !== undefined ? (
        <button type="button" className="chip" onClick={() => onOpenSession(view.childSessionId ?? '')}>
          打开子会话
        </button>
      ) : null}
    </>
  );
}
