import type { DesktopRestoreConfig } from '@piwin/contracts';
import { asRecord, isModelProtocol, isThinkingLevel } from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.desktop` window-restore and composer-profile state.
 */

export function normalizeDesktopRestoreConfig(value: unknown): DesktopRestoreConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: DesktopRestoreConfig = {};
  const composerProfile = normalizeDesktopComposerProfile(record.composerProfile);
  if (composerProfile) {
    normalized.composerProfile = composerProfile;
  }
  const lastSession = asRecord(record.lastSession);
  const scopeRecord = asRecord(lastSession?.scope);
  if (lastSession && typeof lastSession.sessionId === 'string' && lastSession.sessionId.trim()) {
    if (scopeRecord?.kind === 'general') {
      normalized.lastSession = {
        sessionId: lastSession.sessionId,
        scope: { kind: 'general' },
      };
    } else if (
      scopeRecord?.kind === 'project' &&
      typeof scopeRecord.projectPath === 'string' &&
      scopeRecord.projectPath.trim()
    ) {
      normalized.lastSession = {
        sessionId: lastSession.sessionId,
        scope: { kind: 'project', projectPath: scopeRecord.projectPath },
      };
    }
  }
  return normalized.composerProfile || normalized.lastSession ? normalized : undefined;
}

export function normalizeDesktopComposerProfile(
  value: unknown,
): NonNullable<DesktopRestoreConfig['composerProfile']> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: NonNullable<DesktopRestoreConfig['composerProfile']> = {};
  const model = asRecord(record.model);
  if (
    model &&
    isModelProtocol(model.protocol) &&
    typeof model.providerId === 'string' &&
    model.providerId.trim() &&
    typeof model.modelId === 'string' &&
    model.modelId.trim()
  ) {
    normalized.model = {
      protocol: model.protocol,
      providerId: model.providerId,
      modelId: model.modelId,
    };
  }
  if (isThinkingLevel(record.thinkingLevel)) {
    normalized.thinkingLevel = record.thinkingLevel;
  }
  return normalized.model || normalized.thinkingLevel ? normalized : undefined;
}
