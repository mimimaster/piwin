/**
 * Knowledge Center — four sub-tabs visible from the right panel directory.
 *
 * - Repo Wiki  → NotesPanel (RAG over repo / project notes)
 * - 知识卡片   → FlashcardsPanel (spaced-repetition deck review)
 * - 文档卡片   → DocCardsPanel (folder RAG → flashcard generation)
 *
 * Each sub-tab mounts the existing product panel so the per-tab capabilities
 * (search, host commands, settings integrations) stay identical to the
 * dedicated inspector entries. This panel only changes the surface so the
 * knowledge flows are discoverable from a single entry.
 */
import { useCallback, useState, type ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { NotesPanel } from './NotesPanel';
import { FlashcardsPanel } from './FlashcardsPanel';
import { DocCardsPanel } from './DocCardsPanel';

/**
 * Commands used across the three knowledge surfaces. Hand-rolled union so
 * the request callback surfaces every knowledge-related host command without
 * pulling in code from the individual panel files.
 */
type NotesCommand = {
  type: 'notes/list' | 'notes/index' | 'notes/search' | 'notes/delete' | 'notes/reindex';
  projectPath?: string;
  query?: string;
  noteId?: string;
  limit?: number;
};
type FlashcardsCommand = {
  type:
    | 'flashcards/list'
    | 'flashcards/export'
    | 'flashcards/import'
    | 'flashcards/decks'
    | 'flashcards/review-next'
    | 'flashcards/rate';
  deck?: string;
  format?: 'tsv' | 'markdown';
  cardId?: string;
  rating?: 0 | 1 | 2 | 3;
};
type DocCardsCommand =
  | { type: 'doccards/scan-folder'; folderPath: string }
  | { type: 'doccards/index-folder'; folderPath: string; includeFiles?: string[] }
  | { type: 'doccards/retrieve'; folderPath: string; query: string; limit?: number }
  | { type: 'doccards/list-by-folder'; folderPath: string }
  | { type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { type: 'doccards/forget-folder'; folderPath: string }
  | { type: 'doccards/open-source'; cardId: string }
  | { type: 'doccards/index-status'; folderPath: string }
  | { type: 'doccards/generate'; folderPath: string; includeFiles?: string[]; topic?: string }
  | { type: 'doccards/generation-status'; folderPath: string }
  | { type: 'config/get' };
type ConfigCommand = { type: 'config/get' | 'config/set'; config?: unknown };
type KnowledgeCommand = NotesCommand | FlashcardsCommand | DocCardsCommand | ConfigCommand;

type KnowledgeSubTab = 'wiki' | 'cards' | 'doccards';const SUB_TABS = [
  {
    id: 'wiki',
    labelEn: 'Repo Wiki',
    labelZh: 'Repo Wiki',
    testid: 'knowledge-tab-wiki',
    descriptionEn: 'RAG index over your project notes',
    descriptionZh: '项目笔记的 RAG 检索',
  },
  {
    id: 'cards',
    labelEn: 'Flashcards',
    labelZh: '知识卡片',
    testid: 'knowledge-tab-cards',
    descriptionEn: 'Spaced-repetition review decks',
    descriptionZh: '间隔重复卡组',
  },
  {
    id: 'doccards',
    labelEn: 'Doc Cards',
    labelZh: '文档卡片',
    testid: 'knowledge-tab-doccards',
    descriptionEn: 'Generate flashcards from a document folder',
    descriptionZh: '从文档文件夹生成闪卡',
  },
] as const satisfies ReadonlyArray<{
  id: KnowledgeSubTab;
  labelEn: string;
  labelZh: string;
  testid: string;
  descriptionEn: string;
  descriptionZh: string;
}>;

export type KnowledgeCenterPanelProps = {
  /** Currently trusted project, passed to knowledge panels. */
  projectPath: string | null;
  /** Single RPC bridge that routes knowledge-host commands. */
  request: (command: KnowledgeCommand) => Promise<HostResponse>;
  onOpenSession?: (sessionId: string) => void;
};

export function KnowledgeCenterPanel(
  props: KnowledgeCenterPanelProps,
): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [subTab, setSubTab] = useState<KnowledgeSubTab>('wiki');

  // Stable identities: panels reload via useEffect([request]) — a fresh
  // closure per render would re-fire full loads.
  const request = useCallback(
    (command: KnowledgeCommand) => props.request(command),
    [props.request],
  );
  // Per-surface narrowed callbacks keep each panel's typed request contract.
  const notesRequest = useCallback(
    (command: NotesCommand) => props.request(command),
    [props.request],
  );
  const cardsRequest = useCallback(
    (command: FlashcardsCommand) => props.request(command),
    [props.request],
  );
  const docCardsRequest = useCallback(
    (command: DocCardsCommand) => props.request(command),
    [props.request],
  );

  const current: (typeof SUB_TABS)[number] = SUB_TABS.find((t) => t.id === subTab) ?? SUB_TABS[0];
  const kicker = isZh ? '知识中心' : 'Knowledge Center';
  const subtitle = isZh ? current.descriptionZh : current.descriptionEn;

  return (
    <section
      className="knowledge-center-panel"
      data-testid="knowledge-center-panel"
      data-sub-tab={subTab}
    >
      <header className="knowledge-center-header">
        <span className="knowledge-center-kicker">{kicker}</span>
        <h3 className="knowledge-center-subtitle">{subtitle}</h3>
      </header>
      <Tabs
        value={subTab}
        onValueChange={(next) => {
          if (next === 'wiki' || next === 'cards' || next === 'doccards') {
            setSubTab(next);
          }
        }}
      >
        <TabsList label={isZh ? '知识中心子分类' : 'Knowledge sub-categories'}>
          {SUB_TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              testId={tab.testid}
            >
              {isZh ? tab.labelZh : tab.labelEn}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="wiki" data-testid="knowledge-pane-wiki">
          <div className="right-panel-section">
            <NotesPanel
              request={
                notesRequest as unknown as Parameters<typeof NotesPanel>[0]['request']
              }
            />
          </div>
        </TabsContent>
        <TabsContent value="cards" data-testid="knowledge-pane-cards">
          <div className="right-panel-section">
            <FlashcardsPanel
              request={
                cardsRequest as unknown as Parameters<typeof FlashcardsPanel>[0]['request']
              }
            />
          </div>
        </TabsContent>
        <TabsContent value="doccards" data-testid="knowledge-pane-doccards">
          <div className="right-panel-section">
            <DocCardsPanel
              request={
                docCardsRequest as unknown as Parameters<typeof DocCardsPanel>[0]['request']
              }
              {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Reference the request union so it stays in sync with panel props
          when knowledge surfaces gain commands. (lint-friendly noop) */}
      <span hidden>{request === notesRequest ? 'ok' : 'stale'}</span>
    </section>
  );
}
