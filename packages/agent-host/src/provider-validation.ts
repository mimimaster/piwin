/**
 * Validate provider entries before save / before mapping to Pi runtime.
 * Never logs secret values.
 */
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';

export type ProviderValidationIssue = {
  path: string;
  message: string;
};

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RAW_KEY_PATTERN = /^(sk-|sk-ant-|sk-proj-|api-)[A-Za-z0-9_\-]{8,}$/i;

export function validateProviders(
  providers: readonly ModelProviderConfig[],
): ProviderValidationIssue[] {
  const issues: ProviderValidationIssue[] = [];
  const seenIds = new Set<string>();

  providers.forEach((provider, index) => {
    const base = `providers[${index}]`;
    if (!provider.id?.trim()) {
      issues.push({ path: `${base}.id`, message: 'provider id is required' });
    } else if (seenIds.has(provider.id)) {
      issues.push({ path: `${base}.id`, message: `duplicate provider id: ${provider.id}` });
    } else {
      seenIds.add(provider.id);
    }

    if (
      provider.protocol !== 'openai-compatible' &&
      provider.protocol !== 'anthropic-compatible'
    ) {
      issues.push({
        path: `${base}.protocol`,
        message: 'protocol must be openai-compatible or anthropic-compatible',
      });
    }

    if (!provider.name?.trim()) {
      issues.push({ path: `${base}.name`, message: 'provider name is required' });
    }

    if (!provider.baseUrl?.trim()) {
      issues.push({ path: `${base}.baseUrl`, message: 'baseUrl is required' });
    } else {
      try {
        const parsed = new URL(provider.baseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          issues.push({
            path: `${base}.baseUrl`,
            message: 'baseUrl must use http or https',
          });
        }
      } catch {
        issues.push({ path: `${base}.baseUrl`, message: 'baseUrl is not a valid URL' });
      }
    }

    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      issues.push({ path: `${base}.models`, message: 'at least one model is required' });
    } else {
      provider.models.forEach((model, modelIndex) => {
        if (!model.id?.trim()) {
          issues.push({
            path: `${base}.models[${modelIndex}].id`,
            message: 'model id is required',
          });
        }
      });
    }

    if (provider.apiKeyEnv !== undefined && provider.apiKeyEnv !== '') {
      if (!ENV_NAME_PATTERN.test(provider.apiKeyEnv)) {
        issues.push({
          path: `${base}.apiKeyEnv`,
          message: 'apiKeyEnv must look like an environment variable name',
        });
      }
      if (RAW_KEY_PATTERN.test(provider.apiKeyEnv)) {
        issues.push({
          path: `${base}.apiKeyEnv`,
          message: 'apiKeyEnv must not contain a raw API key value',
        });
      }
    }

    if (provider.apiKeyRef !== undefined && provider.apiKeyRef !== '') {
      if (RAW_KEY_PATTERN.test(provider.apiKeyRef)) {
        issues.push({
          path: `${base}.apiKeyRef`,
          message: 'apiKeyRef must be a keychain reference, not a raw API key',
        });
      }
    }
  });

  return issues;
}

export function validatePiwinConfig(config: PiwinConfig): ProviderValidationIssue[] {
  return validateProviders(config.providers);
}

/**
 * Strip accidental raw secrets from provider fields before persist.
 * Returns a sanitized copy; never mutates input.
 */
export function sanitizeProvidersForSave(
  providers: readonly ModelProviderConfig[],
): { providers: ModelProviderConfig[]; redactedFields: string[] } {
  const redactedFields: string[] = [];
  const next = providers.map((provider, index) => {
    const copy: ModelProviderConfig = {
      ...provider,
      models: provider.models.map((model) => ({ ...model })),
    };
    if (copy.apiKeyEnv && RAW_KEY_PATTERN.test(copy.apiKeyEnv)) {
      redactedFields.push(`providers[${index}].apiKeyEnv`);
      delete copy.apiKeyEnv;
    }
    if (copy.apiKeyRef && RAW_KEY_PATTERN.test(copy.apiKeyRef)) {
      redactedFields.push(`providers[${index}].apiKeyRef`);
      delete copy.apiKeyRef;
    }
    return copy;
  });
  return { providers: next, redactedFields };
}

export function looksLikeRawApiKey(value: string): boolean {
  return RAW_KEY_PATTERN.test(value.trim());
}
