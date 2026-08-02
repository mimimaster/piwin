/**
 * Validate provider entries before save / before mapping to Pi runtime.
 * Never logs secret values.
 */
import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import { createDefaultWalkthroughConfig, isThinkingLevel, validateWalkthroughConfig } from '@piwin/contracts';

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
      provider.protocol !== 'anthropic-compatible' &&
      provider.protocol !== 'google-gemini'
    ) {
      issues.push({
        path: `${base}.protocol`,
        message: 'protocol must be openai-compatible, anthropic-compatible, or google-gemini',
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

    if (!Array.isArray(provider.models)) {
      issues.push({ path: `${base}.models`, message: 'models must be an array' });
    } else {
      // Empty models are allowed: user can add via discovery after saving connection.
      provider.models.forEach((model, modelIndex) => {
        if (!model.id?.trim()) {
          issues.push({
            path: `${base}.models[${modelIndex}].id`,
            message: 'model id is required',
          });
        }
        if (
          model.contextWindow !== undefined &&
          (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0)
        ) {
          issues.push({
            path: `${base}.models[${modelIndex}].contextWindow`,
            message: 'contextWindow must be a positive integer',
          });
        }
        if (
          model.maxOutputTokens !== undefined &&
          (!Number.isSafeInteger(model.maxOutputTokens) || model.maxOutputTokens <= 0)
        ) {
          issues.push({
            path: `${base}.models[${modelIndex}].maxOutputTokens`,
            message: 'maxOutputTokens must be a positive integer',
          });
        }
        if (model.thinkingLevels !== undefined) {
          if (
            !Array.isArray(model.thinkingLevels) ||
            model.thinkingLevels.length === 0
          ) {
            issues.push({
              path: `${base}.models[${modelIndex}].thinkingLevels`,
              message: 'thinkingLevels must be a non-empty array when provided',
            });
          } else {
            const seenLevels = new Set<string>();
            for (const [levelIndex, level] of model.thinkingLevels.entries()) {
              if (!isThinkingLevel(level)) {
                issues.push({
                  path: `${base}.models[${modelIndex}].thinkingLevels[${levelIndex}]`,
                  message: 'thinkingLevels contains an unsupported value',
                });
              } else if (seenLevels.has(level)) {
                issues.push({
                  path: `${base}.models[${modelIndex}].thinkingLevels[${levelIndex}]`,
                  message: 'thinkingLevels must not contain duplicates',
                });
              }
              seenLevels.add(String(level));
            }
            if (
              model.thinkingLevel !== undefined &&
              !model.thinkingLevels.includes(model.thinkingLevel)
            ) {
              issues.push({
                path: `${base}.models[${modelIndex}].thinkingLevel`,
                message: 'thinkingLevel must be included in thinkingLevels',
              });
            }
          }
        }
        if (model.tooltipMarkdown !== undefined && model.tooltipMarkdown.length > 4096) {
          issues.push({
            path: `${base}.models[${modelIndex}].tooltipMarkdown`,
            message: 'tooltipMarkdown must be 4096 characters or fewer',
          });
        }
      });
    }

    if (provider.headers !== undefined) {
      if (
        typeof provider.headers !== 'object' ||
        provider.headers === null ||
        Array.isArray(provider.headers)
      ) {
        issues.push({
          path: `${base}.headers`,
          message: 'headers must be an object of string pairs',
        });
      } else {
        const entries = Object.entries(provider.headers);
        if (entries.length > 32) {
          issues.push({ path: `${base}.headers`, message: 'headers supports at most 32 entries' });
        }
        const seenNames = new Set<string>();
        for (const [headerName, headerValue] of entries) {
          const name = headerName.trim();
          if (!name) {
            issues.push({ path: `${base}.headers`, message: 'header name is required' });
            continue;
          }
          if (name.length > 128 || /[\r\n]/.test(name)) {
            issues.push({
              path: `${base}.headers.${name}`,
              message: 'header name is invalid',
            });
          }
          const lower = name.toLowerCase();
          if (seenNames.has(lower)) {
            issues.push({
              path: `${base}.headers.${name}`,
              message: 'duplicate header name',
            });
          }
          seenNames.add(lower);
          if (typeof headerValue !== 'string') {
            issues.push({
              path: `${base}.headers.${name}`,
              message: 'header value must be a string',
            });
          } else if (headerValue.length > 4096 || /[\r\n]/.test(headerValue)) {
            issues.push({
              path: `${base}.headers.${name}`,
              message: 'header value is invalid or too long',
            });
          }
        }
      }
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
  const issues: ProviderValidationIssue[] = validateProviders(config.providers);
  const walkthrough = config.walkthrough ?? createDefaultWalkthroughConfig();
  for (const issue of validateWalkthroughConfig(walkthrough)) {
    issues.push({ path: issue.path, message: issue.message });
  }
  return issues;
}

/**
 * Strip accidental raw secrets from provider fields before persist.
 * Returns a sanitized copy; never mutates input.
 */
export function sanitizeProvidersForSave(providers: readonly ModelProviderConfig[]): {
  providers: ModelProviderConfig[];
  redactedFields: string[];
} {
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
