import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type {
  FlashcardItem,
  FlashcardSelectionExplainInput,
  HostResponse,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
} from '@piwin/contracts';
import { createDefaultWalkthroughConfig } from '@piwin/contracts';
import type { CardStore } from '@piwin/flashcards';
import {
  FLASHCARD_SELECTION_ERROR,
  FlashcardSelectionExplanationRegistry,
  handleFlashcardCancelExplanation,
  handleFlashcardExplainSelection,
  handleFlashcardSelectionCommand,
  isFlashcardSelectionCommand,
  type FlashcardSelectionCommandContext,
} from './flashcard-selection-commands.js';
import { isKnowledgeCommand } from './knowledge-commands.js';

process.env.TEST_KEY = 'test-key';

const MODEL: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'prov',
  modelId: 'model-a',
};

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
  return {
    id: 'prov',
    name: 'Test provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    apiKeyEnv: 'TEST_KEY',
    models: [{ id: 'model-a' }],
    ...overrides,
  };
}

function createConfig(
  overrides: {
    providers?: ModelProviderConfig[];
    defaultProviderId?: string;
    defaultModelId?: string;
  } = {},
): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: overrides.providers ?? [createProvider()],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
    walkthrough: createDefaultWalkthroughConfig(),
    ...(overrides.defaultProviderId ? { defaultProviderId: overrides.defaultProviderId } : {}),
    ...(overrides.defaultModelId ? { defaultModelId: overrides.defaultModelId } : {}),
  };
}

function basicItem(overrides: Partial<FlashcardItem> = {}): FlashcardItem {
  return {
    id: 'card-1',
    model: 'basic',
    deck: 'srs',
    front: 'What is a closure?',
    back: 'A function plus its captured environment.',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function clozeItem(): FlashcardItem {
  return {
    id: 'card-cloze',
    model: 'cloze',
    deck: 'srs',
    text: 'A {{c1::closure}} captures its environment.',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function createStore(item: FlashcardItem | undefined): CardStore {
  return {
    read: async (itemId: string) => {
      if (!item || item.id !== itemId) {
        throw new Error(`card not found: ${itemId}`);
      }
      return item;
    },
  } as CardStore;
}

function createContext(
  store: CardStore,
  options: {
    config?: PiwinConfig;
    sessionModel?: ModelRef;
    fetch?: typeof globalThis.fetch;
  } = {},
): FlashcardSelectionCommandContext {
  const config = options.config ?? createConfig({ defaultProviderId: 'prov', defaultModelId: 'model-a' });
  return {
    getCardStore: async () => store,
    loadConfig: async () => config,
    resolveSessionModel: () => options.sessionModel,
    ...(options.fetch
      ? { completion: { fetch: options.fetch, resolveSecret: async () => 'k' } }
      : { completion: { fetch: successFetch('A short hint.'), resolveSecret: async () => 'k' } }),
  };
}

function explainInput(
  overrides: Partial<FlashcardSelectionExplainInput> = {},
): FlashcardSelectionExplainInput {
  return {
    explanationId: 'exp-1',
    itemId: 'card-1',
    face: 'front',
    selectedText: 'closure',
    intent: 'hint',
    locale: 'en',
    ...overrides,
  };
}

function successFetch(text: string): Mock<typeof globalThis.fetch> {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as Mock<typeof globalThis.fetch>;
}

function deferredFetch(): {
  fetch: Mock<typeof globalThis.fetch>;
  resolveNext: (text: string) => void;
} {
  const pending: Array<{
    resolve: (response: Response) => void;
    reject: (error: Error) => void;
  }> = [];
  const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      const entry = {
        resolve: (response: Response) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        reject: (error: Error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      const onAbort = () => {
        entry.reject(new DOMException('aborted', 'AbortError'));
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      pending.push(entry);
    });
  }) as unknown as Mock<typeof globalThis.fetch>;
  return {
    fetch,
    resolveNext: (text: string) => {
      const next = pending.shift();
      next?.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
  };
}

function ignoringAbortFetch(): {
  fetch: Mock<typeof globalThis.fetch>;
  release: (text: string) => void;
} {
  let release!: (text: string) => void;
  const done = new Promise<string>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(async () => {
    const text = await done;
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as Mock<typeof globalThis.fetch>;
  return { fetch, release };
}

function successData(response: HostResponse): unknown {
  if (response.success) return response.data;
  throw new Error(`expected success but got ${response.error}`);
}

function problemCode(response: HostResponse): string | undefined {
  if (response.success) return undefined;
  return response.problem?.code;
}

describe('flashcard selection commands', () => {
  it('recognizes tutor commands and leaves knowledge routing alone', () => {
    expect(
      isFlashcardSelectionCommand({
        type: 'flashcards/explain-selection',
        input: explainInput(),
      }),
    ).toBe(true);
    expect(
      isFlashcardSelectionCommand({ type: 'flashcards/cancel-explanation', explanationId: 'exp-1' }),
    ).toBe(true);
    expect(isFlashcardSelectionCommand({ type: 'flashcards/list' })).toBe(false);
    expect(
      isKnowledgeCommand({ type: 'flashcards/explain-selection', input: explainInput() }),
    ).toBe(false);
    expect(
      isKnowledgeCommand({ type: 'flashcards/cancel-explanation', explanationId: 'exp-1' }),
    ).toBe(false);
  });

  it('returns a short markdown explanation for a front hint', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      'req-1',
      createContext(createStore(basicItem())),
      registry,
    );
    expect(response).toMatchObject({
      id: 'req-1',
      command: 'flashcards/explain-selection',
      success: true,
    });
    expect(successData(response)).toEqual({
      explanationId: 'exp-1',
      itemId: 'card-1',
      selectedText: 'closure',
      intent: 'hint',
      markdown: 'A short hint.',
    });
    expect(registry.get('exp-1')).toBeUndefined();
  });

  it('explains a back-side selection', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      {
        type: 'flashcards/explain-selection',
        input: explainInput({
          face: 'back',
          intent: 'explain',
          selectedText: 'captured environment',
        }),
      },
      undefined,
      createContext(createStore(basicItem()), { fetch: successFetch('A short explanation.') }),
      registry,
    );
    expect(successData(response)).toMatchObject({
      intent: 'explain',
      markdown: 'A short explanation.',
    });
  });

  it('matches cloze selection against projected face text', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      {
        type: 'flashcards/explain-selection',
        input: explainInput({
          itemId: 'card-cloze',
          face: 'back',
          intent: 'explain',
          selectedText: 'closure',
        }),
      },
      undefined,
      createContext(createStore(clozeItem()), { fetch: successFetch('Cloze explanation.') }),
      registry,
    );
    expect(response.success).toBe(true);
    expect(successData(response)).toMatchObject({ markdown: 'Cloze explanation.' });
  });

  it('rejects a selection that is not on the current face', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      {
        type: 'flashcards/explain-selection',
        input: explainInput({ selectedText: 'not on this card' }),
      },
      undefined,
      createContext(createStore(basicItem())),
      registry,
    );
    expect(response.success).toBe(false);
    expect(problemCode(response)).toBe(FLASHCARD_SELECTION_ERROR.invalid);
  });

  it('rejects an empty or overlong selection', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const empty = await handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput({ selectedText: '   ' }) },
      undefined,
      createContext(createStore(basicItem())),
      registry,
    );
    const overlong = await handleFlashcardExplainSelection(
      {
        type: 'flashcards/explain-selection',
        input: explainInput({ selectedText: 'c'.repeat(301) }),
      },
      undefined,
      createContext(createStore(basicItem())),
      registry,
    );
    expect(problemCode(empty)).toBe(FLASHCARD_SELECTION_ERROR.invalid);
    expect(problemCode(overlong)).toBe(FLASHCARD_SELECTION_ERROR.invalid);
  });

  it('returns flashcard-not-found when the item is missing', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      undefined,
      createContext(createStore(undefined)),
      registry,
    );
    expect(problemCode(response)).toBe(FLASHCARD_SELECTION_ERROR.notFound);
  });

  it('returns model-unavailable when no model can be resolved', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const response = await handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      undefined,
      createContext(createStore(basicItem()), { config: createConfig() }),
      registry,
    );
    expect(problemCode(response)).toBe(FLASHCARD_SELECTION_ERROR.modelUnavailable);
  });

  it('does not cancel a second in-flight explanation when the first is cancelled', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const hanging = deferredFetch();
    const context = createContext(createStore(basicItem()), { fetch: hanging.fetch });
    const first = handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput({ explanationId: 'exp-a' }) },
      'a',
      context,
      registry,
    );
    await vi.waitFor(() => expect(hanging.fetch).toHaveBeenCalledTimes(1));
    const second = handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput({ explanationId: 'exp-b' }) },
      'b',
      context,
      registry,
    );
    await vi.waitFor(() => expect(hanging.fetch).toHaveBeenCalledTimes(2));

    const cancel = handleFlashcardCancelExplanation(
      { type: 'flashcards/cancel-explanation', explanationId: 'exp-a' },
      'cancel-a',
      registry,
    );
    expect(successData(cancel)).toEqual({ cancelled: true });
    hanging.resolveNext('should not matter');
    hanging.resolveNext('Second explanation.');

    const firstResult = await first;
    const secondResult = await second;
    expect(problemCode(firstResult)).toBe(FLASHCARD_SELECTION_ERROR.cancelled);
    expect(successData(secondResult)).toMatchObject({
      explanationId: 'exp-b',
      markdown: 'Second explanation.',
    });
  });

  it('rejects a duplicate explanationId', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const hanging = deferredFetch();
    const context = createContext(createStore(basicItem()), { fetch: hanging.fetch });
    const first = handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      'first',
      context,
      registry,
    );
    await vi.waitFor(() => expect(hanging.fetch).toHaveBeenCalledTimes(1));
    const duplicate = await handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      'dup',
      context,
      registry,
    );
    expect(duplicate.success).toBe(false);
    expect(problemCode(duplicate)).toBe(FLASHCARD_SELECTION_ERROR.invalid);
    hanging.resolveNext('ok');
    await first;
  });

  it('treats cancel as idempotent success when the id is missing', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const first = handleFlashcardCancelExplanation(
      { type: 'flashcards/cancel-explanation', explanationId: 'missing' },
      'c1',
      registry,
    );
    const second = handleFlashcardCancelExplanation(
      { type: 'flashcards/cancel-explanation', explanationId: 'missing' },
      'c2',
      registry,
    );
    expect(first.success).toBe(true);
    expect(successData(first)).toEqual({ cancelled: false });
    expect(successData(second)).toEqual({ cancelled: false });
  });

  it('does not return a ready payload if completion arrives after cancel', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const hanging = ignoringAbortFetch();
    const pending = handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      'late',
      createContext(createStore(basicItem()), { fetch: hanging.fetch }),
      registry,
    );
    await vi.waitFor(() => expect(hanging.fetch).toHaveBeenCalledTimes(1));
    const cancel = handleFlashcardCancelExplanation(
      { type: 'flashcards/cancel-explanation', explanationId: 'exp-1' },
      'cancel',
      registry,
    );
    expect(successData(cancel)).toEqual({ cancelled: true });
    hanging.release('Late markdown that must be dropped.');
    const result = await pending;
    expect(result.success).toBe(false);
    expect(problemCode(result)).toBe(FLASHCARD_SELECTION_ERROR.cancelled);
    expect(JSON.stringify(result)).not.toContain('Late markdown');
  });

  it('aborts every in-flight explanation on dispose', async () => {
    const registry = new FlashcardSelectionExplanationRegistry();
    const hanging = deferredFetch();
    const pending = handleFlashcardExplainSelection(
      { type: 'flashcards/explain-selection', input: explainInput() },
      'dispose',
      createContext(createStore(basicItem()), { fetch: hanging.fetch }),
      registry,
    );
    await vi.waitFor(() => expect(hanging.fetch).toHaveBeenCalledTimes(1));
    registry.abortAll();
    const result = await pending;
    expect(problemCode(result)).toBe(FLASHCARD_SELECTION_ERROR.cancelled);
    expect(registry.get('exp-1')).toBeUndefined();
  });

  it('returns null for unrelated commands', async () => {
    const result = await handleFlashcardSelectionCommand(
      { type: 'flashcards/list' },
      undefined,
      createContext(createStore(basicItem())),
      new FlashcardSelectionExplanationRegistry(),
    );
    expect(result).toBeNull();
  });
});
