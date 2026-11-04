import type { HostPush, KnowledgeContextRef } from '@piwin/contracts';
import type { ReactElement } from 'react';
import { EmptyState, Spinner } from '@piwin/ui-kit';
import { useRef, useState } from 'react';
import { TranscriptSelectionToolbar } from '../../conversation/transcript-selection-toolbar.js';
import { useDesktopContextMenu } from '../../context-menu/index.js';
import { IconArrowLeft } from '@piwin/ui-kit';
import { EnhancedMarkdownView } from '../../markdown/EnhancedMarkdownView.js';
import type { KnowledgeBasesRequest } from '../use-knowledge-bases.js';
import { KnowledgeAssistPanel } from './KnowledgeAssistPanel.js';
import {
  knowledgeContextRefFromAnchor,
  knowledgeSelectionAnchorFromRange,
} from './knowledge-selection-anchor.js';
import {
  readKnowledgeReaderReturn,
  rememberKnowledgeReaderReturn,
} from './knowledge-reader-return.js';
import type { KnowledgeDocumentReadState } from './use-knowledge-documents.js';

export type KnowledgeReaderTarget = {
  baseId: string;
  baseName: string;
  relativePath: string;
  title: string;
  indexed: boolean;
  chunkCount: number;
};

export type KnowledgeReaderViewProps = {
  locale: 'zh-CN' | 'en';
  target: KnowledgeReaderTarget;
  state: KnowledgeDocumentReadState;
  onBack: () => void;
  request?: KnowledgeBasesRequest | undefined;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  projectPath?: string | null | undefined;
  onDraftFlashcards?: ((scope: {
    kind: 'selection';
    text: string;
    sourceFile: string;
    sourceLine?: number;
  }) => void) | undefined;
};

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

function extensionOf(relativePath: string): string {
  const file = relativePath.split('/').pop() ?? relativePath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
}

/**
 * Reading is a first-class surface: the document is shown as text the Host
 * actually returned, with the loaded window stated. There is no "full text"
 * claim while more lines exist.
 */
export function KnowledgeReaderView(props: KnowledgeReaderViewProps): ReactElement {
  const t = (en: string, cn: string) => (props.locale === 'zh-CN' ? cn : en);
  const { state, target } = props;
  const doc = state.doc;
  const extension = extensionOf(target.relativePath);
  const asMarkdown = MARKDOWN_EXTENSIONS.has(extension);
  const bodyRef = useRef<HTMLElement | null>(null);
  const contextMenu = useDesktopContextMenu();
  const windowStartLine = doc?.startLine ?? 1;
  const remembered = readKnowledgeReaderReturn();
  const sameDocument =
    remembered?.baseId === target.baseId && remembered.relativePath === target.relativePath;
  const [assistSessionId, setAssistSessionId] = useState<string | null>(
    sameDocument ? (remembered?.assistSessionId ?? null) : null,
  );
  const [assistOpen, setAssistOpen] = useState(
    Boolean(sameDocument && remembered?.assistSessionId),
  );
  const [pendingRef, setPendingRef] = useState<KnowledgeContextRef | null>(null);

  const persistReturn = (sessionId: string | null): void => {
    rememberKnowledgeReaderReturn({
      baseId: target.baseId,
      relativePath: target.relativePath,
      title: target.title,
      indexed: target.indexed,
      chunkCount: target.chunkCount,
      ...(sessionId ? { assistSessionId: sessionId } : {}),
    });
  };

  const pageRef = (): KnowledgeContextRef => ({
    kind: 'knowledge-selection',
    baseId: target.baseId,
    scope: 'page',
    relativePath: target.relativePath,
    lineStart: windowStartLine,
    ...(doc ? { lineEnd: doc.endLine } : {}),
    snapshotText: state.text.trim().slice(0, 4000),
    label: target.relativePath,
  });

  const selectionToRef = (range: Range, text: string): KnowledgeContextRef | null => {
    const anchor = knowledgeSelectionAnchorFromRange(range, {
      baseId: target.baseId,
      relativePath: target.relativePath,
      windowStartLine,
    });
    if (!anchor) return null;
    const snapshot = text.trim();
    return knowledgeContextRefFromAnchor(
      snapshot.length > 0 ? { ...anchor, snapshotText: snapshot } : anchor,
    );
  };

  const openAssist = (ref: KnowledgeContextRef): void => {
    persistReturn(assistSessionId);
    setPendingRef(ref);
    setAssistOpen(true);
  };

  const citePage = (): void => {
    if (!contextMenu || !state.text.trim()) return;
    persistReturn(assistSessionId);
    contextMenu.dispatchers.addToChat(pageRef());
    contextMenu.dispatchers.focusComposer();
  };

  return (
    <div
      className={`kw-section kw-reader${assistOpen ? ' kw-reader-with-assist' : ''}`}
      data-testid="knowledge-reader"
    >
      <div className="kw-reader-main">
      <nav className="kw-breadcrumb" aria-label={t('Breadcrumb', '面包屑')}>
        <button
          type="button"
          className="kw-breadcrumb-back"
          onClick={props.onBack}
          data-testid="knowledge-reader-back"
        >
          <IconArrowLeft width={14} height={14} aria-hidden="true" />
          <span>{t('Materials', '资料库')}</span>
        </button>
        <span className="kw-breadcrumb-sep">/</span>
        <span className="kw-breadcrumb-item">{target.baseName}</span>
        <span className="kw-breadcrumb-sep">/</span>
        <span className="kw-breadcrumb-current">{target.title}</span>
      </nav>

      <header className="kw-reader-head">
        <h1 className="kw-reader-title">{target.title}</h1>
        <div className="kw-reader-meta">
          <span className="kw-doc-path">{target.relativePath}</span>
          {target.indexed ? (
            <span className="kw-chip is-ok">
              {t(`${target.chunkCount} slices indexed`, `已索引 ${target.chunkCount} 片`)}
            </span>
          ) : (
            <span className="kw-chip is-muted" data-testid="knowledge-reader-unindexed">
              {t('Readable · not indexed', '可读 · 尚未索引')}
            </span>
          )}
          <button
            type="button"
            className="kw-btn kw-btn-sm"
            onClick={citePage}
            data-testid="knowledge-reader-cite-page"
          >
            {t('Add page to chat', '引用本页')}
          </button>
          {props.request ? (
            <button
              type="button"
              className="kw-btn kw-btn-sm"
              onClick={() => {
                if (!state.text.trim()) return;
                openAssist(pageRef());
              }}
              data-testid="knowledge-reader-ask-ai"
            >
              {t('Ask AI', '问 AI')}
            </button>
          ) : null}
        </div>
      </header>

      {state.error ? (
        <EmptyState
          title={t('This document could not be opened', '这份文档没能打开')}
          description={state.error}
          size="compact"
          testId="knowledge-reader-error"
        />
      ) : state.loading && !doc ? (
        <div className="kw-loading" data-testid="knowledge-reader-loading">
          <Spinner label={t('Opening document…', '正在打开文档…')} />
        </div>
      ) : (
        <>
          <article className="kw-reader-body" data-testid="knowledge-reader-body" ref={bodyRef}>
            {asMarkdown ? (
              <EnhancedMarkdownView text={state.text} docTitle={target.title} />
            ) : (
              <pre className="kw-reader-code">
                <code>
                  {state.text.split('\n').map((line, index) => (
                    // Window-relative ids, matching what the Markdown renderer stamps.
                    <span key={index} data-line-id={`line-${index + 1}-t`}>
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
            )}
            <TranscriptSelectionToolbar
              containerRef={bodyRef}
              locale={props.locale}
              copyable
              toContextRef={(range, text) => {
                persistReturn(assistSessionId);
                return selectionToRef(range, text);
              }}
              {...(props.request
                ? {
                    onAskAi: (range: Range, text: string) => {
                      const ref = selectionToRef(range, text);
                      if (ref) openAssist(ref);
                    },
                  }
                : {})}
              {...(props.onDraftFlashcards
                ? {
                    onGenerateFlashcard: (range: Range, text: string) => {
                      const ref = selectionToRef(range, text);
                      props.onDraftFlashcards?.({
                        kind: 'selection',
                        text,
                        sourceFile: props.target.relativePath,
                        ...(ref?.lineStart ? { sourceLine: ref.lineStart } : {}),
                      });
                    },
                  }
                : {})}
            />
          </article>
          <footer className="kw-reader-footer">
            <span data-testid="knowledge-reader-progress">
              {doc
                ? t(
                    `Read to line ${doc.endLine} of ${doc.totalLines}`,
                    `已读到第 ${doc.endLine} 行，共 ${doc.totalLines} 行`,
                  )
                : ''}
            </span>
            {state.canLoadMore ? (
              <button
                type="button"
                className="kw-btn kw-btn-sm"
                disabled={state.loadingMore}
                onClick={() => void state.loadMore()}
                data-testid="knowledge-reader-load-more"
              >
                {state.loadingMore ? t('Loading…', '加载中…') : t('Keep reading', '继续阅读')}
              </button>
            ) : null}
          </footer>
          {doc?.truncatedChars ? (
            <p className="kw-reader-hint" data-testid="knowledge-reader-truncated">
              {t(
                'This window hit the Host character cap; continue reading for the rest.',
                '这一段达到 Host 的字符上限，继续阅读可以拿到后面的内容。',
              )}
            </p>
          ) : null}
        </>
      )}
      </div>
      {assistOpen && props.request ? (
        <KnowledgeAssistPanel
          locale={props.locale}
          request={props.request}
          baseId={target.baseId}
          documentTitle={target.title}
          sessionId={assistSessionId}
          onSessionId={(sessionId) => {
            setAssistSessionId(sessionId);
            persistReturn(sessionId);
          }}
          pendingRef={pendingRef}
          onConsumedPendingRef={() => setPendingRef(null)}
          {...(props.subscribePush ? { subscribePush: props.subscribePush } : {})}
          {...(props.subscribeConnected ? { subscribeConnected: props.subscribeConnected } : {})}
          {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
        />
      ) : null}
    </div>
  );
}
