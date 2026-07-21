/** Pi Extension registry contracts (product shell; Pi loads at session create). */

export type ExtensionSource = 'bundled' | 'user' | 'project' | 'mapped';

/**
 * Metadata for list/enable UI. Host never executes the module for listing —
 * only Pi DefaultResourceLoader loads extensions when creating a session.
 */
export type ExtensionSummary = {
  id: string;
  name: string;
  description: string;
  source: ExtensionSource;
  /** Absolute path to the extension entry (.ts or directory with index.ts). */
  path: string;
  enabled: boolean;
};

export type ExtensionsConfig = {
  /** Extra extension entry paths (file or directory). */
  extraPaths: string[];
  /** Disabled extension ids (basename without .ts). */
  disabledIds: string[];
};
