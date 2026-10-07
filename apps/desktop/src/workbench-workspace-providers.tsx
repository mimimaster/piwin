/**
 * The workbench provider stack. One component so `AppWorkbench` stays a
 * composition root instead of a tower of nested providers.
 *
 * Order is load-bearing and unchanged: the shell-wide contexts (locale, host
 * log, local file actions, media reads, desktop context menu, subagent
 * inspector) wrap the workspace-data contexts (subagent stop and review loop,
 * turn changes), and the dock tool hosts are innermost so every tool host sees
 * all of them.
 *
 * Workspace data the tree shares: subagent stop and review loop, knowledge
 * mounts and citation actions, and turn changes (so the transcript's turn cards
 * and the right panel's 本轮变更 view read one index and one focused turn).
 */
import type { ReactElement, ReactNode } from 'react';
import { DesktopContextMenuProvider } from './context-menu';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { DeviceHealthConsentDialog } from './device-health-consent-dialog';
import { HostLogProvider } from './host-log-context';
import type { HostClient } from './host-client';
import { KnowledgeCitationActionsProvider } from './knowledge/knowledge-citation-actions';
import { KnowledgeMountsProvider } from './knowledge/knowledge-mounts-context';
import { LocalFileActionsProvider } from './local-file-actions-context';
import { MediaPreviewReadProvider } from './media-preview-read-context';
import { SubagentInspectorProvider } from './subagent-inspector-context';
import {
  SubagentReviewLoopProvider,
  type SubagentReviewLoopBinding,
} from './subagent-review-loop-context';
import { SubagentStopProvider } from './subagent-stop-controller';
import { TurnChangesHostProvider } from './turn-changes/turn-changes-host-provider.js';
import { DockToolHostsProvider } from './workbench/docking/dock-tool-hosts.js';

type MountsValue = Parameters<typeof KnowledgeMountsProvider>[0]['value'];
type CitationActionsValue = Parameters<typeof KnowledgeCitationActionsProvider>[0]['value'];
type StopValue = Parameters<typeof SubagentStopProvider>[0]['value'];

export function WorkbenchWorkspaceProviders(props: {
  locale: Parameters<typeof DesktopLocaleProvider>[0]['locale'];
  onLocaleChange: Parameters<typeof DesktopLocaleProvider>[0]['onLocaleChange'];
  hostLogStore: Parameters<typeof HostLogProvider>[0]['store'];
  requestLocalFile: Parameters<typeof LocalFileActionsProvider>[0]['request'];
  mediaPreviewSessionId: Parameters<typeof MediaPreviewReadProvider>[0]['sessionId'];
  readMedia: Parameters<typeof MediaPreviewReadProvider>[0]['readMedia'];
  desktopContextMenuValue: Parameters<typeof DesktopContextMenuProvider>[0]['value'];
  inspectorToggle: Parameters<typeof SubagentInspectorProvider>[0]['toggle'];
  inspectorPanel: Parameters<typeof SubagentInspectorProvider>[0]['panel'];
  dockToolHosts: Parameters<typeof DockToolHostsProvider>[0]['value'];
  hostClient: HostClient;
  subagentStop: StopValue;
  reviewLoop: SubagentReviewLoopBinding;
  knowledgeMounts: MountsValue;
  knowledgeCitationActions: CitationActionsValue;
  onOpenReview: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <DesktopLocaleProvider locale={props.locale} onLocaleChange={props.onLocaleChange}>
      <HostLogProvider store={props.hostLogStore}>
        <LocalFileActionsProvider request={props.requestLocalFile}>
          <MediaPreviewReadProvider
            sessionId={props.mediaPreviewSessionId}
            readMedia={props.readMedia}
          >
            <DesktopContextMenuProvider value={props.desktopContextMenuValue}>
              <SubagentInspectorProvider
                toggle={props.inspectorToggle}
                panel={props.inspectorPanel}
              >
                <SubagentStopProvider value={props.subagentStop}>
                  {props.subagentStop?.dialog}
                  <DeviceHealthConsentDialog />
                  <SubagentReviewLoopProvider value={props.reviewLoop}>
                    <TurnChangesHostProvider
                      hostClient={props.hostClient}
                      onOpenReview={props.onOpenReview}
                    >
                      <KnowledgeMountsProvider value={props.knowledgeMounts}>
                        <KnowledgeCitationActionsProvider value={props.knowledgeCitationActions}>
                          <DockToolHostsProvider value={props.dockToolHosts}>
                            {props.children}
                          </DockToolHostsProvider>
                        </KnowledgeCitationActionsProvider>
                      </KnowledgeMountsProvider>
                    </TurnChangesHostProvider>
                  </SubagentReviewLoopProvider>
                </SubagentStopProvider>
              </SubagentInspectorProvider>
            </DesktopContextMenuProvider>
          </MediaPreviewReadProvider>
        </LocalFileActionsProvider>
      </HostLogProvider>
    </DesktopLocaleProvider>
  );
}
