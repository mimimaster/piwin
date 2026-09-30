/**
 * Segment layer of the 已工作 fold: one header per narration segment, with
 * the segment's rows mounted only while it is open.
 */
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconChevronDown, IconChevronRight } from './shell-icons';
import { useTranscriptLocalFoldMeasure } from './use-transcript-local-fold-measure.js';
import type { TurnWorkSegment, TurnWorkSegmentStats } from './turn-work-segments.js';
import type { TurnWorkSegmentPlan } from './turn-work-segment-plan.js';

type Locale = 'zh-CN' | 'en';

type StatPart = { key: keyof TurnWorkSegmentStats; count: number; label: string; fail?: boolean };

function statParts(stats: TurnWorkSegmentStats, locale: Locale): StatPart[] {
  const zh = locale === 'zh-CN';
  const parts: StatPart[] = [
    { key: 'explore', count: stats.explore, label: zh ? `读${stats.explore}` : `${stats.explore} read` },
    {
      key: 'edit',
      count: stats.edit,
      label: zh ? `改${stats.edit}` : `${stats.edit} edit${stats.edit === 1 ? '' : 's'}`,
    },
    {
      key: 'command',
      count: stats.command,
      label: zh ? `命令${stats.command}` : `${stats.command} cmd`,
    },
    {
      key: 'subagent',
      count: stats.subagent,
      label: zh ? `子代理${stats.subagent}` : `${stats.subagent} subagent`,
    },
    { key: 'other', count: stats.other, label: zh ? `其他${stats.other}` : `${stats.other} other` },
    {
      key: 'failed',
      count: stats.failed,
      label: zh ? `失败${stats.failed}` : `${stats.failed} failed`,
      fail: true,
    },
  ];
  return parts.filter((part) => part.count > 0);
}

/**
 * Title for a segment the model did not narrate: its most consequential
 * action, not its most frequent one — ten reads around two edits is an edit.
 * The stat chips beside it carry the full counts.
 */
export function fallbackSegmentTitle(segment: TurnWorkSegment, locale: Locale): string {
  const { stats } = segment;
  const zh = locale === 'zh-CN';
  if (stats.edit > 0) {
    const files = Math.max(stats.editedFiles, 1);
    return zh ? `编辑了 ${files} 个文件` : `Edited ${files} file${files === 1 ? '' : 's'}`;
  }
  if (stats.command > 0) {
    return zh ? `运行了 ${stats.command} 条命令` : `Ran ${stats.command} commands`;
  }
  if (stats.subagent > 0) {
    return zh ? `委派了 ${stats.subagent} 个子代理` : `Delegated ${stats.subagent} subagents`;
  }
  if (stats.explore > 0) {
    return zh ? `探索了 ${stats.explore} 项` : `Explored ${stats.explore} items`;
  }
  if (stats.other > 0) {
    return zh ? `调用了 ${stats.other} 个工具` : `Called ${stats.other} tools`;
  }
  return zh ? `思考 · 第 ${segment.ordinal} 段` : `Thinking · part ${segment.ordinal}`;
}

export type TurnWorkSegmentBlockProps = {
  segment: TurnWorkSegment;
  open: boolean;
  locale: Locale;
  onToggle: () => void;
  /** The segment's rows. Only called for an open segment. */
  children?: ReactNode;
};

export function TurnWorkSegmentBlock(props: TurnWorkSegmentBlockProps): ReactElement {
  const { segment, open, locale } = props;
  const foldMeasure = useTranscriptLocalFoldMeasure(open);
  // Open, a narrated segment's own text renders right below the header, so
  // the header names what the segment did instead of repeating it.
  const narrated = segment.title !== undefined && !open;
  const title = narrated && segment.title !== undefined
    ? segment.title
    : fallbackSegmentTitle(segment, locale);
  const Chevron = open ? IconChevronDown : IconChevronRight;
  return (
    <div
      className={`turn-work-segment${open ? ' is-open' : ''}${segment.running ? ' is-running' : ''}${
        segment.stats.failed > 0 ? ' has-failure' : ''
      }`}
      data-testid="turn-work-segment"
      data-segment-id={segment.id}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="turn-work-segment-header"
        aria-expanded={open}
        data-testid="turn-work-segment-header"
        ref={foldMeasure.setRoot}
        onClick={() => {
          foldMeasure.onUserToggle();
          props.onToggle();
        }}
      >
        <Chevron className={`i s12 chev${open ? ' is-open' : ''}`} width={12} height={12} />
        <span className={`turn-work-segment-title${narrated ? '' : ' is-derived'}`}>{title}</span>
        <span className="turn-work-segment-stats">
          {statParts(segment.stats, locale).map((part) => (
            <span key={part.key} className={part.fail ? 'fail' : undefined}>
              {part.label}
            </span>
          ))}
        </span>
      </button>
      {open ? <div className="turn-work-segment-body">{props.children}</div> : null}
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
  options: { locale: Locale; onToggle: (segmentId: string, currentlyOpen: boolean) => void },
): void {
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
