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

export const DEFAULT_WALKTHROUGH_PROMPT = [
  'Generate a detailed, developer-facing delivery document for the completed coding-agent turn.',
  '',
  'Follow Google’s Dual-Track model:',
  '- Track 1 (Inline chat): Handles the brief high-level summary.',
  '- Track 2 (This document): Carries the detailed evidence, diffs, diagrams, and verification details.',
  '',
  'Choose an appropriate H1 title suited to the task (e.g., `# Walkthrough`, `# Technical Overview`, `# Implementation Summary`).',
  'Organize with clean Markdown sections appropriate for the evidence. Include these sections when relevant:',
  '- ## Summary (Brief objective and outcome)',
  '- ## What Changed (Files modified with action badges, diffs, and code samples)',
  '- ## Technical Details (Architecture breakdown; use Mermaid diagrams for multi-module or service-level changes)',
  '- ## Validation (Commands, automated tests, and verification results)',
  '- ## How to Verify (Clear instructions for manual or automated testing)',
  '- ## Notes / Unresolved Items (Any remaining items, risks, or next steps)',
  '',
  'Formatting requirements — the delivery UI renders these as rich components, so follow them exactly:',
  '',
  '1. File changes: one line per changed file, starting with an action badge, a language tag, and the path:',
  '   - [MODIFY] TS src/utils.ts',
  '   - [NEW] TS src/logger.ts',
  '   - [DELETE] TS src/legacy.ts',
  '   Use only [MODIFY], [NEW], or [DELETE]; put each entry on its own line.',
  '',
  '2. Diffs: show a real unified diff of the key change inside a fenced code block tagged `diff`.',
  '   Prefix added lines with `+ ` and removed lines with `- `; keep context lines unprefixed:',
  '   ```diff',
  '   - const OLD_TIMEOUT_MS = 5_000;',
  '   + const TIMEOUT_MS = 10_000;',
  '   ```',
  '',
  '3. Code samples: when the evidence supports it, include at least one representative code block',
  '   of 20+ lines (e.g. the new logger class or the refactored function). The UI automatically',
  '   folds blocks longer than 16 lines behind an Expand button, so long blocks are expected.',
  '',
  '4. Build and test logs: never paste long logs inline. Wrap the full log inside an HTML',
  '   <details> block so the UI renders it as a click-to-expand section:',
  '   <details><summary>Build & test logs</summary>',
  '   ```log',
  '   ... full output ...',
  '   ```',
  '   </details>',
  '',
  '5. Task checklist: summarize completed vs. pending work as a checklist:',
  '   - [x] Refactor timeout handling in src/utils.ts',
  '   - [x] Add structured logger in src/logger.ts',
  '   - [ ] Ship migration guide for callers',
  '',
  '6. Callouts: use GitHub-style callouts for emphasis:',
  '   > [!NOTE] The public API surface is unchanged; this is an internal refactor.',
  '   > [!TIP] Run `pnpm test --filter @piwin/contracts` to verify the new checks.',
  '',
  '7. Section dividers: separate major document sections with horizontal rules (`---` or `-----`) for clean visual sectioning.',
  '',
  'Omit sections that do not apply (e.g. do not include ## What Changed if no files were modified).',
  'Always format all referenced file paths (modified, created, or mentioned) as Markdown code links or path chips (e.g. `[`filename.ext`](file:///path/to/file.ext)` or `path/to/file.ext`) so users can click any file path to open and inspect the actual file content in the document viewer tab.',
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
