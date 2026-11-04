/**
 * Maps verified workbench state onto the Session Summary panel.
 *
 * Everything here already exists in the app: the context telemetry selector,
 * the git diff summary, the session plan, walkthrough artifacts, the active
 * canvas target, and the running job/subagent counts. No new Host contract and
 * no invented "outputs" — anything unknown stays absent rather than showing 0.
 */
import type { ReactElement } from 'react';
import type { ContextTelemetryState } from '../context/context-telemetry-reducer';
import { selectContextRingView } from '../context/context-telemetry-selector';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { formatCompactTokens, type SessionResource } from '@piwin/contracts';
import type { RightPanelTab } from './right-panel-sections';
import {
  SessionSummaryPanel,
  type SessionSummaryDocument,
  type SessionSummaryEnvironmentLine,
  type SessionSummaryMetric,
  type SessionSummaryOutput,
  type SessionSummaryTool,
} from './session-summary-panel';

export type SessionSummaryPlan = {
  title: string;
  completedSteps: number;
  totalSteps: number;
  onOpen: () => void;
};

export type SessionSummaryDocumentInput = {
  id: string;
  title: string;
  path?: string | undefined;
  /** 'plan' | 'book' | 'doc' from the document index; only 'plan' is renamed. */
  iconKind?: 'doc' | 'book' | 'plan' | undefined;
};

export type SessionSummaryEnvironmentInput = {
  /** Host-reported session model id (`SessionSummary.model`). */
  modelId?: string | null | undefined;
  thinkingLevel?: string | null | undefined;
  messageCount?: number | null | undefined;
  /** Explicit host label; a remote Host must never read as this machine. */
  hostLabel?: string | null | undefined;
};

export type SessionSummaryBindingProps = {
  locale: DesktopLocale;
  sessionTitle: string | null;
  streaming: boolean;
  projectPath: string | null;
  projectTrusted: boolean;
  workspaceKind: 'project' | 'general';
  contextTelemetry: ContextTelemetryState;
  diffStat: { additions: number; deletions: number } | null;
  plan: SessionSummaryPlan | null;
  walkthroughCount: number;
  artifactTitle: string | null;
  tasksActiveCount: number;
  runningJobCount: number;
  /** Verified document shortcuts; a plan/prose path is never invented here. */
  documents?: readonly SessionSummaryDocumentInput[] | undefined;
  onOpenDocument?: ((document: SessionSummaryDocumentInput) => void) | undefined;
  environment?: SessionSummaryEnvironmentInput | undefined;
  /** Host `session/resources` projection; omitted/empty stays an honest empty. */
  resources?: readonly SessionResource[] | undefined;
  onOpenTool: (tab: RightPanelTab) => void;
  onOpenArtifact: () => void;
  onOpenLibrary?: (() => void) | undefined;
  onOpenKnowledge?: (() => void) | undefined;
};

/**
 * A Host endpoint may carry a query (tokens, pairing codes). Summary shows the
 * address only — §7 forbids leaking query strings into chrome.
 */
export function displayHostEndpoint(endpoint: string): string {
  const cut = endpoint.search(/[?#]/);
  const trimmed = endpoint.trim();
  return cut < 0 ? trimmed : trimmed.slice(0, cut);
}

type SessionSummaryResourceOpen = {
  onOpenDocument?: SessionSummaryBindingProps['onOpenDocument'];
  onOpenKnowledge?: SessionSummaryBindingProps['onOpenKnowledge'];
  onOpenLibrary?: SessionSummaryBindingProps['onOpenLibrary'];
};

function resourceProvenanceLabel(resource: SessionResource, zh: boolean): string {
  switch (resource.provenance) {
    case 'prompt-attachment':
      return zh ? '附件' : 'Attachment';
    case 'prompt-skill':
      return zh ? '注入技能' : 'Injected skill';
    case 'prompt-context':
      return zh ? '引用文件' : 'Attached file';
    case 'knowledge-citation':
      return zh ? '知识库' : 'Knowledge';
    case 'workspace-write':
      return zh ? '本会话写入' : 'Written this session';
    case 'generated-media':
      return zh ? '生成媒体' : 'Generated media';
    case 'web-search-hit':
    case 'legacy-search-citation':
      return zh ? '检索' : 'Search';
  }
}

function resourceSubtitle(resource: SessionResource, zh: boolean): string {
  const label = resourceProvenanceLabel(resource, zh);
  return resource.target ? `${label} · ${resource.target}` : label;
}

function resourceRow(
  resource: SessionResource,
  zh: boolean,
  open: SessionSummaryResourceOpen,
): SessionSummaryOutput {
  const row: SessionSummaryOutput = {
    id: resource.id,
    title: resource.title,
    subtitle: resourceSubtitle(resource, zh),
  };
  if (resource.availability === 'missing') {
    row.statusLabel = zh ? '缺失' : 'Missing';
    row.statusTone = 'warning';
  }
  const onOpen = resourceOpenHandler(resource, open);
  if (onOpen) row.onOpen = onOpen;
  return row;
}

function resourceOpenHandler(
  resource: SessionResource,
  open: SessionSummaryResourceOpen,
): (() => void) | undefined {
  if ((resource.kind === 'media' || resource.kind === 'attachment') && open.onOpenLibrary) {
    return open.onOpenLibrary;
  }
  if (resource.kind === 'knowledge' && open.onOpenKnowledge) {
    return open.onOpenKnowledge;
  }
  if (resource.kind === 'file' && resource.target && open.onOpenDocument) {
    const document = {
      id: resource.id,
      title: resource.title,
      path: resource.target,
    };
    return () => open.onOpenDocument?.(document);
  }
  return undefined;
}

export function displayWorkspacePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] ?? path;
}

export function sessionSummaryContextMetric(props: {
  locale: DesktopLocale;
  telemetry: ContextTelemetryState;
  sessionTitle: string | null;
  onOpen: () => void;
}): SessionSummaryMetric | null {
  const view = selectContextRingView({
    telemetry: props.telemetry,
    locale: props.locale,
  });
  if (!view.visible) return null;
  const percentText = view.numericHidden ? undefined : view.percentText;
  const value =
    percentText !== undefined
      ? `${String(percentText)}%`
      : view.phase === 'offline'
        ? props.locale === 'zh-CN'
          ? '离线'
          : 'Offline'
        : props.locale === 'zh-CN'
          ? '未知'
          : 'Unknown';
  const tokens =
    view.tokensUsed !== undefined && view.tokensLimit !== undefined
      ? `${formatCompactTokens(view.tokensUsed)} / ${formatCompactTokens(view.tokensLimit)}`
      : undefined;
  void props.sessionTitle;
  return {
    value,
    ...(tokens === undefined ? {} : { caption: tokens }),
    onOpen: props.onOpen,
  };
}

export function SessionSummaryBinding(props: SessionSummaryBindingProps): ReactElement {
  const { locale, onOpenTool } = props;
  const zh = locale === 'zh-CN';
  const resourceOpen: SessionSummaryResourceOpen = {
    ...(props.onOpenDocument === undefined ? {} : { onOpenDocument: props.onOpenDocument }),
    ...(props.onOpenKnowledge === undefined ? {} : { onOpenKnowledge: props.onOpenKnowledge }),
    ...(props.onOpenLibrary === undefined ? {} : { onOpenLibrary: props.onOpenLibrary }),
  };

  const context = sessionSummaryContextMetric({
    locale,
    telemetry: props.contextTelemetry,
    sessionTitle: props.sessionTitle,
    onOpen: () => onOpenTool('summary'),
  });

  const changes: SessionSummaryMetric | null =
    props.diffStat === null
      ? null
      : {
          value: `+${String(props.diffStat.additions)} −${String(props.diffStat.deletions)}`,
          caption: zh ? '整个工作树，含非本会话改动' : 'Whole working tree, not only this session',
          onOpen: () => onOpenTool('review'),
        };

  const outputs: SessionSummaryOutput[] = [];
  if (props.plan !== null) {
    outputs.push({
      id: 'plan',
      title: props.plan.title,
      subtitle: zh
        ? `计划 · ${String(props.plan.completedSteps)}/${String(props.plan.totalSteps)} 步`
        : `Plan · ${String(props.plan.completedSteps)}/${String(props.plan.totalSteps)} steps`,
      statusLabel:
        props.plan.completedSteps >= props.plan.totalSteps
          ? zh
            ? '已完成'
            : 'Done'
          : zh
            ? '进行中'
            : 'Active',
      statusTone:
        props.plan.completedSteps >= props.plan.totalSteps ? 'success' : 'running',
      onOpen: props.plan.onOpen,
    });
  }
  if (props.artifactTitle !== null) {
    outputs.push({
      id: 'canvas',
      title: props.artifactTitle,
      subtitle: zh ? '画布产物' : 'Canvas artifact',
      onOpen: props.onOpenArtifact,
    });
  }
  if (props.walkthroughCount > 0) {
    // Reports live under their assistant messages; the transcript is the
    // destination, so this row is informational rather than a fake launcher.
    outputs.push({
      id: 'walkthroughs',
      title: zh ? '交付报告' : 'Delivery reports',
      subtitle: zh
        ? `${String(props.walkthroughCount)} 条已生成`
        : `${String(props.walkthroughCount)} generated`,
      statusLabel: String(props.walkthroughCount),
      statusTone: 'neutral',
    });
  }
  for (const resource of props.resources ?? []) {
    if (resource.role !== 'output') continue;
    outputs.push(resourceRow(resource, zh, resourceOpen));
  }

  const activity: SessionSummaryOutput[] = [];
  if (props.tasksActiveCount > 0) {
    activity.push({
      id: 'tasks',
      title: zh ? '子代理任务' : 'Subagent tasks',
      subtitle: zh ? '后台会话正在运行' : 'Child sessions are running',
      statusLabel: String(props.tasksActiveCount),
      statusTone: 'running',
      onOpen: () => onOpenTool('tasks'),
    });
  }
  if (props.runningJobCount > 0) {
    activity.push({
      id: 'jobs',
      title: zh ? '后台任务' : 'Background jobs',
      subtitle: zh ? '查看运行中的进程' : 'Inspect running processes',
      statusLabel: String(props.runningJobCount),
      statusTone: 'running',
      onOpen: () => onOpenTool('terminal'),
    });
  }

  const sources: SessionSummaryOutput[] = (props.resources ?? [])
    .filter((resource) => resource.role === 'input')
    .map((resource) => resourceRow(resource, zh, resourceOpen));

  const documents: SessionSummaryDocument[] = (props.documents ?? []).map((document) => ({
    id: document.id,
    title: document.title,
    ...(document.path === undefined ? {} : { subtitle: document.path }),
    ...(props.onOpenDocument === undefined
      ? {}
      : { onOpen: () => props.onOpenDocument?.(document) }),
  }));

  const environmentLines: SessionSummaryEnvironmentLine[] = [];
  if (props.environment?.modelId) {
    environmentLines.push({
      id: 'model',
      label: zh ? '模型' : 'Model',
      value: props.environment.modelId,
    });
  }
  if (props.environment?.thinkingLevel) {
    environmentLines.push({
      id: 'thinking',
      label: zh ? '思考强度' : 'Thinking',
      value: props.environment.thinkingLevel,
    });
  }
  if (
    props.environment?.messageCount !== null &&
    props.environment?.messageCount !== undefined
  ) {
    environmentLines.push({
      id: 'messages',
      label: zh ? '消息' : 'Messages',
      value: String(props.environment.messageCount),
    });
  }
  if (props.environment?.hostLabel) {
    environmentLines.push({
      id: 'host',
      label: zh ? 'Host' : 'Host',
      value: displayHostEndpoint(props.environment.hostLabel),
    });
  }

  const tools: SessionSummaryTool[] = [
    {
      id: 'browser',
      title: zh ? '浏览器' : 'Browser',
      subtitle: zh ? '共享会话' : 'Shared session',
    },
    {
      id: 'terminal',
      title: zh ? '终端' : 'Terminal',
      subtitle: zh ? '本地 Shell' : 'Local shell',
    },
    {
      id: 'files',
      title: zh ? '文件' : 'Files',
      subtitle: props.projectPath === null ? (zh ? '浏览工作区' : 'Workspace') : displayWorkspacePath(props.projectPath),
    },
    {
      id: 'review',
      title: zh ? '变更' : 'Changes',
      subtitle: zh ? '工作树对比' : 'Diff & turns',
    },
  ];

  return (
    <SessionSummaryPanel
      locale={locale}
      sessionTitle={props.sessionTitle}
      runLabel={props.streaming ? (zh ? '正在运行' : 'Running') : null}
      workspaceLabel={
        props.workspaceKind === 'general'
          ? zh
            ? '通用工作区'
            : 'General workspace'
          : zh
            ? '项目'
            : 'Project'
      }
      workspaceDetail={
        props.projectPath === null
          ? null
          : `${displayWorkspacePath(props.projectPath)}${
              props.projectTrusted ? '' : zh ? ' · 未信任' : ' · untrusted'
            }`
      }
      context={context}
      changes={changes}
      outputs={outputs}
      sources={sources}
      activity={activity}
      documents={documents}
      environment={environmentLines}
      tools={tools}
      onOpenTool={onOpenTool}
    />
  );
}
