/** Runtime protection is separate from the picture-delivery lease lifecycle. */
export type BrowserResidencyProtection =
  | 'visible' | 'busy' | 'agent' | 'dialog' | 'download' | 'interaction'
  | 'external' | 'restoring' | 'page-state';

export type BrowserResidencySnapshot = {
  resident: boolean;
  lastUsedAtMs: number;
  eligible: boolean;
  protection?: BrowserResidencyProtection;
};

export type BrowserIdleSuspensionResult = {
  suspended: boolean;
  reason?: BrowserResidencyProtection | 'not-resident' | 'recently-used';
};
