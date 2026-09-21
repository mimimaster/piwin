import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { ThemeManifest, WebElementPickResult } from '@piwin/contracts';
import { ArtifactCanvasPanel } from '../../artifact-canvas-panel.js';
import type { ArtifactCanvasTarget } from '../../artifact-canvas-model.js';
import { mapThemeToArtifactVariables } from '../../artifact-theme-map.js';
import {
  activeDocumentContent,
  activeDocumentFilePath,
  type ActiveDocument,
  type ActiveDocumentMedia,
} from '../../active-document.js';
import {
  DeferredBrowserSessionPanel,
  DeferredChangesPanel,
  DeferredDocPreviewPanel,
  DeferredMediaDocPreview,
  DeferredSurfaceBoundary,
} from '../../deferred-desktop-surfaces.js';
import { FileDiffInspector } from '../../file-diff-inspector.js';
import type { HostClient } from '../../host-client.js';
import type { HostRequestAdapters } from '../../host-request-adapters.js';
import { RemoteUnavailableSurface } from '../../remote-unavailable-surface.js';
import type { WorkspaceView } from './types.js';

export type DockToolHosts = {
  hostClient: HostClient;
  locale: 'zh-CN' | 'en';
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  projectPath: string | null;
  requestGit: HostRequestAdapters['requestGit'];
  addWebElement: (pick: WebElementPickResult) => void;
  artifactTarget: ArtifactCanvasTarget | null;
  onInsertCanvasProposal: (text: string) => void;
  activeDocument: ActiveDocument | null;
  activeMedia?: ActiveDocumentMedia;
  inspectorDiff: { relativePath: string } | null;
};

const DockToolHostsContext = createContext<DockToolHosts | null>(null);

export function DockToolHostsProvider(props: { value: DockToolHosts; children: ReactNode }): ReactElement {
  return <DockToolHostsContext.Provider value={props.value}>{props.children}</DockToolHostsContext.Provider>;
}

export function useDockToolHosts(): DockToolHosts | null {
  return useContext(DockToolHostsContext);
}

function DockToolFallback(props: { locale: 'zh-CN' | 'en'; label: string }): ReactElement {
  return (
    <div className="docking-tool-placeholder" role="note">
      <b>{props.label}</b>
      <span>
        {props.locale === 'zh-CN' ? '工具宿主尚未接入当前窗口。' : 'This tool host is not available in this window.'}
      </span>
    </div>
  );
}

/**
 * Docked Document tool surface.
 *
 * Forwards the whole document state, failure reason included: a docked panel
 * that only knows "unavailable" reports every cause as the generic
 * "Preview unavailable" and hides which file/why, while the same document in
 * the inspector path explains itself.
 */
function DockDocSurface(props: { hosts: DockToolHosts }): ReactElement {
  const { hosts } = props;
  if (hosts.inspectorDiff && hosts.projectPath) {
    return (
      <FileDiffInspector
        projectPath={hosts.projectPath}
        path={hosts.inspectorDiff.relativePath}
        request={hosts.requestGit as never}
      />
    );
  }
  if (hosts.activeMedia) {
    return (
      <DeferredSurfaceBoundary label="Media">
        <DeferredMediaDocPreview
          {...(hosts.activeDocument?.title ? { title: hosts.activeDocument.title } : {})}
          {...(hosts.activeDocument?.displayRef ? { displayRef: hosts.activeDocument.displayRef } : {})}
          media={hosts.activeMedia}
          locale={hosts.locale}
        />
      </DeferredSurfaceBoundary>
    );
  }
  return (
    <DeferredSurfaceBoundary label="Document">
      <DeferredDocPreviewPanel
        {...(hosts.activeDocument?.title ? { title: hosts.activeDocument.title } : {})}
        {...(activeDocumentContent(hosts.activeDocument)
          ? { content: activeDocumentContent(hosts.activeDocument) }
          : {})}
        {...(activeDocumentFilePath(hosts.activeDocument)
          ? { filePath: activeDocumentFilePath(hosts.activeDocument) }
          : {})}
        artifactTheme={mapThemeToArtifactVariables(hosts.activeTheme)}
        {...(hosts.activeDocument?.status ? { status: hosts.activeDocument.status } : {})}
        {...(hosts.activeDocument?.displayRef ? { displayRef: hosts.activeDocument.displayRef } : {})}
        {...(hosts.projectPath ? { projectPath: hosts.projectPath } : {})}
        {...(hosts.activeDocument?.status === 'ready'
          ? {
              provenance: hosts.activeDocument.provenance,
              ...(hosts.activeDocument.warning ? { warning: hosts.activeDocument.warning } : {}),
              ...(hosts.activeDocument.skillId ? { skillId: hosts.activeDocument.skillId } : {}),
              ...(hosts.activeDocument.skillSource
                ? { skillSource: hosts.activeDocument.skillSource }
                : {}),
              ...(hosts.activeDocument.readOnly ? { readOnly: hosts.activeDocument.readOnly } : {}),
            }
          : {})}
        {...(hosts.activeDocument?.status === 'unavailable'
          ? {
              unavailableReason: hosts.activeDocument.reason,
              ...(hosts.activeDocument.suggestion
                ? { suggestion: hosts.activeDocument.suggestion }
                : {}),
              ...(hosts.activeDocument.byteSize !== undefined
                ? { byteSize: hosts.activeDocument.byteSize }
                : {}),
              ...(hosts.activeDocument.maxBytes !== undefined
                ? { maxBytes: hosts.activeDocument.maxBytes }
                : {}),
            }
          : {})}
        locale={hosts.locale}
      />
    </DeferredSurfaceBoundary>
  );
}

export function DockToolSurface(props: { view: WorkspaceView }): ReactElement {
  const hosts = useDockToolHosts();
  const locale = hosts?.locale ?? 'en';
  if (!hosts) {
    return <DockToolFallback locale={locale} label={props.view.kind} />;
  }
  if (props.view.kind === 'browser') {
    if (!hosts.hostClient.supportsCommand('browser/start')) {
      return <RemoteUnavailableSurface feature="browser" locale={locale} />;
    }
    return (
      <DeferredSurfaceBoundary label="Browser">
        <DeferredBrowserSessionPanel hostClient={hosts.hostClient} onAddWebElement={hosts.addWebElement} />
      </DeferredSurfaceBoundary>
    );
  }
  if (props.view.kind === 'changes') {
    return (
      <DeferredSurfaceBoundary label="Changes">
        <DeferredChangesPanel
          projectPath={hosts.projectPath}
          request={hosts.requestGit as never}
          locale={locale}
        />
      </DeferredSurfaceBoundary>
    );
  }
  if (props.view.kind === 'canvas') {
    return (
      <ArtifactCanvasPanel
        activeTarget={hosts.artifactTarget}
        artifactTheme={mapThemeToArtifactVariables(hosts.activeTheme)}
        artifactThemeKey={hosts.artifactThemeKey}
        onInsertProposal={(proposal) => hosts.onInsertCanvasProposal(proposal.text)}
      />
    );
  }
  if (props.view.kind === 'doc') {
    return <DockDocSurface hosts={hosts} />;
  }
  return <DockToolFallback locale={locale} label={props.view.kind} />;
}
