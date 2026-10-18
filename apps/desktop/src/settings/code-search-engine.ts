/**
 * Which engine plans code_search rounds, as the user sees it.
 *
 * Config stores this as two fields (`backend` + Windsurf credential refs), but
 * the user only ever makes one choice: reuse the Devin account, paste a
 * Windsurf token, or use one of their own models. Flattening the pair here is
 * what lets the page show a single picker instead of nested toggles.
 */
import type { CodeSearchConfig } from '@piwin/contracts';

export const WINDSURF_SECRET_ID = 'code-search-windsurf';
export const DEFAULT_WINDSURF_KEY_ENV = 'WINDSURF_API_KEY';
export const DEVIN_ACCOUNT_REF = 'oauth:devin';

export type CodeSearchEngine = 'devin' | 'model' | 'token';

/** An empty Windsurf config reuses the Devin account: that is the Host's default. */
export function codeSearchEngine(draft: CodeSearchConfig): CodeSearchEngine {
  if ((draft.backend ?? 'model') !== 'windsurf') return 'model';
  const ref = draft.apiKeyRef?.trim();
  if (ref === DEVIN_ACCOUNT_REF) return 'devin';
  return ref || draft.apiKeyEnv?.trim() ? 'token' : 'devin';
}

/** A keychain ref the user saved by hand, never the Devin OAuth marker. */
export function hasStoredWindsurfToken(draft: CodeSearchConfig): boolean {
  const ref = draft.apiKeyRef?.trim();
  return Boolean(ref) && ref !== DEVIN_ACCOUNT_REF;
}

/**
 * Picking an engine that is already usable is the "I want this" gesture, so it
 * also turns the feature on; picking one that still needs setup leaves the
 * switch alone so the status line can say what is missing.
 */
export function applyCodeSearchEngine(
  draft: CodeSearchConfig,
  engine: CodeSearchEngine,
  devinConnected: boolean,
): CodeSearchConfig {
  const next: CodeSearchConfig = { ...draft };
  if (engine === 'model') {
    next.backend = 'model';
    if (next.model) next.enabled = true;
    return next;
  }
  next.backend = 'windsurf';
  if (engine === 'devin') {
    next.apiKeyRef = DEVIN_ACCOUNT_REF;
    delete next.apiKeyEnv;
    if (devinConnected) next.enabled = true;
    return next;
  }
  // Leaving the Devin account also drops its apiKeyEnv: the Host redacts it to
  // a placeholder that would otherwise read as a legacy plaintext key.
  if (next.apiKeyRef === DEVIN_ACCOUNT_REF) {
    delete next.apiKeyRef;
    next.apiKeyEnv = DEFAULT_WINDSURF_KEY_ENV;
  } else if (!next.apiKeyEnv?.trim()) {
    next.apiKeyEnv = DEFAULT_WINDSURF_KEY_ENV;
  }
  if (hasStoredWindsurfToken(next)) next.enabled = true;
  return next;
}
