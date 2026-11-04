import type { ReactElement } from 'react';
import type {
  HostPush,
  KnowledgeBaseSummary,
  KnowledgeDocumentEntry,
  KnowledgeDocumentListResult,
  KnowledgeDocumentReadResult,
} from '@piwin/contracts';
import type { KnowledgeBasesRequest } from '../use-knowledge-bases.js';
import { KnowledgeDocumentsSection } from './KnowledgeDocumentsSection.js';
import { KnowledgeMaterialsSection } from './KnowledgeMaterialsSection.js';
import { KnowledgeReaderView, type KnowledgeReaderViewProps } from './KnowledgeReaderView.js';

/** The one document the reader is showing, from the list row that opened it. */
export type OpenDocument = {
  relativePath: string;
  title: string;
  indexed: boolean;
  chunkCount: number;
};

export type KnowledgeMaterialsPaneProps = {
  locale: 'zh-CN' | 'en';
  /** False when the Host cannot page documents; the pane falls back to sources. */
  documentsEnabled: boolean;
  sources: readonly KnowledgeBaseSummary[];
  knowledgeLoading: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  activeBaseId: string | null;
  onSelectBase: (baseId: string) => void;
  documents: {
    items: KnowledgeDocumentEntry[];
    total: number;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
  };
  openDocument: OpenDocument | null;
  onOpenDocument: (entry: OpenDocument) => void;
  onCloseDocument: () => void;
  reader: {
    doc: KnowledgeDocumentReadResult | null;
    text: string;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    canLoadMore: boolean;
    loadMore: () => Promise<void>;
  };
  onAddFolder: () => void;
  onProduceFlashcards: (folderPath: string) => void;
  onDraftFlashcards?: KnowledgeReaderViewProps['onDraftFlashcards'];
  generating: boolean;
  request?: KnowledgeBasesRequest | undefined;
  subscribePush?: ((listener: (push: HostPush) => void) => () => void) | undefined;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  projectPath?: string | null | undefined;
};

/**
 * The library pane: reader over list over source cards. Keeping the three-way
 * choice here is what lets the shell stay a shell — it decides which section is
 * open, not how a section degrades.
 */
export function KnowledgeMaterialsPane(props: KnowledgeMaterialsPaneProps): ReactElement {
  const activeBase = props.sources.find((base) => base.id === props.activeBaseId) ?? null;

  if (props.documentsEnabled && props.openDocument) {
    return (
      <KnowledgeReaderView
        locale={props.locale}
        target={{
          baseId: activeBase?.id ?? '',
          baseName: activeBase?.name ?? '',
          relativePath: props.openDocument.relativePath,
          title: props.openDocument.title,
          indexed: props.reader.doc?.indexed ?? props.openDocument.indexed,
          chunkCount: props.reader.doc?.chunkCount ?? props.openDocument.chunkCount,
        }}
        state={props.reader}
        onBack={props.onCloseDocument}
        {...(props.request ? { request: props.request } : {})}
        {...(props.subscribePush ? { subscribePush: props.subscribePush } : {})}
        {...(props.subscribeConnected ? { subscribeConnected: props.subscribeConnected } : {})}
        {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
        {...(props.onDraftFlashcards ? { onDraftFlashcards: props.onDraftFlashcards } : {})}
      />
    );
  }

  if (props.documentsEnabled) {
    return (
      <KnowledgeDocumentsSection
        locale={props.locale}
        sources={props.sources}
        selectedBaseId={props.activeBaseId}
        onSelectBase={props.onSelectBase}
        items={props.documents.items}
        total={props.documents.total}
        loading={props.documents.loading}
        loadingMore={props.documents.loadingMore}
        error={props.documents.error}
        hasMore={props.documents.hasMore}
        onLoadMore={() => void props.documents.loadMore()}
        onOpenDocument={(entry) => {
          if (entry.readability !== 'text') return;
          props.onOpenDocument({
            relativePath: entry.relativePath,
            title: entry.title,
            indexed: entry.indexed,
            chunkCount: entry.chunkCount,
          });
        }}
        onAddFolder={props.onAddFolder}
        onProduceFlashcards={props.onProduceFlashcards}
        generating={props.generating}
      />
    );
  }

  return (
    <KnowledgeMaterialsSection
      locale={props.locale}
      sources={props.sources}
      loading={props.knowledgeLoading}
      query={props.query}
      onQueryChange={props.onQueryChange}
      onAddFolder={props.onAddFolder}
      onProduceFlashcards={props.onProduceFlashcards}
      generating={props.generating}
    />
  );
}

/** Shape check for the list response the pane receives. */
export type { KnowledgeDocumentListResult };
