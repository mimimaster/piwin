import type { ReactElement } from 'react';
import type { SessionListItemUi } from '../../chat-ui-types.js';
import type { HostClient } from '../../host-client.js';
import type { ThemeManifest } from '@piwin/contracts';
import { ConversationPaneSession } from '../../conversation-pane-session.js';
import type { ArtifactCanvasTarget } from '../../artifact-canvas-model.js';
import type { DocumentOpenInput } from '../../tool-call-card.js';
import type { MediaPreviewReader } from '../../transcript-media-preview.js';
import { DockToolSurface } from './dock-tool-hosts.js';
import type { WorkspaceView } from './types.js';

export type DockViewRenderContext = {
  sessions: readonly SessionListItemUi[];
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactPreviewEnabled: boolean;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  onCreateConversation: () => Promise<string | null>;
  onCloseView: (viewId: string) => void;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
};

const TOOL_LABEL: Record<string, { zh: string; en: string }> = {
  browser: { zh: '浏览器面板', en: 'Browser panel' },
  changes: { zh: '变更面板', en: 'Changes panel' },
  canvas: { zh: '画布', en: 'Canvas' },
  doc: { zh: '文档', en: 'Document' },
};

export function DockViewContent(props: { viewId: string; view: WorkspaceView; ctx: DockViewRenderContext }): ReactElement {
  const { view, ctx } = props;
  if (view.kind === 'session' && view.sessionId) {
    return (
      <ConversationPaneSession
        sessionId={view.sessionId}
        hostClient={ctx.hostClient}
        activeTheme={ctx.activeTheme}
        artifactThemeKey={ctx.artifactThemeKey}
        artifactPreviewEnabled={ctx.artifactPreviewEnabled}
        readMedia={ctx.readMedia}
        locale={ctx.locale}
        onSessionDeleted={() => ctx.onCloseView(props.viewId)}
        {...(ctx.onOpenDocument ? { onOpenDocument: ctx.onOpenDocument } : {})}
        {...(ctx.onOpenArtifactCanvas ? { onOpenArtifactCanvas: ctx.onOpenArtifactCanvas } : {})}
        {...(ctx.fileBrowseRoot !== undefined ? { fileBrowseRoot: ctx.fileBrowseRoot } : {})}
      />
    );
  }
  return <DockToolSurface view={view} />;
}

export function resolveViewTitle(args: {
  view: WorkspaceView;
  sessions: readonly SessionListItemUi[];
  locale: 'zh-CN' | 'en';
}): string {
  const { view } = args;
  if (view.title) return view.title;
  if (view.kind === 'session') {
    const session = args.sessions.find((item) => item.id === view.sessionId);
    return session?.name ?? (args.locale === 'zh-CN' ? '会话' : 'Session');
  }
  const label = TOOL_LABEL[view.kind];
  if (!label) return view.kind;
  return args.locale === 'zh-CN' ? label.zh : label.en;
}
