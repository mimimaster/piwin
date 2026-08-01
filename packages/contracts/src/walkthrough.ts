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
  /** When true, walkthroughs auto-generate after eligible runs without a button click. */
  autoGenerate: boolean;
  /**
   * The "be brief" prompt injected into the model's context when autoGenerate is on
   * and a plan is active. Tells the model to keep its inline response concise since
   * a detailed walkthrough will be generated separately.
   */
  concisePrompt: string;
  mode: WalkthroughMode;
  custom: WalkthroughCustomConfig;
};

export const MAX_WALKTHROUGH_PROMPT_BYTES = 16 * 1024;

export const DEFAULT_WALKTHROUGH_PROMPT = [
  'Generate a developer-facing delivery document for the completed coding-agent turn.',
  '',
  'Follow Google’s Dual-Track model:',
  '- Track 1 (Inline chat): Handles the brief high-level summary.',
  '- Track 2 (This document): Carries the detailed evidence, diffs, diagrams, and verification details.',
  '',
  'Choose an appropriate H1 title suited to the task (e.g., `# Walkthrough`, `# Technical Overview`, `# Implementation Summary`).',
  'Organize with clean Markdown sections appropriate for the evidence. Include these sections when relevant:',
  '- ## Summary (Brief objective and outcome)',
  '- ## What Changed (Files modified with diffs and action badges [MODIFY], [NEW], [DELETE])',
  '- ## Technical Details (Architecture breakdown; use Mermaid diagrams for multi-module or service-level changes)',
  '- ## Validation (Commands, automated tests, and verification results)',
  '- ## How to Verify (Clear instructions for manual or automated testing)',
  '- ## Notes / Unresolved Items (Any remaining items, risks, or next steps)',
  '',
  'Omit sections that do not apply (e.g. do not include ## What Changed if no files were modified).',
  'Use only facts supported by the supplied evidence. Do not reproduce long tool output or include secrets.',
  'Respond in the primary language of the user request.',
].join('\n');

/**
 * Default concise response prompt injected into the model's context when
 * `autoGenerate` is enabled and a plan is active. Tells the model to keep
 * its inline response brief since a detailed walkthrough will be generated
 * separately. Users can edit this in settings.
 */
export const DEFAULT_CONCISE_PROMPT = [
  '<walkthrough-context priority="critical">',
  '  <instruction>',
  '    Coding and verification for this turn are complete. A detailed Walkthrough Artifact will be automatically generated after this turn.',
  '    Keep your inline chat response strictly concise, professional, and outcome-driven:',
  "    1. Direct Answer: State whether the user's request is fulfilled and summarize the core changes in 2-3 brief sentences.",
  '    2. No Noise: CRITICAL — NEVER output long code blocks, full file paths, or verbose test logs in this chat response. All implementation details, diffs, and validation logs belong exclusively in the Walkthrough Artifact.',
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
const SUPPORTED_WALKTHROUGH_PROTOCOLS: readonly ModelRef['protocol'][] = [
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
];

export function createDefaultWalkthroughConfig(): WalkthroughConfig {
  return {
    enabled: true,
    autoGenerate: true,
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

  // Prompt is only used for generation in custom mode; default mode uses the
  // built-in DEFAULT_WALKTHROUGH_PROMPT and ignores `custom.prompt`, so prompt
  // issues are only surfaced in custom mode (spec §6.2).
  if (config.mode === 'custom') {
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
  }

  const model = config.custom?.model;
  // In custom mode a generation model is required; default mode uses the
  // Antigravity public structure and needs no model.
  if (config.mode === 'custom' && (model === null || model === undefined)) {
    issues.push({
      path: 'walkthrough.custom.model',
      message: 'a generation model is required in custom mode',
    });
  } else if (model !== null && model !== undefined) {
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
  const autoGenerate =
    typeof record.autoGenerate === 'boolean' ? record.autoGenerate : defaults.autoGenerate;
  const concisePrompt =
    typeof record.concisePrompt === 'string' && record.concisePrompt.trim() !== ''
      ? record.concisePrompt
      : defaults.concisePrompt;

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
    autoGenerate,
    concisePrompt,
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
