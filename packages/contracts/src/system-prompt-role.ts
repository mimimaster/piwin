/**
 * System prompt role on OpenAI-compatible wires (ADR 0082).
 *
 * `developer` is the default, as Pi sends it. Some endpoints (e.g. older
 * DashScope/Qwen deployments) still reject `developer` with a 400; the user
 * opts such a provider or model into `system`. Nothing is inferred from the
 * base URL.
 */
import type { ModelConfigEntry, ModelProviderConfig } from './config.js';
import { resolveModelEndpoint } from './model-endpoint.js';
import { isSubscriptionProvider } from './subscription-oauth.js';

export type SystemPromptRoleMode = 'developer' | 'system';

export const SYSTEM_PROMPT_ROLE_MODES: readonly SystemPromptRoleMode[] = ['developer', 'system'];

export function isSystemPromptRoleMode(value: unknown): value is SystemPromptRoleMode {
  return (
    typeof value === 'string' && (SYSTEM_PROMPT_ROLE_MODES as readonly string[]).includes(value)
  );
}

/**
 * Explicit `developer`-role decision for requests to `model`. `undefined`
 * means nothing was chosen (or the setting does not apply: non-OpenAI wire,
 * subscription provider) and the backend keeps its own default.
 */
export function resolveSupportsDeveloperRole(
  provider: ModelProviderConfig,
  model: Pick<ModelConfigEntry, 'protocol' | 'systemPromptRole'> | undefined,
): boolean | undefined {
  if (isSubscriptionProvider(provider)) return undefined;
  if (resolveModelEndpoint(provider, model).protocol !== 'openai-compatible') return undefined;
  const providerMode =
    provider.protocol === 'openai-compatible' ? provider.systemPromptRole : undefined;
  const mode = model?.systemPromptRole ?? providerMode;
  if (mode === undefined) return undefined;
  return mode === 'developer';
}
