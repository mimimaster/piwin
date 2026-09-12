/** Mock `flashcards/*` Host: in-memory decks so the study page works offline. */
import type {
  FlashcardCreateInput,
  FlashcardItem,
  FlashcardStudyCatalogPage,
  GenerationJob,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';
import type { MockHostBackend } from './host-client-mock.js';

type MockFlashcardState = {
  cards: FlashcardItem[];
  nextId: number;
};

const states = new WeakMap<MockHostBackend, MockFlashcardState>();

function card(
  id: string,
  deck: string,
  front: string,
  back: string,
): FlashcardItem {
  return {
    id,
    model: 'basic',
    deck,
    front,
    back,
    createdAt: '2026-09-11T02:00:00.000Z',
  };
}

function seedCards(): FlashcardItem[] {
  return [
    card(
      'mock-card-1',
      'piwin 核心工程与规范',
      'AGENTS.md 规范中，单个源文件的代码行数硬限制与主动拆分警戒线分别是多少？',
      '硬限制 1000 行；主动警戒线约 400 行，接近时即须规划按职责拆分。',
    ),
    card(
      'mock-card-2',
      'piwin 核心工程与规范',
      'Dual Mode Host 架构中，UI 层如何与 Pi 执行核心解耦？',
      '通过统一的 SessionBackend 契约，PiSdkAdapter 与 PiRpcAdapter 同构实现，UI 永不直接依赖 Pi。',
    ),
    card(
      'mock-card-3',
      'piwin 核心工程与规范',
      'contracts 包在依赖图中的位置是什么？',
      '叶子包：不依赖任何其他 @piwin/* 包，跨包类型都定义在这里。',
    ),
    card(
      'mock-card-4',
      'LLM-Wiki 与知识工程',
      '传统 RAG 与 LLM-Wiki 的本质差异是什么？',
      'RAG 只对原文做切片检索；LLM-Wiki 把生肉资料提炼、去重、交叉验证后沉淀为有严密定义的概念词条。',
    ),
    card(
      'mock-card-5',
      'LLM-Wiki 与知识工程',
      'FSRS 相比传统 SM-2 的核心优势是什么？',
      '基于记忆留存率建模，能按目标留存率（如 90%）推算最佳复习间隔，而非固定倍率递增。',
    ),
  ];
}

function stateFor(host: MockHostBackend): MockFlashcardState {
  let state = states.get(host);
  if (!state) {
    state = { cards: seedCards(), nextId: 6 };
    states.set(host, state);
  }
  return state;
}

function ok(id: string, command: string, data: unknown): HostResponse {
  return { id, type: 'response', command, success: true, data };
}

/** Deterministic split so each deck shows a different due/new mix. */
function schedulingFor(cards: readonly FlashcardItem[]): { due: number; fresh: number } {
  const due = cards.filter((_, index) => index % 2 === 0).length;
  return { due, fresh: Math.max(0, cards.length - due - 1) };
}

/** Generation jobs are keyed by folder, mirroring the real doccards registry. */
const generationJobs = new WeakMap<MockHostBackend, Map<string, GenerationJob>>();

function jobsFor(host: MockHostBackend): Map<string, GenerationJob> {
  let jobs = generationJobs.get(host);
  if (!jobs) {
    jobs = new Map();
    generationJobs.set(host, jobs);
  }
  return jobs;
}

export async function handleMockFlashcardCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  const state = stateFor(host);
  switch (command.type) {
    case 'doccards/generate': {
      const folderPath = (command as { folderPath: string }).folderPath;
      const deck = folderPath.split('/').filter(Boolean).pop() ?? 'General';
      const created: FlashcardItem[] = [
        card(
          `mock-card-${state.nextId}`,
          deck,
          `「${deck}」中最关键的结论是什么？`,
          '由 mock Host 从该信源的切片提炼；真实 Host 下这里是模型基于检索内容生成的问答。',
        ),
        card(
          `mock-card-${state.nextId + 1}`,
          deck,
          `「${deck}」里有哪些约束容易被忽略？`,
          '同上——mock 数据，用于演示「信源 → 闪卡」这一跳是通的。',
        ),
      ];
      state.nextId += created.length;
      state.cards = [...created, ...state.cards];
      jobsFor(host).set(folderPath, {
        id: `mock-gen-${Date.now()}`,
        folderKey: folderPath,
        folderPath,
        workspaceName: deck,
        includeFiles: [],
        status: 'COMPLETED',
        created: created.length,
        createdCardIds: created.map((item) => item.id),
        completedAt: new Date().toISOString(),
      });
      return ok(id, command.type, { started: true });
    }
    case 'doccards/generation-status': {
      const folderPath = (command as { folderPath: string }).folderPath;
      return ok(id, command.type, { job: jobsFor(host).get(folderPath) ?? null });
    }
    case 'flashcards/decks': {
      const decks = [...new Set(state.cards.map((item) => item.deck))];
      return ok(id, command.type, { decks });
    }
    case 'flashcards/list':
      return ok(id, command.type, { cards: state.cards });
    case 'flashcards/create': {
      const input = command.input as FlashcardCreateInput;
      const created: FlashcardItem = {
        id: `mock-card-${state.nextId}`,
        model: input.model === 'cloze' ? 'cloze' : 'basic',
        deck: input.deck || 'General',
        ...(input.model === 'cloze'
          ? { text: (input as { text?: string }).text ?? '' }
          : {
              front: (input as { front?: string }).front ?? '',
              back: (input as { back?: string }).back ?? '',
            }),
        createdAt: new Date().toISOString(),
      };
      state.nextId += 1;
      state.cards = [created, ...state.cards];
      return ok(id, command.type, { card: created });
    }
    case 'flashcards/delete': {
      const cardId = (command as { cardId: string }).cardId;
      state.cards = state.cards.filter((item) => item.id !== cardId);
      return ok(id, command.type, { deleted: true, cardId });
    }
    case 'flashcards/study/catalog': {
      const scope = (command as { scopeFilter?: { kind: string; deck?: string } }).scopeFilter;
      const scoped =
        scope?.kind === 'deck' && scope.deck
          ? state.cards.filter((item) => item.deck === scope.deck)
          : state.cards;
      const counts = schedulingFor(scoped);
      const page: FlashcardStudyCatalogPage = {
        tiles: scoped.map((item) => ({
          kind: 'single' as const,
          id: item.id,
          count: 1,
          preview: item.front ?? item.text ?? '',
          deck: item.deck,
        })),
        dueCount: counts.due,
        newCount: counts.fresh,
        unfinishedRounds: [],
      };
      return ok(id, command.type, page);
    }
    default:
      return null;
  }
}
