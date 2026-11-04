/**
 * piwin-web-model — Pi provider extension.
 *
 * Registers one model provider per supported site. A turn is a real Chrome tab:
 * Pi's context is typed into the page, and the page's reply is turned back into
 * Pi events, so tools, permissions, plans and subagents all stay Pi's.
 *
 * The page is the model *transport*, not the agent: this is deliberately not a
 * reimplementation of the agent loop inside a web shell.
 *
 * Install: `piwin extension install <path to this directory>`, then enable it.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { registerWebModelProviders } from './src/provider.ts';

export default async function webModelExtension(pi: ExtensionAPI): Promise<void> {
  registerWebModelProviders(pi, {
    // Pi's own stream factory, so every consumer (interactive loop, compaction)
    // sees standard AssistantMessageEvents.
    createStream: () => createAssistantMessageEventStream(),
    onNote: (note) => console.warn(`[piwin-web-model] ${note}`),
  });
}
