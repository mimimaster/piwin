/**
 * Drive one model web page: probe it, type a prompt, press Enter, wait for the
 * reply to settle, read it back.
 *
 * This layer knows nothing about Pi. It is the seam the provider transport sits
 * on, which keeps the fragile part (DOM) replaceable and lets the smoke script
 * exercise exactly the path a real turn uses.
 *
 * Invariants:
 * - Never types into a page that is blocked (challenge / signed out / no box);
 *   the caller gets `describeBlocker` text instead of a mystery timeout.
 * - `sendPrompt` verifies the composer actually received the text. A silent
 *   no-op here would look like "the model never answered".
 */

import { CdpSession } from './cdp.ts';
import {
  buildProbeScript,
  describeBlocker,
  hasNewReply,
  isSettled,
  latestAssistantText,
  normalizeSnapshot,
  type ReplySnapshot,
  type SiteDefinition,
} from './site-adapter.ts';

export class PageDriverError extends Error {
  override readonly name = 'PageDriverError';
}

const DEFAULT_POLL_MS = 500;
const DEFAULT_REPLY_TIMEOUT_MS = 180_000;
const DEFAULT_TYPE_TIMEOUT_MS = 15_000;

export interface AwaitReplyOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Called with each probe so the caller can surface progress (status line). */
  onProgress?: (snapshot: ReplySnapshot) => void;
  signal?: AbortSignal;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class ModelPage {
  readonly site: SiteDefinition;
  readonly #session: CdpSession;

  private constructor(site: SiteDefinition, session: CdpSession) {
    this.site = site;
    this.#session = session;
  }

  /** Attach to an existing tab of this site, or the first page target. */
  static async attach(site: SiteDefinition, port: number, targetId?: string): Promise<ModelPage> {
    const session = await CdpSession.attach(port, targetId);
    return new ModelPage(site, session);
  }

  /**
   * Open a fresh conversation tab for this site and wait until the composer is
   * there. A page that only ever shows a login form fails with that blocker
   * instead of waiting out the reply timeout.
   */
  static async open(site: SiteDefinition, port: number, timeoutMs = 45_000): Promise<ModelPage> {
    const control = await CdpSession.attach(port);
    const created = await control
      .send<{ targetId: string }>('Target.createTarget', { url: site.homeUrl })
      .finally(() => control.close());
    const page = new ModelPage(site, await CdpSession.attach(port, created.targetId));

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snapshot = await page.probe();
      const blocker = describeBlocker(snapshot);
      if (blocker === undefined && snapshot.composerSelector !== null) return page;
      if (Date.now() > deadline) {
        page.close();
        throw new PageDriverError(blocker ?? `no prompt box appeared on ${site.id} within ${timeoutMs}ms`);
      }
      await sleep(500);
    }
  }

  async probe(): Promise<ReplySnapshot> {
    const raw = await this.#session.evaluate<unknown>(buildProbeScript(this.site));
    return normalizeSnapshot(raw);
  }

  async url(): Promise<string> {
    return this.#session.evaluate<string>('location.href');
  }

  /**
   * Replace the composer contents with `text` and submit.
   *
   * Select-all-then-insert is deliberate: setting `.value` or `.innerText` is
   * ignored by the React/ProseMirror editors both sites use, and it also clears
   * whatever draft the user left behind.
   */
  async sendPrompt(text: string): Promise<ReplySnapshot> {
    const before = await this.probe();
    const blocker = describeBlocker(before);
    if (blocker !== undefined) throw new PageDriverError(blocker);

    await this.#focusComposer();
    await this.#session.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 4, // Meta on macOS
    });
    await this.#session.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 4,
    });
    await this.#session.send('Input.insertText', { text });

    const typed = await this.#composerText();
    if (!typed.includes(text.slice(0, Math.min(24, text.length)))) {
      throw new PageDriverError(
        `the prompt box did not accept the text (composer holds ${JSON.stringify(typed.slice(0, 60))}); ` +
          `${this.site.id} probably changed its editor`,
      );
    }

    for (const type of ['keyDown', 'keyUp'] as const) {
      await this.#session.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
    }
    return this.probe();
  }

  /**
   * Yield the assistant text as it grows until the reply settles.
   *
   * `baseline` must be the snapshot taken *before* the prompt was typed: it is
   * what proves the text on screen is this turn's reply and not the previous
   * one's (see `hasNewReply`). The last yielded value is the settled text.
   */
  async *streamReply(options: AwaitReplyOptions = {}, baseline?: ReplySnapshot): AsyncGenerator<string> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    let previous: ReplySnapshot | undefined;
    let emitted = '';

    for (;;) {
      if (options.signal?.aborted === true) throw new PageDriverError('reply wait aborted');
      const current = await this.probe();
      options.onProgress?.(current);

      const blocker = describeBlocker(current);
      if (blocker !== undefined && current.challengeFrames.length > 0) throw new PageDriverError(blocker);

      const isNew = baseline === undefined || hasNewReply(baseline, current);
      const text = latestAssistantText(current);
      if (isNew && text !== undefined && text !== emitted) {
        emitted = text;
        yield text;
      }
      if (isNew && isSettled(previous, current)) {
        if (text === undefined) throw new PageDriverError('the reply settled without any assistant text');
        return;
      }
      if (Date.now() > deadline) {
        throw new PageDriverError(
          `no settled reply within ${Math.round(timeoutMs / 1000)}s (streaming=${current.generating}); ` +
            `last text: ${JSON.stringify((latestAssistantText(current) ?? '').slice(-200))}`,
        );
      }
      previous = current;
      await sleep(pollMs);
    }
  }

  /** Wait for the settled reply text, discarding the intermediate renderings. */
  async awaitReply(options: AwaitReplyOptions = {}, baseline?: ReplySnapshot): Promise<string> {
    let last = '';
    for await (const text of this.streamReply(options, baseline)) last = text;
    return last;
  }

  /** One turn: type, submit, wait, return the reply text. */
  async ask(text: string, options: AwaitReplyOptions = {}): Promise<string> {
    const before = await this.probe();
    await this.sendPrompt(text);
    return this.awaitReply(options, before);
  }

  async close(): Promise<void> {
    this.#session.close();
  }

  async #focusComposer(): Promise<void> {
    const script = `(() => {
      const selectors = ${JSON.stringify(this.site.selectors.composer)};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) {
          node.focus();
          return document.activeElement === node || node.contains(document.activeElement);
        }
      }
      return false;
    })()`;
    const focused = await this.#session.evaluate<boolean>(script);
    if (focused !== true) {
      throw new PageDriverError(`could not focus the prompt box on ${this.site.id}; its layout may have changed`);
    }
  }

  async #composerText(): Promise<string> {
    const script = `(() => {
      const selectors = ${JSON.stringify(this.site.selectors.composer)};
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (!node) continue;
        const value = node.tagName === 'TEXTAREA' ? node.value : node.innerText;
        return String(value ?? '');
      }
      return '';
    })()`;
    return this.#session.evaluate<string>(script);
  }
}

export { DEFAULT_REPLY_TIMEOUT_MS, DEFAULT_TYPE_TIMEOUT_MS };
