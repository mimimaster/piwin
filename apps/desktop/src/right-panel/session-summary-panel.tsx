/**
 * Session Summary: the expanded right workspace's overview body.
 *
 * Every row here is a verified projection of data the workbench already holds
 * — no inferred "outputs" or "sources", and never a zero where the value is
 * unknown. Sources/Outputs identities come from Host `session/resources`.
 */
import type { ReactElement } from 'react';
import {
  SessionSummaryGrid,
  SessionSummaryRow,
  SessionSummarySection,
  SessionSummaryStatCard,
} from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { sectionIcon, type RightPanelTab } from './right-panel-sections';

export type SessionSummaryMetric = {
  /** Already formatted; the panel does no unit math. */
  value: string;
  caption?: string | undefined;
  tone?: 'running' | 'success' | 'warning' | 'danger' | 'neutral' | undefined;
  /** Opens the owning tool (the Changes card opens Review, etc.). */
  onOpen?: (() => void) | undefined;
};

export type SessionSummaryOutput = {
  id: string;
  title: string;
  subtitle: string;
  statusLabel?: string | undefined;
  statusTone?: 'running' | 'success' | 'warning' | 'danger' | 'neutral' | undefined;
  /** Omitted: informational row with no destination. */
  onOpen?: (() => void) | undefined;
};

export type SessionSummaryDocument = {
  id: string;
  title: string;
  /** Project-relative path when the document index knows one. */
  subtitle?: string | undefined;
  onOpen?: (() => void) | undefined;
};

export type SessionSummaryEnvironmentLine = {
  id: string;
  label: string;
  value: string;
};

export type SessionSummaryTool = {
  id: RightPanelTab;
  title: string;
  subtitle: string;
  badgeText?: string | undefined;
};

export type SessionSummaryPanelProps = {
  locale: DesktopLocale;
  sessionTitle: string | null;
  runLabel: string | null;
  workspaceLabel: string | null;
  workspaceDetail: string | null;
  context: SessionSummaryMetric | null;
  changes: SessionSummaryMetric | null;
  outputs: readonly SessionSummaryOutput[];
  /** Host-projected inputs (attachments, skills, search/knowledge citations). */
  sources?: readonly SessionSummaryOutput[] | undefined;
  activity: readonly SessionSummaryOutput[];
  /** Proven document shortcuts from the session document index. */
  documents?: readonly SessionSummaryDocument[] | undefined;
  /** Model / thinking / message count, when the Host projection knows them. */
  environment?: readonly SessionSummaryEnvironmentLine[] | undefined;
  tools: readonly SessionSummaryTool[];
  onOpenTool: (tab: RightPanelTab) => void;
};

export function SessionSummaryPanel(props: SessionSummaryPanelProps): ReactElement {
  const { locale, onOpenTool } = props;
  const zh = locale === 'zh-CN';

  return (
    <div className="session-summary" data-testid="session-summary">
      <section className="session-summary-section" data-testid="session-summary-session">
        <header className="session-summary-header">
          <h2 className="session-summary-title">
            {props.sessionTitle ?? (zh ? '当前会话' : 'This session')}
          </h2>
          {props.runLabel ? (
            <span className="session-summary-run" data-testid="session-summary-run">
              {props.runLabel}
            </span>
          ) : null}
        </header>
        {props.workspaceLabel ? (
          <p className="session-summary-workspace" data-testid="session-summary-workspace">
            <span className="session-summary-workspace-label">{props.workspaceLabel}</span>
            {props.workspaceDetail ? (
              <span className="session-summary-workspace-detail" title={props.workspaceDetail}>
                {props.workspaceDetail}
              </span>
            ) : null}
          </p>
        ) : null}
        {props.environment !== undefined && props.environment.length > 0 ? (
          <dl className="session-summary-facts" data-testid="session-summary-environment">
            {props.environment.map((line) => (
              <div className="session-summary-fact" key={line.id} data-testid={`session-summary-fact-${line.id}`}>
                <dt>{line.label}</dt>
                <dd title={line.value}>{line.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      {props.context !== null || props.changes !== null ? (
        <SessionSummarySection
          testId="session-summary-context"
          title={zh ? '上下文与工作树' : 'Context and workspace'}
          collapsible
          defaultExpanded
        >
          <SessionSummaryGrid columns={props.context !== null && props.changes !== null ? 2 : 1}>
            {props.context ? (
              <SessionSummaryStatCard
                testId="session-summary-context-card"
                label={zh ? '上下文占用' : 'Context used'}
                value={props.context.value}
                {...(props.context.caption === undefined
                  ? {}
                  : { caption: props.context.caption })}
                {...(props.context.onOpen === undefined ? {} : { onClick: props.context.onOpen })}
              />
            ) : null}
            {props.changes ? (
              <SessionSummaryStatCard
                testId="session-summary-changes-card"
                label={zh ? '工作树变更' : 'Working tree'}
                value={props.changes.value}
                {...(props.changes.caption === undefined
                  ? {}
                  : { caption: props.changes.caption })}
                {...(props.changes.onOpen === undefined ? {} : { onClick: props.changes.onOpen })}
              />
            ) : null}
          </SessionSummaryGrid>
        </SessionSummarySection>
      ) : null}

      <SessionSummarySection
        testId="session-summary-tools"
        className="session-summary-tools-section"
        title={zh ? '工具' : 'Tools'}
        collapsible
        defaultExpanded
      >
        <div className="session-summary-tools-grid">
          {props.tools.map((tool) => (
            <SessionSummaryRow
              key={tool.id}
              testId={`session-summary-tool-${tool.id}`}
              className="session-summary-tool-tile"
              icon={sectionIcon(tool.id)}
              title={tool.title}
              subtitle={tool.subtitle}
              onClick={() => onOpenTool(tool.id)}
              {...(tool.badgeText === undefined ? {} : { statusLabel: tool.badgeText })}
            />
          ))}
        </div>
      </SessionSummarySection>

      <SessionSummarySection
        testId="session-summary-sources"
        title={zh ? '来源' : 'Sources'}
        badgeText={
          props.sources === undefined || props.sources.length === 0
            ? undefined
            : String(props.sources.length)
        }
        collapsible
        defaultExpanded
        isEmpty={props.sources === undefined || props.sources.length === 0}
        emptyState={
          <p className="session-summary-empty" data-testid="session-summary-sources-empty">
            {zh ? '暂无附件、技能或检索引用' : 'No attachments, skills, or citations'}
          </p>
        }
      >
        {(props.sources ?? []).map((source) => (
          <SessionSummaryRow
            key={source.id}
            testId={`session-summary-source-${source.id}`}
            title={source.title}
            subtitle={source.subtitle}
            {...(source.onOpen === undefined ? {} : { onClick: source.onOpen })}
            {...(source.statusLabel === undefined ? {} : { statusLabel: source.statusLabel })}
            {...(source.statusTone === undefined ? {} : { statusTone: source.statusTone })}
          />
        ))}
      </SessionSummarySection>

      <SessionSummarySection
        testId="session-summary-outputs"
        title={zh ? '本会话产物' : 'Session outputs'}
        badgeText={props.outputs.length > 0 ? String(props.outputs.length) : undefined}
        collapsible
        isEmpty={props.outputs.length === 0}
        emptyState={
          <p className="session-summary-empty" data-testid="session-summary-outputs-empty">
            {zh ? '暂无计划、报告或画布产物' : 'No plan, report, or canvas yet'}
          </p>
        }
      >
        {props.outputs.map((output) => (
          <SessionSummaryRow
            key={output.id}
            testId={`session-summary-output-${output.id}`}
            title={output.title}
            subtitle={output.subtitle}
            {...(output.onOpen === undefined ? {} : { onClick: output.onOpen })}
            {...(output.statusLabel === undefined
              ? {}
              : { statusLabel: output.statusLabel })}
            {...(output.statusTone === undefined ? {} : { statusTone: output.statusTone })}
          />
        ))}
      </SessionSummarySection>

      <SessionSummarySection
        testId="session-summary-activity"
        title={zh ? '活动' : 'Activity'}
        badgeText={props.activity.length > 0 ? String(props.activity.length) : undefined}
        collapsible
        isEmpty={props.activity.length === 0}
        emptyState={
          <p className="session-summary-empty" data-testid="session-summary-activity-empty">
            {zh ? '暂无运行中的后台任务' : 'No running tasks or jobs'}
          </p>
        }
      >
        {props.activity.map((entry) => (
          <SessionSummaryRow
            key={entry.id}
            testId={`session-summary-activity-${entry.id}`}
            title={entry.title}
            subtitle={entry.subtitle}
            {...(entry.onOpen === undefined ? {} : { onClick: entry.onOpen })}
            {...(entry.statusLabel === undefined ? {} : { statusLabel: entry.statusLabel })}
            {...(entry.statusTone === undefined ? {} : { statusTone: entry.statusTone })}
          />
        ))}
      </SessionSummarySection>

      <SessionSummarySection
        testId="session-summary-documents"
        title={zh ? '文档' : 'Documents'}
        badgeText={
          props.documents === undefined || props.documents.length === 0
            ? undefined
            : String(props.documents.length)
        }
        collapsible
        defaultExpanded
        isEmpty={props.documents === undefined || props.documents.length === 0}
        emptyState={
          <p className="session-summary-empty" data-testid="session-summary-documents-empty">
            {zh ? '暂无已打开的会话文档' : 'No opened session documents'}
          </p>
        }
      >
        {(props.documents ?? []).map((document) => (
          <SessionSummaryRow
            key={document.id}
            testId={`session-summary-document-${document.id}`}
            title={document.title}
            {...(document.subtitle === undefined ? {} : { subtitle: document.subtitle })}
            {...(document.onOpen === undefined ? {} : { onClick: document.onOpen })}
          />
        ))}
      </SessionSummarySection>
    </div>
  );
}
