import { useState, type ReactElement, type ReactNode } from 'react';
import type { TurnChangeSummary, WalkthroughArtifact } from '@piwin/contracts';
import { ProviderIcon } from '@piwin/ui-kit';
import { Icon } from '../icons.js';
import { IconButton } from '../inkstone-ui.js';
import { formatClock } from '../host/host-bridge.js';
import { ToolRow, type ToolOutputReader } from './ToolRow.js';
import { WalkthroughCard } from './WalkthroughCard.js';
import { TurnProse } from './TurnProse.js';
import { describeTurnState, describeWork, type TurnView, type WorkStep } from './turn-model.js';
import { partitionHealthSteps } from './health-steps.js';
import { HealthToolCard } from '../../health/HealthToolCard.js';

const THINK_CLAMP_CHARS = 180;

export function TurnBlock({
  turn,
  modelLabel,
  readOutput,
  inlineGate,
  changes,
  showActions,
  onCopy,
  onOpenSession,
  onOpenChanges,
  walkthrough,
  onGenerateWalkthrough,
  onRetry,
  retryConfirmFiles,
  onCancelRetry,
}: {
  turn: TurnView;
  modelLabel: string;
  readOutput: ToolOutputReader;
  /** Permission seal or question card for the live turn, drawn on its ink line. */
  inlineGate: ReactNode;
  changes: TurnChangeSummary | undefined;
  showActions: boolean;
  onCopy: (text: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenChanges: () => void;
  walkthrough: WalkthroughArtifact | undefined;
  /** Present only when the Host can generate a report for this finished turn. */
  onGenerateWalkthrough: (() => void) | undefined;
  /** Re-run this turn's user row; undefined when the turn cannot be retried. */
  onRetry: ((options: { keepPrevious: boolean; confirm: boolean }) => void) | undefined;
  /** Files the Host says a retry would discard; asks before retrying again. */
  retryConfirmFiles: string[] | undefined;
  onCancelRetry: () => void;
}): ReactElement {
  const running = turn.status === 'running';
  const waiting = inlineGate !== null && inlineGate !== undefined && inlineGate !== false;
  const [userOpen, setUserOpen] = useState<boolean | undefined>();
  // Live work stays open so the chain is watchable; finished work folds away
  // unless the reader opened it.
  const open = userOpen ?? (running || waiting);
  const { health, work } = partitionHealthSteps(turn.steps);
  const workTurn: TurnView = health.length === 0 ? turn : { ...turn, steps: work };
  const hasWork = workTurn.steps.length > 0 || waiting;
  const workSummary = describeWork(workTurn);

  return (
    <section className="turn" aria-label="助手回合">
      <div className="message-head">
        {turn.model !== undefined ? (
          <ProviderIcon
            id={turn.model.providerId}
            modelId={turn.model.modelId}
            name={modelLabel}
            size={22}
            radius="50%"
            className="avatar-brand"
          />
        ) : (
          <span className="avatar">π</span>
        )}
        <span className="model-label">{modelLabel}</span>
        {turn.createdAt.length > 0 ? <time>{formatClock(turn.createdAt)}</time> : null}
      </div>
      {hasWork ? (
        <div className="work">
          <button
            className={`work-h ${turn.status === 'failed' ? 'failed' : ''}`.trim()}
            type="button"
            aria-expanded={open}
            onClick={() => setUserOpen(!open)}
          >
            {waiting ? <span className="sq" /> : running ? <span className="lamp" /> : <Icon name="bulb" />}
            <b>{waiting ? '等你决定' : describeTurnState(turn)}</b>
            {workSummary.length > 0 ? <span className="work-sub">· {workSummary}</span> : null}
            <Icon name="chevd" extra="chev" />
          </button>
          {open ? (
            <div className="work-body thread">
              {workTurn.steps.map((step) => (
                <WorkStepView key={step.id} step={step} readOutput={readOutput} onOpenSession={onOpenSession} />
              ))}
              {inlineGate}
            </div>
          ) : null}
        </div>
      ) : running ? (
        <div className="work">
          <div className="work-h" aria-live="polite">
            <span className="lamp" />
            <b>{describeTurnState(turn)}</b>
          </div>
        </div>
      ) : null}
      {health.length > 0 ? (
        <div className="health-sources">
          {health.map((step) => (
            <HealthToolCard
              key={step.id}
              {...(step.tool.presentation === undefined ? {} : { presentation: step.tool.presentation })}
              toolStatus={step.tool.status}
            />
          ))}
        </div>
      ) : null}
      {turn.prose !== undefined ? (
        <div className="assistant-prose">
          <TurnProse text={turn.prose.text} streaming={turn.prose.streaming} />
        </div>
      ) : null}
      {turn.changedPaths.length > 0 ? <ChangeStrip paths={turn.changedPaths} changes={changes} onOpenChanges={onOpenChanges} /> : null}
      {walkthrough !== undefined ? <WalkthroughCard artifact={walkthrough} /> : null}
      {turn.status === 'failed' || turn.status === 'cancelled' ? (
        <div className={`turn-terminal ${turn.status}`}>
          <Icon name={turn.status === 'failed' ? 'alert' : 'stop'} />
          <span className="grow">
            {turn.terminalMessage ?? (turn.status === 'failed' ? '这一轮没有完成。' : '已按你的要求停止。')}
          </span>
          {onRetry !== undefined ? (
            <button className="chip" type="button" onClick={() => onRetry({ keepPrevious: false, confirm: false })}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      {retryConfirmFiles !== undefined && onRetry !== undefined ? (
        <div className="retry-confirm" role="alertdialog" aria-label="确认重试">
          <p>
            重来会撤掉这一轮写过的 {retryConfirmFiles.length} 个文件
            {retryConfirmFiles.length > 0 ? `（${retryConfirmFiles.slice(0, 3).join('、')}${retryConfirmFiles.length > 3 ? '…' : ''}）` : ''}。
          </p>
          <div className="gate-row">
            <button className="text-link" type="button" onClick={onCancelRetry}>
              取消
            </button>
            <button className="chip danger" type="button" onClick={() => onRetry({ keepPrevious: false, confirm: true })}>
              仍要重来
            </button>
          </div>
        </div>
      ) : null}
      {showActions && turn.prose !== undefined && turn.prose.text.length > 0 ? (
        <div className="message-actions">
          <IconButton name="copy" label="复制回复" onClick={() => onCopy(turn.prose?.text ?? '')} />
          {onRetry !== undefined ? (
            <button className="chip" type="button" onClick={() => onRetry({ keepPrevious: true, confirm: false })}>
              换个回答
            </button>
          ) : null}
          {walkthrough === undefined && onGenerateWalkthrough !== undefined ? (
            <button className="chip" type="button" onClick={onGenerateWalkthrough}>
              生成走查报告
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function WorkStepView({
  step,
  readOutput,
  onOpenSession,
}: {
  step: WorkStep;
  readOutput: ToolOutputReader;
  onOpenSession: (sessionId: string) => void;
}): ReactElement {
  if (step.kind === 'tool') {
    return (
      <ToolRow tool={step.tool} messageId={step.messageId} readOutput={readOutput} onOpenSession={onOpenSession} />
    );
  }
  if (step.kind === 'narration') {
    return <p className="narr">{step.text}</p>;
  }
  if (step.kind === 'intervention') {
    return (
      <div className="interject">
        <span className="interject-tag">{step.applied ? '已插话' : '插话'}</span>
        <span>{step.text}</span>
      </div>
    );
  }
  return <ThinkingNote text={step.text} streaming={step.streaming} />;
}

function ThinkingNote({ text, streaming }: { text: string; streaming: boolean }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > THINK_CLAMP_CHARS;
  const clamped = long && !expanded && !streaming;
  return (
    <>
      <div className={`think ${clamped ? 'clamped' : ''} ${streaming ? 'live' : ''}`.trim()}>
        <span>{text}</span>
      </div>
      {long && !streaming ? (
        <button className="think-toggle" type="button" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起思考' : '展开思考'}
        </button>
      ) : null}
    </>
  );
}

function ChangeStrip({
  paths,
  changes,
  onOpenChanges,
}: {
  paths: string[];
  changes: TurnChangeSummary | undefined;
  onOpenChanges: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const count = changes?.fileCount ?? paths.length;
  return (
    <div className="fcb" role="group" aria-label="本轮变更">
      <button className="fcb-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="git" />
        {count} 个文件已修改
        {changes?.additions !== null && changes?.additions !== undefined ? (
          <span className="pm">
            <span className="plus">+{changes.additions}</span>{' '}
            <span className="minus">−{changes.deletions ?? 0}</span>
          </span>
        ) : null}
        <Icon name="chevd" extra="chev" />
      </button>
      <button className="chip" type="button" onClick={onOpenChanges}>
        查看差异
      </button>
      {open ? (
        <span className="fcb-files">
          {paths.map((path) => (
            <code key={path}>{path}</code>
          ))}
        </span>
      ) : null}
    </div>
  );
}
