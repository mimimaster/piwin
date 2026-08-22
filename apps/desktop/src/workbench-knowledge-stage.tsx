/**
 * Knowledge Center stage overlay (extracted from App.tsx).
 */
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import type { ProjectRecord } from '@piwin/contracts';
import {
  DeferredKnowledgeCenterPanel,
  DeferredSurfaceBoundary,
} from './deferred-desktop-surfaces';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import type { KnowledgeCenterPanelProps } from './KnowledgeCenterPanel';
import { insetComposerText } from './workbench-chrome-assembly';

export type WorkbenchKnowledgeStageProps = {
  locale: DesktopLocale;
  projectPath: string | null;
  recentProjects: ProjectRecord[];
  request: KnowledgeCenterPanelProps['request'];
  onOpenSession: (sessionId: string) => void | Promise<void>;
  onOpenCardsPanel: () => void;
  onConfigureEmbedding: () => void;
  setKnowledgeOpen: Dispatch<SetStateAction<boolean>>;
  setComposer: Dispatch<SetStateAction<string>>;
};

export function WorkbenchKnowledgeStage(
  props: WorkbenchKnowledgeStageProps,
): ReactElement {
  const desktopCopy = getDesktopCopy(props.locale);
  return (
    <section
      className="knowledge-stage"
      data-testid="knowledge-stage"
      aria-label={desktopCopy.knowledgeCenter}
    >
      <DeferredSurfaceBoundary
        label={props.locale === 'zh-CN' ? '正在加载知识中心' : 'Loading knowledge'}
      >
        <DeferredKnowledgeCenterPanel
          projectPath={props.projectPath}
          recentProjects={props.recentProjects}
          request={props.request}
          onClose={() => props.setKnowledgeOpen(false)}
          onOpenSession={(sessionId) => void props.onOpenSession(sessionId)}
          onOpenCardsPanel={props.onOpenCardsPanel}
          onConfigureEmbedding={props.onConfigureEmbedding}
          onSendToChat={(text) => {
            props.setKnowledgeOpen(false);
            props.setComposer((prev) => insetComposerText(prev, text));
            window.setTimeout(() => {
              document
                .querySelector<HTMLTextAreaElement>('[data-testid="composer-input"]')
                ?.focus();
            }, 50);
          }}
        />
      </DeferredSurfaceBoundary>
    </section>
  );
}
