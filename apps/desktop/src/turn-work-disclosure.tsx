import type { ReactElement } from 'react';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';
import { formatWorkDuration, resolveWorkFoldCode, WorkFoldHeader } from './work-fold-header.js';
import { WorkChainCompactToggle } from './turn-work-segment.js';

export type TurnWorkDisclosureProps = {
  projection: TurnWorkDisclosureProjection;
  open: boolean;
  locale: 'zh-CN' | 'en';
  onToggle: () => void;
  /** 精简 switch; shown beside the open header when the fold lists segments. */
  compact?: boolean;
  onCompactChange?: (next: boolean) => void;
  /** Identity for the fold rail; the fold's region ends at the last segment's marker. */
  foldId?: string;
};

/**
 * Turn-level disclosure around the unchanged causal rows.
 *
 * While the turn runs this is the only chrome the chain gets: one header that
 * names the current action and counts up, with every intermediate row folded
 * behind it. It becomes the settled summary in place when the run finishes —
 * same element, same open/closed state, so a user reading the expanded chain
 * does not have it collapse out from under them at settle.
 */
export function TurnWorkDisclosure(props: TurnWorkDisclosureProps): ReactElement {
  const { projection, locale } = props;
  const live = projection.live === true;
  // Claim 正在运行 only while a tool actually is. Between rounds the model is
  // composing, which the run status footer already says; a second line
  // asserting the chain is running would be both duplicate and untrue.
  const running = live && projection.runningTool !== undefined;
  const runningCode = projection.runningTool
    ? resolveWorkFoldCode(projection.runningTool)
    : undefined;
  // Open with segments, the running segment's own header says what is in
  // flight; repeating the command up here would put two "live" lines on screen.
  const segmented = props.open && props.onCompactChange !== undefined;
  const meta =
    projection.toolCount !== undefined
      ? locale === 'zh-CN'
        ? `${projection.toolCount} 个工具`
        : `${projection.toolCount} tool${projection.toolCount === 1 ? '' : 's'}`
      : '';

  return (
    <div
      className={`turn-work-disclosure work fw${props.open ? ' open is-open' : ' is-collapsed'}${
        live ? ' is-active' : ''
      }`}
      data-testid="turn-work-disclosure"
      data-open={props.open ? 'true' : 'false'}
      data-live={live ? 'true' : 'false'}
    >
      <WorkFoldHeader
        state={running ? 'running' : 'done'}
        locale={locale}
        open={props.open}
        onToggle={props.onToggle}
        className="turn-work-disclosure-trigger"
        testId="turn-work-disclosure-trigger"
        failureCount={projection.failureCount}
        {...(props.foldId !== undefined
          ? {
              dataAttributes: {
                'data-fold-header': props.foldId,
                'data-fold-open': props.open ? 'true' : 'false',
                'data-fold-level': 'turn',
                'data-fold-title':
                  projection.elapsedMs !== undefined
                    ? formatWorkDuration(projection.elapsedMs, locale)
                    : locale === 'zh-CN'
                      ? '已工作'
                      : 'Work',
                'data-fold-meta': meta,
              },
            }
          : {})}
        {...(running
          ? {
              ...(projection.runningSince !== undefined
                ? { runningSince: projection.runningSince }
                : {}),
              ...(projection.runningToolIndex !== undefined
                ? { runningToolIndex: projection.runningToolIndex }
                : {}),
              ...(runningCode !== undefined && !segmented ? { runningCode } : {}),
              ...(projection.latestNarration !== undefined && !segmented
                ? { narration: projection.latestNarration }
                : {}),
            }
          : {
              ...(projection.elapsedMs !== undefined ? { elapsedMs: projection.elapsedMs } : {}),
              ...(projection.toolCount !== undefined ? { toolCount: projection.toolCount } : {}),
              ...(projection.fileCount !== undefined ? { fileCount: projection.fileCount } : {}),
            })}
      />
      {props.open && props.onCompactChange !== undefined ? (
        <WorkChainCompactToggle
          compact={props.compact === true}
          locale={locale}
          onChange={props.onCompactChange}
        />
      ) : null}
    </div>
  );
}
