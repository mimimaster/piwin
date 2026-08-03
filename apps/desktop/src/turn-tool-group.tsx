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

export function TurnToolGroup(props: TurnToolGroupProps): ReactElement | null {
  const tools = props.tools;
  const density = props.density ?? 'compact';
  const locale = props.locale ?? 'zh-CN';

  const segments = useMemo(() => groupToolsForTimeline(tools), [tools]);

  if (tools.length === 0) {
    return null;
  }

  const cardProps = {
    density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
  };

  return (
    <div className="activity-timeline" data-testid="turn-tool-group">
      {segments.map((segment) => renderSegment(segment, cardProps, locale))}
    </div>
  );
}
