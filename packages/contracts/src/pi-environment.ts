/** Detect / preview / apply of a local Pi CLI home into Host-owned state. */

export type PiEnvironmentDetectReason = 'non-default-root' | 'not-found';

export type PiEnvironmentDetectData = {
  available: boolean;
  reason?: PiEnvironmentDetectReason;
  piAgentDir?: string;
};

export type PiEnvironmentPreviewData = {
  available: boolean;
  reason?: PiEnvironmentDetectReason;
  sourcePath?: string;
  missingProviderIds: string[];
  followedExtensionCount: number;
  followedSkillCount: number;
};

export type PiEnvironmentApplyData = {
  ok: boolean;
  skipped: boolean;
  reason?: PiEnvironmentDetectReason;
  copiedProviderIds: string[];
  receiptPath?: string;
};

export type PiEnvironmentHostCommand =
  | { id?: string; type: 'pi-environment/detect' }
  | { id?: string; type: 'pi-environment/preview' }
  | { id?: string; type: 'pi-environment/apply' };
