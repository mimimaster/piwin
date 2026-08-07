/**
 * Cursor-style call-chain rows: consecutive read/search tools fold into
 * "Explored N files"; other tools stay as individual light rows.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { ToolCallCard } from './tool-call-card';
import type { DiffCardRequest } from './diff-card';
import type { ToolCallDensity } from './ui-preferences';
import {
  exploreGroupLabel,
  groupToolsForTimeline,
  type TimelineSegment,
} from './activity-timeline';
import { IconChevronDown, IconSearch } from './shell-icons';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  /** Project root forwarded to ToolCallCard → DiffCard. */
  projectPath?: string | null;
  /** Host request adapter forwarded to ToolCallCard → DiffCard. */
  request?: DiffCardRequest;
  /**
   * When true (historical hydrate), collapse completed tools into a single
   * summary row so opening a long session does not mount every ToolCallCard.
   * Running/error tools always stay visible.
   */
  historyCollapsed?: boolean;
};

function exploreBatchIsActive(tools: ToolCardUi[]): boolean {
  return tools.some((tool) => tool.status === 'running');
}

function exploreBatchDefaultOpen(tools: ToolCardUi[]): boolean {
  return tools.some((tool) => tool.status === 'running' || tool.status === 'error');
}

function ExploreGroupBlock(props: {
  tools: ToolCardUi[];
  fileCount: number;
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
}): ReactElement {
  const isActive = exploreBatchIsActive(props.tools);
  const defaultOpen = exploreBatchDefaultOpen(props.tools);
  const [expanded, setExpanded] = useState(defaultOpen);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled) {
      setExpanded(exploreBatchDefaultOpen(props.tools));
    }
  }, [props.tools, userToggled]);

  const cardProps = {
    density: props.density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

  const label = exploreGroupLabel({
    fileCount: props.fileCount,
    locale: props.locale,
    isActive,
  });

  return (
    <div
      className={`activity-explore-group${isActive ? ' is-active' : ''}${
        expanded ? ' is-expanded' : ' is-collapsed'
      }`}
      data-testid="activity-explore-group"
      data-file-count={props.fileCount}
    >
      <button
        type="button"
        className="activity-explore-summary"
        aria-expanded={expanded}
        data-testid="activity-explore-summary"
        onClick={() => {
          setUserToggled(true);
          setExpanded((previous) => !previous);
        }}
      >
        <IconSearch className="activity-explore-icon" width={13} height={13} />
        <span className="activity-explore-label">{label}</span>
        <IconChevronDown
          className={`activity-explore-chevron${expanded ? ' is-open' : ''}`}
          width={12}
          height={12}
        />
      </button>
      {expanded ? (
        <div className="activity-explore-children" data-testid="activity-explore-children">
          {props.tools.map((tool) => (
            <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderSegment(
  segment: TimelineSegment,
  cardProps: {
    density: ToolCallDensity;
    projectPath?: string | null;
    request?: DiffCardRequest;
  },
  locale: 'zh-CN' | 'en',
): ReactElement {
  if (segment.kind === 'tool') {
    return <ToolCallCard key={segment.tool.toolCallId} tool={segment.tool} {...cardProps} />;
  }

  return (
    <ExploreGroupBlock
      key={`explore-${segment.tools.map((tool) => tool.toolCallId).join('-')}`}
      tools={segment.tools}
      fileCount={segment.fileCount}
      density={cardProps.density}
      locale={locale}
      {...(cardProps.projectPath !== undefined ? { projectPath: cardProps.projectPath } : {})}
      {...(cardProps.request !== undefined ? { request: cardProps.request } : {})}
    />
  );
}

function HistoryToolsCollapsed(props: {
  tools: ToolCardUi[];
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
}): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const attentionTools = props.tools.filter(
    (tool) => tool.status === 'running' || tool.status === 'error',
  );
  const completedCount = props.tools.length - attentionTools.length;
  const hasFailure = props.tools.some((tool) => tool.status === 'error');
  const [expanded, setExpanded] = useState(attentionTools.length > 0 && completedCount === 0);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled && attentionTools.length > 0 && completedCount === 0) {
      setExpanded(true);
    }
  }, [attentionTools.length, completedCount, userToggled]);

  const cardProps = {
    density: props.density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

  const summaryLabel =
    completedCount <= 0
      ? isZh
        ? `${props.tools.length} 个工具`
        : `${props.tools.length} tools`
      : isZh
        ? hasFailure
          ? `${completedCount} 个工具已完成（含失败）`
          : `${completedCount} 个工具已完成`
        : hasFailure
          ? `${completedCount} tools completed (with failures)`
          : `${completedCount} tools completed`;

  return (
    <div
      className={`activity-history-tools${expanded ? ' is-expanded' : ' is-collapsed'}${
        hasFailure ? ' has-failure' : ''
      }`}
      data-testid="activity-history-tools"
    >
      {completedCount > 0 ? (
        <button
          type="button"
          className="activity-history-tools-summary"
          aria-expanded={expanded}
          data-testid="activity-history-tools-summary"
          onClick={() => {
            setUserToggled(true);
            setExpanded((previous) => !previous);
          }}
        >
          <IconSearch className="activity-explore-icon" width={13} height={13} />
          <span className="activity-explore-label">{summaryLabel}</span>
          <IconChevronDown
            className={`activity-explore-chevron${expanded ? ' is-open' : ''}`}
            width={12}
            height={12}
          />
        </button>
      ) : null}
      {expanded ? (
        <div className="activity-history-tools-children" data-testid="activity-history-tools-children">
          {props.tools.map((tool) => (
            <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
          ))}
        </div>
      ) : (
        attentionTools.map((tool) => (
          <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
        ))
      )}
    </div>
  );
}

export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  const tools = props.tools;
  const density = props.density ?? 'compact';
  const locale = props.locale ?? 'zh-CN';

  const segments = useMemo(() => groupToolsForTimeline(tools), [tools]);
  const historyCollapsed = props.historyCollapsed === true;

  if (tools.length === 0) {
    return null;
  }

  const cardProps = {
    density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

  if (historyCollapsed && tools.length >= 3) {
    return (
      <div className="activity-timeline" data-testid="turn-tool-group">
        <HistoryToolsCollapsed
          tools={tools}
          density={density}
          locale={locale}
          {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
          {...(props.request !== undefined ? { request: props.request } : {})}
        />
      </div>
    );
  }

  return (
    <div className="activity-timeline" data-testid="turn-tool-group">
      {segments.map((segment) => renderSegment(segment, cardProps, locale))}
    </div>
  );
}
