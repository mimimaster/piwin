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
  /**
   * Whether to inject a custom generation prompt.
   * Walkthrough is always generated when a plan completes (not gated by this flag).
   * When true, `custom.prompt` is injected. When false, no prompt is injected —
   * the model generates freely from the system prompt + evidence (Pi norm).
   */
  enabled: boolean;
  /**
   * Retired: per-turn auto-generation after every completed run.
   * Always normalized to false. Walkthrough generation now happens on plan
   * completion, not on ordinary chat turns.
   */
  autoGenerate: boolean;
  /**
   * Retired: concise-prompt injection into live agent turns.
   * Kept for config shape compatibility only.
   */
  concisePrompt: string;
  /**
   * Retired: always normalized to `default`.
   * Generation always uses the session/message model.
   */
  mode: WalkthroughMode;
  /**
   * `custom.prompt` is the user-editable generation prompt.
   * When `enabled` is true, this prompt is injected. When false, it is not injected.
   * `custom.model` is ignored and always null.
   */
  custom: WalkthroughCustomConfig;
};

export const MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024;

export const DEFAULT_WALKTHROUGH_PROMPT = `<walkthrough_template version="3">
Generate a clean, structured delivery document from the provided evidence.

## Required Sections (omit any section if unsupported by evidence)
# [Task Title]
## Summary: Core objective and delivered outcome.
## Changes: Modified files (\`[MODIFY]|[NEW]|[DELETE]\`) and critical diffs.
## Validation: Test/build commands executed with actual stdout/stderr outcomes.
## How to Verify: Concrete steps for a human reviewer to reproduce the verification.
## Open Items: Remaining risks, deferred tasks, or follow-ups (if any).

Rules: Omit empty sections. Match the user's primary language. Zero secrets, zero hallucination.
</walkthrough_template>`;

/**
 * Default concise response prompt injected into the model's context when
 * `autoGenerate` is enabled and a plan is active. Tells the model to keep
 * its inline response brief since a detailed walkthrough will be generated
 * separately. Users can edit this in settings.
 */
export const DEFAULT_CONCISE_PROMPT = [
  '[piwin-prompt-meta kind="concise-chat" version="2" applies="when-enabled"]',
  '<walkthrough-context priority="critical">',
  '  <instruction>',
  '    A detailed Walkthrough Artifact is generated after this turn.',
  '    Success for chat: 2-3 sentences on whether the request is fulfilled and what changed.',
  '    Put diffs, long paths, and validation logs in the walkthrough — not in chat.',
  '  </instruction>',
  '</walkthrough-context>',
].join('\n');

export const DEFAULT_CONCISE_PROMPT_ZH = [
  '[piwin walkthrough context]',
  '本轮对话结束后将自动生成详细的 Walkthrough。',
  '请保持主回答简洁：用 2-3 句话总结输出结果。',
  '不要在聊天框中重复贴大段代码块、文件路径或逐步说明——后续的 Walkthrough 将包含这些内容。',
  '[end walkthrough context]',
].join('\n');

/** Provider protocols accepted by `WalkthroughCustomConfig.model`. */
const SUPPORTED_WALKTHROUGH_PROTOCOLS: readonly NonNullable<ModelRef['protocol']>[] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
];

export function createDefaultWalkthroughConfig(): WalkthroughConfig {
  // Walkthrough is always generated on plan completion. `enabled` controls
  // whether a custom prompt is injected (true = inject, false = no prompt,
  // model generates freely per Pi norm).
  return {
    enabled: true,
    autoGenerate: false,
    concisePrompt: DEFAULT_CONCISE_PROMPT,
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

  if (typeof config.autoGenerate !== 'boolean') {
    issues.push({ path: 'walkthrough.autoGenerate', message: 'must be a boolean' });
  }

  if (typeof config.concisePrompt !== 'string' || config.concisePrompt.trim() === '') {
    issues.push({ path: 'walkthrough.concisePrompt', message: 'must be a non-empty string' });
  }

  if (config.mode !== 'default' && config.mode !== 'custom') {
    issues.push({ path: 'walkthrough.mode', message: "must be 'default' or 'custom'" });
  }

  // ADR 0026: generation always uses custom.prompt (session model, no model picker).
  const prompt = config.custom?.prompt;
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    issues.push({ path: 'walkthrough.custom.prompt', message: 'must be a non-empty string' });
  } else {
    const byteLength = new TextEncoder().encode(prompt).length;
    if (byteLength > MAX_WALKTHROUGH_PROMPT_BYTES) {
      issues.push({
        path: 'walkthrough.custom.prompt',
        message: `exceeds ${MAX_WALKTHROUGH_PROMPT_BYTES} bytes (${byteLength})`,
      });
    }
  }

  // custom.model is ignored product-wise; if present in a hand-edited file, still
  // validate shape so normalize/validate do not crash on junk.
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

  // ADR 0026 product shape:
  // - autoGenerate: always false (no every-turn auto; host never auto-triggers)
  // - mode: always default (no custom-model mode)
  // - custom.model: always null (use session/message model)
  // - custom.prompt: preserved user-editable generation prompt
  // - enabled: user-controlled; default true (inject custom prompt)
  // - Walkthrough generation always happens on plan completion regardless of enabled
  const enabled = typeof record.enabled === 'boolean' ? record.enabled : defaults.enabled;
  const autoGenerate = false;
  const mode: WalkthroughMode = 'default';
  const concisePrompt =
    typeof record.concisePrompt === 'string' && record.concisePrompt.trim() !== ''
      ? record.concisePrompt
      : defaults.concisePrompt;

  const prompt =
    customRecord && typeof customRecord.prompt === 'string' && customRecord.prompt.trim() !== ''
      ? customRecord.prompt
      : defaults.custom.prompt;

  return {
    enabled,
    autoGenerate,
    concisePrompt,
    mode,
    custom: {
      model: null,
      prompt,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
