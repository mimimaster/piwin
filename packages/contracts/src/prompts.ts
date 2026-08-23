/** Prompt template registry (Pi prompt templates under ~/.piwin/prompts). */

export type PromptTemplateSource = 'bundled' | 'user' | 'project' | 'mapped' | 'pi-native';

export type PromptTemplateSummary = {
  id: string;
  name: string;
  description: string;
  source: PromptTemplateSource;
  path: string;
  enabled: boolean;
};

export type PromptsConfig = {
  /** Extra prompt template files or directories. */
  extraPaths: string[];
  /** Disabled template ids (filename without .md). */
  disabledIds: string[];
};
