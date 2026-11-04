/**
 * Register the web-model providers with Pi.
 *
 * Each site becomes one Pi provider whose `streamSimple` is a web page turn:
 *
 *   Pi context → prompt text → Chrome tab → page reply → Pi events
 *
 * Everything Pi already owns stays Pi's: the agent loop, tools, permissions,
 * plans and subagents. Only the transport changes, which is why a page model can
 * call `read`/`edit`/`bash` and still pass through piwin's permission gate.
 *
 * Dependencies are injected so registration is testable with a fake `pi`.
 */

import type { Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { ensureChrome, type LaunchOptions, type LaunchResult } from './chrome-launch.ts';
import { ModelPage } from './page-driver.ts';
import { serializeContext } from './prompt-serializer.ts';
import type { ReplySnapshot, SiteDefinition } from './site-adapter.ts';
import { SITES } from './sites/index.ts';
import { runWebModelStream, type StreamSink } from './transport.ts';

/** The web page is not a metered API: cost is zero, context is what fits the composer. */
const CONTEXT_WINDOW = 32_000;
const MAX_TOKENS = 4_096;
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

/** Minimal Pi extension surface this module uses. */
export interface PiRegistrar {
  registerProvider(name: string, config: ProviderConfigLike): void;
}

export interface ProviderModelConfigLike {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  reasoning: boolean;
  input: ('text' | 'image')[];
  cost: typeof ZERO_COST;
  contextWindow: number;
  maxTokens: number;
}

export interface ProviderConfigLike {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  authHeader: boolean;
  models: ProviderModelConfigLike[];
  streamSimple: (model: Model<string>, context: Context, options?: SimpleStreamOptions) => StreamSink;
}

export interface WebModelDeps {
  ensureChrome: (options?: LaunchOptions) => Promise<LaunchResult>;
  openPage: (site: SiteDefinition, port: number) => Promise<PageHandle>;
  createStream: () => StreamSink;
  runStream: typeof runWebModelStream;
  /** Reported to the user through Pi's status line when a reply is odd. */
  onNote?: (note: string) => void;
}

/** The slice of `ModelPage` a turn needs. */
export interface PageHandle {
  probe(): Promise<ReplySnapshot>;
  sendPrompt(text: string): Promise<ReplySnapshot>;
  streamReply(options: object, baseline?: ReplySnapshot): AsyncGenerator<string>;
  close(): Promise<void>;
}

/** The two things only the extension entry point can supply. */
export interface WebModelRuntime {
  createStream: () => StreamSink;
  onNote?: (note: string) => void;
}

function defaultDeps(runtime: WebModelRuntime): WebModelDeps {
  return {
    ensureChrome,
    openPage: (site, port) => ModelPage.open(site, port),
    createStream: runtime.createStream,
    runStream: runWebModelStream,
    ...(runtime.onNote === undefined ? {} : { onNote: runtime.onNote }),
  };
}

function modelsFor(site: SiteDefinition): ProviderModelConfigLike[] {
  return [
    {
      id: `${site.id}/default`,
      name: `${site.label} · default`,
      api: 'web-model',
      baseUrl: site.homeUrl,
      reasoning: false,
      input: ['text'],
      cost: ZERO_COST,
      contextWindow: CONTEXT_WINDOW,
      maxTokens: MAX_TOKENS,
    },
  ];
}

/**
 * One turn against a page.
 *
 * A fresh conversation per turn is deliberate for v1: it keeps the extension
 * stateless, so a failed turn cannot corrupt a web chat the next turn depends on
 * (the serializer's `fromIndex` delta mode is what a later version will use to
 * reuse one conversation per Pi session).
 */
function streamFor(site: SiteDefinition, deps: WebModelDeps) {
  return (model: Model<string>, context: Context, options?: SimpleStreamOptions): StreamSink => {
    const sink = deps.createStream();
    void (async () => {
      let page: PageHandle | undefined;
      try {
        const prompt = serializeContext(context, { includeBootstrap: true });
        if (prompt.trim() === '') {
          sink.push({ type: 'error', reason: 'error', error: errorMessage(model, 'nothing to send: the context was empty') });
          sink.end();
          return;
        }
        const chrome = await deps.ensureChrome({});
        page = await deps.openPage(site, chrome.port);
        const baseline = await page.probe();
        await page.sendPrompt(prompt);
        await deps.runStream(
          {
            model: { api: model.api, provider: model.provider, id: model.id },
            stream: page.streamReply({}, baseline),
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
            ...(deps.onNote === undefined ? {} : { onNote: deps.onNote }),
          },
          sink,
        );
      } catch (error) {
        sink.push({ type: 'error', reason: 'error', error: errorMessage(model, (error as Error).message) });
        sink.end();
      } finally {
        await page?.close().catch(() => {});
      }
    })();
    return sink;
  };
}

function errorMessage(model: Model<string>, message: string): Record<string, unknown> {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: ZERO_COST },
    stopReason: 'error',
    errorMessage: message,
    timestamp: Date.now(),
  };
}

export function registerWebModelProviders(
  pi: PiRegistrar,
  runtime: WebModelRuntime,
  overrides: Partial<WebModelDeps> = {},
): void {
  const deps: WebModelDeps = { ...defaultDeps(runtime), ...overrides };
  for (const site of SITES) {
    pi.registerProvider(site.id, {
      name: site.label,
      baseUrl: site.homeUrl,
      // There is no API key: the credential is the Chrome profile's login.
      apiKey: 'chrome-profile',
      api: 'web-model',
      authHeader: false,
      models: modelsFor(site),
      streamSimple: streamFor(site, deps),
    });
  }
}

export { CONTEXT_WINDOW, MAX_TOKENS };
