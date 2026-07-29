import type { HostPush, ModelProviderConfig, ModelRef } from '@piwin/contracts';
import { deriveDefaultNameFromMessage, setSessionAutoName } from '@piwin/session';
import { generateTitleViaProvider } from './lightweight-completion.js';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import type { SecretResolver } from './secret-resolver.js';

/**
 * Orchestrate auto-naming for a session after a completed exchange.
 *
 * 1. Check `PiwinConfig.session.autoName` (default true); skip when false.
 * 2. Attempt LLM title generation via the session's current model + provider.
 * 3. On LLM failure, fall back to a text-derived name from the first message.
 * 4. Write via `setSessionAutoName` (respects `nameSource: 'user'` guard).
 * 5. Push `session/name-updated` so the desktop list refreshes.
 *
 * Never throws — all failures are swallowed (caller wraps in fire-and-forget).
 */
export async function maybeAutoNameSession(input: {
  piwinRoot: string;
  sessionId: string;
  firstMessage: string;
  assistantReply?: string;
  modelRef?: ModelRef;
  providers: ModelProviderConfig[];
  secretResolver: SecretResolver;
  push: (message: HostPush) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const {
    piwinRoot,
    sessionId,
    firstMessage,
    assistantReply,
    modelRef,
    providers,
    secretResolver,
    push,
    signal,
  } = input;
  try {
    const rootDir = getPiwinRoot(piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.session?.autoName === false) {
      return;
    }
    const indexPath = getPiwinSessionIndexPath(rootDir);

    // Attempt LLM title when a model ref + matching provider are available.
    let llmTitle: string | null = null;
    if (modelRef) {
      const provider = providers.find((item) => item.id === modelRef.providerId);
      if (provider) {
        try {
          const apiKey = await secretResolver.resolveProviderSecret(provider);
          if (apiKey) {
            const userPrompt = assistantReply
              ? `User: ${firstMessage}\nAssistant: ${assistantReply}`
              : firstMessage;
            llmTitle = await generateTitleViaProvider({
              provider,
              modelId: modelRef.modelId,
              apiKey,
              userPrompt,
              ...(signal ? { signal } : {}),
            });
          }
        } catch {
          // Fall through to text fallback below.
        }
      }
    }

    const finalName = llmTitle ?? deriveDefaultNameFromMessage(firstMessage);
    if (!finalName) {
      return;
    }
    const updated = await setSessionAutoName(indexPath, sessionId, finalName);
    if (updated) {
      push({
        type: 'session/name-updated',
        sessionId,
        name: updated.name ?? finalName,
        nameSource: 'auto',
      });
    }
  } catch {
    // Best-effort: never fail a turn due to naming.
  }
}
