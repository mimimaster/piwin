/**
 * Walkthrough generation config (spec §6.1 / §6.2).
 *
 * Pure types and helpers only — no runtime deps on other `@piwin/*` packages.
 * The agent-host wires these into `createDefaultPiwinConfig()` / `normalizeConfig()`
 * / `validatePiwinConfig()`; contracts keeps the logic pure and unit-testable here.
 */

import type { ModelRef } from './host.js';

export type WalkthroughMode = 'default' | 'custom';

export type WalkthroughCustomConfig = {
  /** Null means the user has not selected a configured model yet. */
  model: ModelRef | null;
  /** User-editable generation instructions. */
  prompt: string;
};

export type WalkthroughConfig = {
  /** Enables the action and creation of new Walkthrough artifacts. */
  enabled: boolean;
  mode: WalkthroughMode;
  custom: WalkthroughCustomConfig;
};

export const MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024;

export const DEFAULT_WALKTHROUGH_PROMPT = [
  'Generate a developer-facing Walkthrough for the completed coding-agent turn.',
  '',
  'Use only facts supported by the supplied evidence. Do not claim that a file, test,',
  'browser flow, screenshot, or command was completed unless the evidence supports it.',
  'Clearly distinguish completed work, verified work, failures, and unresolved items.',
  'Respond in the primary language of the user request.',
  '',
  'Use these Markdown sections when they apply:',
  '# Walkthrough',
  '## Summary',
  '## What Changed',
  '## Technical Details',
  '## Validation',
  '## How to Verify',
  '## Notes / Unresolved Items',
  '',
  'Do not reproduce long tool output. Do not include API keys, tokens, passwords,',
  'environment variable values, or other secrets.',
].join('\n');

/** Provider protocols accepted by `WalkthroughCustomConfig.model`. */
const SUPPORTED_WALKTHROUGH_PROTOCOLS: readonly ModelRef['protocol'][] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
];

export function createDefaultWalkthroughConfig(): WalkthroughConfig {
  return {
    enabled: true,
    mode: 'default',
    custom: {
      model: null,
      prompt: DEFAULT_WALKTHROUGH_PROMPT,
    },
  };
}

/**
 * Validation issue shape, mirroring agent-host's `ProviderValidationIssue`.
 * Kept local so contracts stays a leaf with no cross-package deps.
 */
export type WalkthroughConfigIssue = {
  path: string;
  message: string;
};

/**
 * Pure validation for a `WalkthroughConfig` (spec §6.2).
 * Returns issues; empty array means valid. Never throws.
 */
export function validateWalkthroughConfig(config: WalkthroughConfig): WalkthroughConfigIssue[] {
  const issues: WalkthroughConfigIssue[] = [];

  if (typeof config.enabled !== 'boolean') {
    issues.push({ path: 'walkthrough.enabled', message: 'must be a boolean' });
  }

  if (config.mode !== 'default' && config.mode !== 'custom') {
    issues.push({ path: 'walkthrough.mode', message: "must be 'default' or 'custom'" });
  }

  const prompt = config.custom?.prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    issues.push({ path: 'walkthrough.custom.prompt', message: 'must be a non-empty string' });
  } else {
    const byteLength = Buffer.byteLength(prompt, 'utf8');
    if (byteLength > MAX_WALKTHROUGH_PROMPT_BYTES) {
      issues.push({
        path: 'walkthrough.custom.prompt',
        message: `exceeds ${MAX_WALKTHROUGH_PROMPT_BYTES} bytes (${byteLength})`,
      });
    }
  }

  const model = config.custom?.model;
  if (model !== null && model !== undefined) {
    if (!model.providerId || !model.modelId || !model.protocol) {
      issues.push({
        path: 'walkthrough.custom.model',
        message: 'providerId, modelId and protocol are required when model is set',
      });
    } else if (!SUPPORTED_WALKTHROUGH_PROTOCOLS.includes(model.protocol)) {
      issues.push({
        path: 'walkthrough.custom.model.protocol',
        message: `unsupported protocol: ${model.protocol}`,
      });
    }
  }

  return issues;
}

/**
 * Pure normalizer for the `walkthrough` config block (spec §6.1).
 * Missing or malformed values fall back to defaults; never throws.
 * agent-host's `normalizeConfig()` calls this for the `walkthrough` field.
 */
export function normalizeWalkthroughConfig(value: unknown): WalkthroughConfig {
  const defaults = createDefaultWalkthroughConfig();
  if (!value || typeof value !== 'object') {
    return defaults;
  }
  const record = value as Record<string, unknown>;
  const customRecord = asRecord(record.custom);

  const mode: WalkthroughMode = record.mode === 'custom' ? 'custom' : 'default';
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled;

  const prompt =
    customRecord && typeof customRecord.prompt === 'string' && customRecord.prompt.trim() !== ''
      ? customRecord.prompt
      : defaults.custom.prompt;

  const modelRaw = customRecord ? asRecord(customRecord.model) : null;
  const model: ModelRef | null =
    modelRaw &&
    typeof modelRaw.protocol === 'string' &&
    typeof modelRaw.providerId === 'string' &&
    typeof modelRaw.modelId === 'string' &&
    SUPPORTED_WALKTHROUGH_PROTOCOLS.includes(modelRaw.protocol as ModelRef['protocol'])
      ? {
          protocol: modelRaw.protocol as ModelRef['protocol'],
          providerId: modelRaw.providerId,
          modelId: modelRaw.modelId,
        }
      : null;

  return {
    enabled,
    mode,
    custom: {
      model,
      prompt,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
