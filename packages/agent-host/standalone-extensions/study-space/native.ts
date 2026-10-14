import type { ExtensionContext, ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { object, type Mode, type Topic } from './model.js';
import { Store } from './store.js';

export type Active = { mode: Mode; topic: Topic | undefined; generation: number; signal: AbortSignal };
const CREATE = ['flashcard_create', 'flashcard_batch_create'];
const STUDY_WRITE = 'flashcard_study_write';

/** Resolves a direct or Toolbox-routed call to the native target it will run. */
export function nativeTarget(event: { toolName: string; input: unknown }): string | undefined {
  if (event.toolName !== 'piwin_toolbox') return event.toolName;
  const wrapper = object(event.input);
  return wrapper.action === 'call' && typeof wrapper.target === 'string' ? wrapper.target : undefined;
}

/**
 * Observes the current Run's native calls while study mode is on. Consent for creating cards is the
 * Host's own approval prompt; this gate adds no second dialog and only enforces the two product rules.
 */
export class NativeGate {
  constructor(private readonly store: Store, private readonly active: () => Active | undefined) {}
  async call(event: ToolCallEvent, _ctx: ExtensionContext): Promise<{ block: true; reason: string } | undefined> {
    if (!this.active()) return;
    try {
      const target = nativeTarget(event);
      if (target === STUDY_WRITE) throw new Error('复习在原生闪卡面板中进行：请用户在闪卡面板评分，这里只做重讲。Scheduled review runs in the native flashcards panel; do not drive rounds from chat.');
      if (target && CREATE.includes(target) && (await this.store.preferences()).cards === 'never') {
        throw new Error('用户已关闭制卡。The user turned card making off; do not create or offer cards.');
      }
      return;
    } catch (error) { return { block: true, reason: `Study Space: ${(error as Error).message}` }; }
  }
}
