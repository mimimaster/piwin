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
import { useRef } from 'react';
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
  onToggle: () => void;
  /** Narration rows: shown whether or not the segment is open. */
  prose?: ReactNode;
  /** What the running segment's tools are doing right now (collapsed header). */
  liveActions?: readonly TurnWorkSegmentLiveAction[];
  /** The segment's tool rows. Only called for an open segment. */
  children?: ReactNode;
  /** Set on the last segment: closes the turn fold's region for the rail. */
  turnFoldEndId?: string;
};

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
      props.onToggle();
      return;
    }
    collapseFoldWithAnchor(container, header, {
      beginProgrammaticScroll: port?.beginProgrammaticScroll ?? (() => {}),
    });
  };

  const meta = [
    zh ? `${summary.toolCount} 个工具` : `${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'}`,
    summary.elapsedMs !== undefined ? formatWorkDuration(summary.elapsedMs, locale, 'executed') : '',
  ]
    .filter(Boolean)
    .join(' · ');

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
      <WorkFoldHeader
        state={running ? 'running' : 'done'}
        locale={locale}
        open={open}
        onToggle={props.onToggle}
        className="turn-work-disclosure-trigger turn-work-segment-header"
        testId="turn-work-segment-header"
        doneIcon="run"
        verb="executed"
        failureCount={summary.failureCount}
        dataAttributes={{
          'data-fold-header': foldId,
          'data-fold-open': open ? 'true' : 'false',
          'data-fold-level': 'segment',
          'data-fold-title': segment.title ?? '',
          'data-fold-meta': meta,
        }}
        {...(running
          ? summary.startedAt !== undefined
            ? { runningSince: summary.startedAt }
            : {}
          : {
              ...(summary.elapsedMs !== undefined ? { elapsedMs: summary.elapsedMs } : {}),
              toolCount: summary.toolCount,
              fileCount: summary.fileCount,
            })}
      >
        {running ? (
          <RunningSegmentLabel actions={props.liveActions ?? []} locale={locale} />
        ) : undefined}
      </WorkFoldHeader>
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
        onToggle={() => options.onToggle(segment.id, open)}
        prose={slot.prose}
        liveActions={segment.running ? options.liveActionsFor(segment) : []}
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

export type WorkChainCompactToggleProps = {
  compact: boolean;
  locale: Locale;
  onChange: (next: boolean) => void;
};

export function WorkChainCompactToggle(props: WorkChainCompactToggleProps): ReactElement {
  return (
    <Button
      variant="ghost"
      size="compact"
      className={`work-chain-compact-toggle${props.compact ? ' is-active' : ''}`}
      data-testid="work-chain-compact-toggle"
      aria-pressed={props.compact}
      title={
        props.locale === 'zh-CN'
          ? '精简：只列段标题，diff 与输出不自动展开'
          : 'Compact: segment titles only; diffs and output stay closed'
      }
      onClick={() => props.onChange(!props.compact)}
    >
      {props.locale === 'zh-CN' ? '精简' : 'Compact'}
    </Button>
  );
}
