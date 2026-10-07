/**
 * Segment layer of the 已工作 fold. One segment = one narration + the tools
 * that follow it:
 *
 *   prose   the narration, always visible (it is the model talking, not work)
 *   header  「已执行 52m · 74 个工具 · 18 个文件 · 2 次失败」 — the turn fold's own
 *           header, same trailing counts, with the run glyph; while the
 *           segment runs it reads 「执行中 · <tool> <target>」 and rotates
 *           through the tools in flight
 *   body    the tool rows, mounted only while open; its spine and foot bar
 *           collapse the segment from wherever the reader has scrolled to
 */
import type { ReactElement, ReactNode } from 'react';
import { memo, useCallback, useRef } from 'react';
import { Button } from '@piwin/ui-kit';
import { ActionMarquee } from './action-marquee.js';
import { useTranscriptScrollPort } from './transcript-scroll-port.js';
import { collapseFoldWithAnchor } from './work-fold-anchor.js';
import { useRotatingIndex } from './use-rotating-index.js';
import { formatWorkDuration, WorkFoldHeader } from './work-fold-header.js';
import type { TurnWorkSegment, TurnWorkSegmentLiveAction } from './turn-work-segments.js';
import type { TurnWorkSegmentPlan } from './turn-work-segment-plan.js';

type Locale = 'zh-CN' | 'en';

/** A body this long earns a collapse bar at its foot. */
export const SEGMENT_FOOT_BAR_MIN_TOOLS = 8;

export function segmentFoldId(segment: Pick<TurnWorkSegment, 'id'>): string {
  return `segment:${segment.id}`;
}

function RunningSegmentLabel(props: {
  actions: readonly TurnWorkSegmentLiveAction[];
  locale: Locale;
}): ReactElement {
  const index = useRotatingIndex(props.actions.length);
  const action = props.actions[index];
  const text = action ? [action.toolName, action.target].filter(Boolean).join(' ') : '';
  return (
    <>
      <b>{props.locale === 'zh-CN' ? '执行中' : 'Executing'}</b>
      {text ? (
        <>
          <span className="work-fold-sep"> · </span>
          <ActionMarquee className="work-fold-live-act" activeText={text} />
        </>
      ) : null}
    </>
  );
}

export type TurnWorkSegmentBlockProps = {
  segment: TurnWorkSegment;
  open: boolean;
  locale: Locale;
  /** Shared by every segment of the transcript, so its identity is stable. */
  onToggle: (segmentId: string, currentlyOpen: boolean) => void;
  /** Narration rows: shown whether or not the segment is open. */
  prose?: ReactNode;
  /** What the running segment's tools are doing right now (collapsed header). */
  liveActions?: readonly TurnWorkSegmentLiveAction[];
  /** The segment's tool rows. Only called for an open segment. */
  children?: ReactNode;
  /** Set on the last segment: closes the turn fold's region for the rail. */
  turnFoldEndId?: string;
};

type TurnWorkSegmentHeaderProps = {
  segmentId: string;
  title: string;
  running: boolean;
  open: boolean;
  locale: Locale;
  onToggle: (segmentId: string, currentlyOpen: boolean) => void;
  toolCount: number;
  fileCount: number;
  failureCount: number;
  elapsedMs: number | undefined;
  startedAt: number | undefined;
  liveActions: readonly TurnWorkSegmentLiveAction[];
};

function areLiveActionsEqual(
  left: readonly TurnWorkSegmentLiveAction[],
  right: readonly TurnWorkSegmentLiveAction[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every(
    (action, index) =>
      action.toolName === right[index]?.toolName && action.target === right[index]?.target,
  );
}

/**
 * The header takes the segment as plain values. A turn rebuilds its segment
 * plan on every token, so each of the (up to 40) mounted segments got a new
 * `segment` object and re-rendered its header, glyph and counts for a token
 * that only reached the last one.
 */
const TurnWorkSegmentHeader = memo(
  function TurnWorkSegmentHeader(props: TurnWorkSegmentHeaderProps): ReactElement {
    const { running, open, locale, segmentId } = props;
    const onToggleSegment = props.onToggle;
    const onToggle = useCallback(
      () => onToggleSegment(segmentId, open),
      [onToggleSegment, segmentId, open],
    );
    const zh = locale === 'zh-CN';
    const meta = [
      zh ? `${props.toolCount} 个工具` : `${props.toolCount} tool${props.toolCount === 1 ? '' : 's'}`,
      props.elapsedMs !== undefined ? formatWorkDuration(props.elapsedMs, locale, 'executed') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <WorkFoldHeader
        state={running ? 'running' : 'done'}
        locale={locale}
        open={open}
        onToggle={onToggle}
        className="turn-work-disclosure-trigger turn-work-segment-header"
        testId="turn-work-segment-header"
        doneIcon="run"
        verb="executed"
        failureCount={props.failureCount}
        dataAttributes={{
          'data-fold-header': `segment:${segmentId}`,
          'data-fold-open': open ? 'true' : 'false',
          'data-fold-level': 'segment',
          'data-fold-title': props.title,
          'data-fold-meta': meta,
        }}
        {...(running
          ? props.startedAt !== undefined
            ? { runningSince: props.startedAt }
            : {}
          : {
              ...(props.elapsedMs !== undefined ? { elapsedMs: props.elapsedMs } : {}),
              toolCount: props.toolCount,
              fileCount: props.fileCount,
            })}
      >
        {running ? <RunningSegmentLabel actions={props.liveActions} locale={locale} /> : undefined}
      </WorkFoldHeader>
    );
  },
  (previous, next) =>
    previous.segmentId === next.segmentId &&
    previous.title === next.title &&
    previous.running === next.running &&
    previous.open === next.open &&
    previous.locale === next.locale &&
    previous.onToggle === next.onToggle &&
    previous.toolCount === next.toolCount &&
    previous.fileCount === next.fileCount &&
    previous.failureCount === next.failureCount &&
    previous.elapsedMs === next.elapsedMs &&
    previous.startedAt === next.startedAt &&
    areLiveActionsEqual(previous.liveActions, next.liveActions),
);

const NO_LIVE_ACTIONS: readonly TurnWorkSegmentLiveAction[] = [];

export function TurnWorkSegmentBlock(props: TurnWorkSegmentBlockProps): ReactElement {
  const { segment, open, locale } = props;
  const zh = locale === 'zh-CN';
  const port = useTranscriptScrollPort();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const foldId = segmentFoldId(segment);
  const { summary } = segment;
  const running = segment.running;

  const collapse = (): void => {
    const container = port?.scrollElementRef.current;
    const header = rootRef.current?.querySelector<HTMLElement>('[data-fold-header]');
    if (!container || !header) {
      props.onToggle(segment.id, open);
      return;
    }
    collapseFoldWithAnchor(container, header, {
      beginProgrammaticScroll: port?.beginProgrammaticScroll ?? (() => {}),
    });
  };

  return (
    <div
      ref={rootRef}
      className={`turn-work-segment${open ? ' is-open' : ''}${running ? ' is-running' : ''}${
        summary.failureCount > 0 ? ' has-failure' : ''
      }`}
      data-testid="turn-work-segment"
      data-segment-id={segment.id}
      data-open={open ? 'true' : 'false'}
    >
      {props.prose}
      <TurnWorkSegmentHeader
        segmentId={segment.id}
        title={segment.title ?? ''}
        running={running}
        open={open}
        locale={locale}
        onToggle={props.onToggle}
        toolCount={summary.toolCount}
        fileCount={summary.fileCount}
        failureCount={summary.failureCount}
        elapsedMs={summary.elapsedMs}
        startedAt={summary.startedAt}
        liveActions={props.liveActions ?? NO_LIVE_ACTIONS}
      />
      {open ? (
        <div className="turn-work-segment-body">
          <button
            type="button"
            className="turn-work-segment-guide"
            data-testid="turn-work-segment-guide"
            aria-label={zh ? '收起这一步的工具' : 'Collapse this step'}
            title={zh ? '收起' : 'Collapse'}
            onClick={collapse}
          />
          {props.children}
          {summary.toolCount >= SEGMENT_FOOT_BAR_MIN_TOOLS ? (
            <Button
              variant="ghost"
              size="compact"
              className="turn-work-segment-foot"
              data-testid="turn-work-segment-foot"
              onClick={collapse}
            >
              {zh ? `收起 · ${summary.toolCount} 个工具` : `Collapse · ${summary.toolCount} tools`}
            </Button>
          ) : null}
        </div>
      ) : null}
      <span data-fold-end={foldId} aria-hidden="true" className="fold-end-marker" />
      {props.turnFoldEndId !== undefined ? (
        <span
          data-fold-end={props.turnFoldEndId}
          aria-hidden="true"
          className="fold-end-marker"
        />
      ) : null}
    </div>
  );
}

/**
 * Replace each visible segment's reserved slot in the turn's row list with its
 * block, now that the rows for open segments have been collected.
 */
export function mountTurnWorkSegmentBlocks(
  items: ReactElement[],
  plan: TurnWorkSegmentPlan,
  options: {
    locale: Locale;
    onToggle: (segmentId: string, currentlyOpen: boolean) => void;
    liveActionsFor: (segment: TurnWorkSegment) => readonly TurnWorkSegmentLiveAction[];
    /** Fold id of the turn-level fold whose region ends with the last segment. */
    turnFoldEndId?: string;
  },
): void {
  const lastSegment = plan.segments[plan.segments.length - 1];
  for (const segment of plan.segments) {
    const slot = plan.slots.get(segment.id);
    if (slot === undefined) continue;
    const open = plan.isOpen(segment);
    items[slot.at] = (
      <TurnWorkSegmentBlock
        key={segment.id}
        segment={segment}
        open={open}
        locale={options.locale}
        onToggle={options.onToggle}
        prose={slot.prose}
        liveActions={segment.running ? options.liveActionsFor(segment) : NO_LIVE_ACTIONS}
        {...(segment === lastSegment && options.turnFoldEndId !== undefined
          ? { turnFoldEndId: options.turnFoldEndId }
          : {})}
      >
        {slot.rows}
      </TurnWorkSegmentBlock>
    );
  }
}

export type TurnWorkSegmentEarlierProps = {
  hiddenCount: number;
  locale: Locale;
  onShowMore: () => void;
};

/** Older segments beyond the window stay unmounted until asked for. */
export function TurnWorkSegmentEarlier(props: TurnWorkSegmentEarlierProps): ReactElement {
  return (
    <Button
      variant="ghost"
      size="compact"
      className="turn-work-segment-earlier"
      data-testid="turn-work-segment-earlier"
      onClick={props.onShowMore}
    >
      {props.locale === 'zh-CN'
        ? `显示更早的 ${props.hiddenCount} 段`
        : `Show ${props.hiddenCount} earlier parts`}
    </Button>
  );
}
