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
 * 4. Write via `setSessionAutoName` (respects the `nameSource` guard, dedupes).
 * 5. Push `session/name-updated` so the desktop list refreshes.
 *
 * Never throws — failures are logged as `host/log` warn and swallowed so a
 * naming hiccup can never fail a turn.
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
  const warn = (message: string): void => {
    push({ type: 'host/log', level: 'warn', message: `auto-name: ${message}` });
  };
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
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          warn(`LLM title failed for ${sessionId}: ${detail}`);
        }
      }
    }

    // An LLM title upgrades a `default` or `text` name to `llm`; the text
    // fallback only ever fills a `default` name (see setSessionAutoName).
    const source = llmTitle ? 'llm' : 'text';
    const finalName = llmTitle ?? deriveDefaultNameFromMessage(firstMessage);
    if (!finalName) {
      warn(`no usable name derived for ${sessionId}`);
      return;
    }
    const updated = await setSessionAutoName(indexPath, sessionId, finalName, source);
    if (updated) {
      push({
        type: 'session/name-updated',
        sessionId,
        name: updated.name ?? finalName,
        nameSource: source,
      });
    }
  } catch (error) {
    // Best-effort: never fail a turn due to naming, but surface why.
    const detail = error instanceof Error ? error.message : String(error);
    warn(`naming failed for ${sessionId}: ${detail}`);
  }
}
