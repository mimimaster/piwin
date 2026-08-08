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
  extractSearchInfo,
  formatFilePillPath,
  groupToolsForTimeline,
  isSearchTool,
  type TimelineSegment,
} from './activity-timeline';
import { FileTypeIcon } from './file-type-icon';
import { IconChevronDown, IconSearch } from './shell-icons';

export type TurnToolGroupProps = {
  tools: ToolCardUi[];
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  /** Project root forwarded to ToolCallCard → DiffCard. */
  projectPath?: string | null;
  /** Host request adapter forwarded to ToolCallCard → DiffCard. */
  request?: DiffCardRequest;
  /** Callback when user clicks a matched file in search results. */
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
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

function SearchToolItemRow(props: {
  tool: ToolCardUi;
  projectPath?: string | null | undefined;
  locale: 'zh-CN' | 'en';
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
}): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const info = extractSearchInfo(props.tool, props.projectPath);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`search-tool-item${info.isError ? ' has-error' : ''}`}>
      <button
        type="button"
        className="search-tool-item-summary"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <IconChevronDown
          className={`activity-explore-chevron${expanded ? ' is-open' : ''}`}
          width={12}
          height={12}
        />
        <span>Searched </span>
        <span className="search-query-chip">{info.query}</span>
        {info.dir ? <span> in {info.dir}</span> : null}
        {info.pattern ? <span> ({info.pattern})</span> : null}
        {info.isError ? (
          <span className="search-error-label"> ({isZh ? 'search失败' : 'Search failed'})</span>
        ) : (
          <span> ({info.count})</span>
        )}
      </button>

      {expanded ? (
        <div className="search-tool-file-list">
          {info.isError && info.errorMessage ? (
            <div className="tool-call-error">{info.errorMessage}</div>
          ) : null}
          {info.matchedFiles.map((filePath) => {
            const { absolutePath, relativePath, displayPath } = formatFilePillPath(
              filePath,
              info.dir,
              props.projectPath,
            );
            return (
              <button
                key={filePath}
                type="button"
                className="search-file-pill-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenFile?.(absolutePath, relativePath);
                }}
                title={absolutePath}
              >
                <FileTypeIcon filePathOrExt={filePath} className="search-file-icon" />
                <span className="search-file-path">{displayPath}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ExploreGroupBlock(props: {
  tools: ToolCardUi[];
  fileCount: number;
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
  projectPath?: string | null | undefined;
  request?: DiffCardRequest | undefined;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
}): ReactElement {
  const isActive = exploreBatchIsActive(props.tools);
  const searchTools = props.tools.filter(isSearchTool);
  const hasSearchTools = searchTools.length > 0;
  const isZh = props.locale === 'zh-CN';

  // Search groups collapse by default unless user toggles.
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!userToggled && !hasSearchTools) {
      setExpanded(props.tools.some((t) => t.status === 'running' || t.status === 'error'));
    }
  }, [props.tools, userToggled, hasSearchTools]);

  const cardProps = {
    density: props.density,
    ...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {}),
    ...(props.request !== undefined ? { request: props.request } : {}),
    ...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {}),
  };

  const firstSearchInfo =
    searchTools.length > 0 && searchTools[0]
      ? extractSearchInfo(searchTools[0], props.projectPath)
      : null;
  const hasError = props.tools.some((t) => t.status === 'error');

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
        <IconChevronDown
          className={`activity-explore-chevron${expanded ? ' is-open' : ''}`}
          width={12}
          height={12}
        />
        {hasSearchTools && firstSearchInfo ? (
          <span className="activity-explore-label">
            <span>Searched </span>
            <span className="search-query-chip">{firstSearchInfo.query}</span>
            {searchTools.length > 1 ? (
              <span>
                {isZh
                  ? ` 和另外 ${searchTools.length - 1} 个查询`
                  : ` and ${searchTools.length - 1} ${
                      searchTools.length - 1 === 1 ? 'query' : 'queries'
                    }`}
              </span>
            ) : (
              <>
                {firstSearchInfo.dir ? <span> in {firstSearchInfo.dir}</span> : null}
                {firstSearchInfo.pattern ? <span> ({firstSearchInfo.pattern})</span> : null}
                {firstSearchInfo.isError ? (
                  <span className="search-error-label">
                    {' '}
                    ({isZh ? 'search失败' : 'Search failed'})
                  </span>
                ) : (
                  <span> ({firstSearchInfo.count})</span>
                )}
              </>
            )}
            {searchTools.length > 1 && hasError ? (
              <span className="search-error-label"> ({isZh ? '含失败' : 'has failures'})</span>
            ) : null}
          </span>
        ) : (
          <>
            <IconSearch className="activity-explore-icon" width={13} height={13} />
            <span className="activity-explore-label">
              {exploreGroupLabel({
                fileCount: props.fileCount,
                locale: props.locale,
                isActive,
              })}
            </span>
          </>
        )}
      </button>
      {expanded ? (
        <div className="activity-explore-children" data-testid="activity-explore-children">
          {props.tools.map((tool) =>
            isSearchTool(tool) ? (
              <SearchToolItemRow
                key={tool.toolCallId}
                tool={tool}
                locale={props.locale}
                {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
                {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
              />
            ) : (
              <ToolCallCard key={tool.toolCallId} tool={tool} {...cardProps} />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function renderSegment(
  segment: TimelineSegment,
  cardProps: {
    density: ToolCallDensity;
    projectPath?: string | null | undefined;
    request?: DiffCardRequest | undefined;
    onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  },
  locale: 'zh-CN' | 'en',
): ReactElement {
  if (segment.kind === 'tool') {
    if (isSearchTool(segment.tool)) {
      return (
        <SearchToolItemRow
          key={segment.tool.toolCallId}
          tool={segment.tool}
          locale={locale}
          {...(cardProps.projectPath !== undefined ? { projectPath: cardProps.projectPath } : {})}
          {...(cardProps.onOpenFile !== undefined ? { onOpenFile: cardProps.onOpenFile } : {})}
        />
      );
    }
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
      {...(cardProps.onOpenFile !== undefined ? { onOpenFile: cardProps.onOpenFile } : {})}
    />
  );
}

function HistoryToolsCollapsed(props: {
  tools: ToolCardUi[];
  density: ToolCallDensity;
  locale: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
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
    ...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {}),
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
        <div
          className="activity-history-tools-children"
          data-testid="activity-history-tools-children"
        >
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
    ...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {}),
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
          {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
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

