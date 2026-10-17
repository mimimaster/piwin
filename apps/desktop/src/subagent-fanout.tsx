/**
 * Fan-out body of a subagent group card (Inkstone proto-14 ①②).
 *
 * Left: the main agent node, which doubles as the group's fold control (the
 * open card has no header bar). Middle: one wire per child, coloured by its
 * phase. Right: the child rows, passed in as children. Wire geometry is pure
 * arithmetic on the row index (subagent-fanout-geometry.ts); a narrow card
 * swaps the curves for a tree rail through a container query, with the
 * same rows, and lays the main node above the rail.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { SubagentLocale, SubagentRowPhase } from './subagent-card-view';
import {
  SUBAGENT_FANOUT_RAIL_WIDTH,
  SUBAGENT_FANOUT_ROW_HEIGHT,
  SUBAGENT_FANOUT_WIRE_WIDTH,
  subagentFanoutCurvePath,
  subagentFanoutHeight,
  subagentFanoutOriginY,
  subagentFanoutRailPath,
} from './subagent-fanout-geometry';

export type SubagentFanoutNode = {
  key: string;
  phase: SubagentRowPhase;
  /** This child's preview is open. */
  selected: boolean;
};

function mainNodeStatus(nodes: readonly SubagentFanoutNode[], locale: SubagentLocale): string {
  const pending = nodes.filter((node) => node.phase === 'running' || node.phase === 'queued').length;
  const zh = locale === 'zh-CN';
  if (pending > 0) return zh ? `等待 ${pending}/${nodes.length}` : `Waiting ${pending}/${nodes.length}`;
  return zh ? `已返回 ${nodes.length}/${nodes.length}` : `Returned ${nodes.length}/${nodes.length}`;
}

function Wires(props: {
  nodes: readonly SubagentFanoutNode[];
  variant: 'curve' | 'rail';
}): ReactElement {
  const count = props.nodes.length;
  const height = subagentFanoutHeight(count);
  const width = props.variant === 'curve' ? SUBAGENT_FANOUT_WIRE_WIDTH : SUBAGENT_FANOUT_RAIL_WIDTH;
  return (
    <svg
      className={`subagent-fanout-wires is-${props.variant}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {props.nodes.map((node, index) => (
        <path
          key={node.key}
          className="subagent-fanout-wire"
          data-phase={node.phase}
          data-selected={node.selected}
          d={
            props.variant === 'curve'
              ? subagentFanoutCurvePath(index, count, width)
              : subagentFanoutRailPath(index)
          }
        />
      ))}
      {props.variant === 'curve' ? (
        <circle className="subagent-fanout-origin" cx={0} cy={subagentFanoutOriginY(count)} r={2.5} />
      ) : null}
    </svg>
  );
}

export function SubagentFanout(props: {
  nodes: readonly SubagentFanoutNode[];
  locale: SubagentLocale;
  /** Group title ("N 个子代理"), named by the fold control. */
  title: string;
  /** The main node folds the group; the card has no header bar while open. */
  onCollapse: () => void;
  children: ReactNode;
}): ReactElement {
  const zh = props.locale === 'zh-CN';
  const style = {
    '--sa-fan-row-h': `${SUBAGENT_FANOUT_ROW_HEIGHT}px`,
    '--sa-fan-h': `${subagentFanoutHeight(props.nodes.length)}px`,
  } as CSSProperties;
  const foldLabel = zh ? `收起 ${props.title}` : `Collapse ${props.title}`;
  return (
    <div className="subagent-fanout" data-testid="subagent-fanout" style={style}>
      <button
        type="button"
        className="subagent-fanout-main"
        data-testid="subagent-fanout-main"
        aria-expanded="true"
        aria-label={foldLabel}
        title={foldLabel}
        onClick={props.onCollapse}
      >
        <span className="subagent-seal subagent-fanout-main-seal">{zh ? '主' : 'M'}</span>
        <span className="subagent-fanout-main-name">{zh ? '主代理' : 'Main agent'}</span>
        <span className="subagent-fanout-main-sub">{mainNodeStatus(props.nodes, props.locale)}</span>
      </button>
      <Wires nodes={props.nodes} variant="curve" />
      <Wires nodes={props.nodes} variant="rail" />
      <div className="subagent-fanout-rows">{props.children}</div>
    </div>
  );
}
