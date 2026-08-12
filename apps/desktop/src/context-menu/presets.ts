/**
 * Preset prompt templates for context-menu AI actions (CM L5 / §7.3).
 */
export const PRESET_TEMPLATES = {
  explain:
    'Explain the attached context. Be concrete about behavior, edge cases, and risks.',
  fix: 'Fix the attached code or error. Keep the change minimal and state assumptions.',
  review: 'Review the attached change. List issues by severity with concrete fixes.',
  tests: 'Propose focused tests for the attached code. Include cases and rationale.',
  'explain-failure': 'Explain why this failed and the most likely root cause.',
  'fix-error':
    'Fix this error. Inspect related files as needed and apply a minimal fix.',
} as const;

export type PresetTemplateId = keyof typeof PRESET_TEMPLATES;
