import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { generationProgress, ingestionProgress } from '../../doccards-progress.js';
import { DocCardsProgressRing } from '../../DocCardsProgressRing.js';
import { KnowledgeFileChecklist } from '../../knowledge/KnowledgeFileChecklist.js';
import { KnowledgeProjectList } from '../../knowledge/KnowledgeProjectList.js';
import { KnowledgeReadyView } from '../../knowledge/KnowledgeReadyView.js';
import { KnowledgeResultView } from '../../knowledge/KnowledgeResultView.js';
import { KnowledgeUnindexedHero } from '../../knowledge/KnowledgeUnindexedHero.js';
import { deriveProjectIndexStatus } from '../../knowledge/knowledge-selection.js';
import type { useFlashcardsProduce } from './use-flashcards-produce';

type Produce = ReturnType<typeof useFlashcardsProduce>;

/** Knowledge Center produce loop, as a flashcards page — not a sheet. */
export function ProduceStage(props: {
  produce: Produce;
  locale: 'zh-CN' | 'en';
  projectPath?: string | null | undefined;
  onSeeCards: () => void;
  onConfigureEmbedding?: (() => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
}): ReactElement {
  const { produce } = props;
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const stage = produce.view.stage;
  const selectedPath = produce.selectedPath;
  const retrievalLine = produce.isEmbeddingConfigured
    ? t('Search quality: vector + full-text', '检索质量：向量 + 全文')
    : t('Search quality: keyword-only (no embedding)', '检索质量：仅关键词（无向量）');

  return (
    <div className="vault-produce-page" data-testid="flashcards-produce">
      <div className="knowledge-master-detail-layout">
        <KnowledgeProjectList
          folders={produce.folders}
          selectedPath={selectedPath}
          activeProjectPath={props.projectPath ?? null}
          projectStats={
            selectedPath
              ? {
                  [selectedPath]: {
                    status: deriveProjectIndexStatus({
                      stage,
                      readyCount: produce.readyCount,
                      scannedCount: produce.scannedFiles.length,
                    }),
                    fileCount:
                      produce.readyCount > 0 ? produce.readyCount : produce.scannedFiles.length,
                    cardCount: produce.folderCardCount,
                  },
                }
              : undefined
          }
          onSelectProject={produce.selectFolder}
          onMountFolder={produce.mountFolder}
        />

        <main className="knowledge-detail-stage">
          {produce.actionError ? (
            <p className="knowledge-action-error" role="alert">
              {produce.actionError}
            </p>
          ) : null}

          {!selectedPath || stage === 'pick-folder' ? (
            <KnowledgeUnindexedHero
              folderPath=""
              folderName=""
              scannedFiles={[]}
              unsupportedFiles={[]}
              indexingJob={null}
              busy={produce.busy}
              empty
              isEmbeddingConfigured={produce.isEmbeddingConfigured}
              onStartIndexing={() => undefined}
              onRescan={() => undefined}
              onPickFolder={() => void produce.pickFolder()}
              {...(produce.useProject ? { onUseCurrentProject: produce.useProject } : {})}
              {...(props.onConfigureEmbedding
                ? { onConfigureEmbedding: props.onConfigureEmbedding }
                : {})}
            />
          ) : stage === 'select-files' || stage === 'indexing' ? (
            <>
              {stage === 'indexing' && produce.indexingJob ? (
                <DocCardsProgressRing
                  progress={ingestionProgress(produce.indexingJob)}
                  locale={props.locale}
                />
              ) : null}
              <KnowledgeFileChecklist
                files={produce.scannedFiles}
                unsupported={produce.unsupportedFiles}
                selected={produce.selectedSupported}
                documents={produce.documents}
                disabled={produce.busy || stage === 'indexing'}
                onChange={produce.setSelectedSupported}
              />
              <KnowledgeUnindexedHero
                folderPath={selectedPath}
                folderName={produce.selectedName}
                scannedFiles={produce.scannedFiles}
                unsupportedFiles={produce.unsupportedFiles}
                indexingJob={produce.indexingJob}
                busy={produce.busy}
                isEmbeddingConfigured={produce.isEmbeddingConfigured}
                onStartIndexing={() => void produce.startIndex()}
                onRescan={() => void produce.reloadFolder()}
                onPickFolder={() => void produce.pickFolder()}
                {...(props.onConfigureEmbedding
                  ? { onConfigureEmbedding: props.onConfigureEmbedding }
                  : {})}
              />
            </>
          ) : stage === 'ready' || stage === 'generating' ? (
            <>
              {stage === 'generating' && produce.generationJob ? (
                <DocCardsProgressRing
                  progress={generationProgress(produce.generationJob)}
                  locale={props.locale}
                />
              ) : null}
              <KnowledgeReadyView
                folderName={produce.selectedName}
                topic={produce.topic}
                onTopicChange={produce.setTopic}
                onGenerate={() => void produce.startGenerate()}
                generateEnabled={produce.view.generateEnabled}
                disabledReason={produce.generateReason}
                busy={produce.busy || stage === 'generating'}
                retrievalLine={retrievalLine}
                onBrowseLibrary={props.onSeeCards}
              />
            </>
          ) : stage === 'result' && produce.view.resultKind !== 'none' ? (
            <KnowledgeResultView
              resultKind={produce.view.resultKind}
              created={produce.createdCount}
              skipped={produce.generationJob?.skipped}
              sessionId={produce.generationJob?.sessionId}
              error={produce.generationJob?.error}
              onOpenSession={props.onOpenSession}
              onGenerateAgain={() => void produce.startGenerate()}
              onDismiss={props.onSeeCards}
              onBrowseLibrary={props.onSeeCards}
            />
          ) : (
            <KnowledgeUnindexedHero
              folderPath={selectedPath}
              folderName={produce.selectedName}
              scannedFiles={produce.scannedFiles}
              unsupportedFiles={produce.unsupportedFiles}
              indexingJob={produce.indexingJob}
              busy={produce.busy}
              isEmbeddingConfigured={produce.isEmbeddingConfigured}
              onStartIndexing={() => void produce.startIndex()}
              onRescan={() => void produce.reloadFolder()}
              onPickFolder={() => void produce.pickFolder()}
              {...(props.onConfigureEmbedding
                ? { onConfigureEmbedding: props.onConfigureEmbedding }
                : {})}
            />
          )}

          {selectedPath ? (
            <div className="vault-produce-forget">
              <Button
                variant="ghost"
                size="compact"
                disabled={produce.busy}
                onClick={() => void produce.forgetFolder()}
              >
                {t('Forget this folder’s cards', '忘掉此文件夹的卡')}
              </Button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
