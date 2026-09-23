import type { CompactionConfig, SessionConfig } from '@piwin/contracts';
import {
  DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  createDefaultSessionColdStorageConfig,
  normalizeSessionRuntimeRetentionConfig,
} from '@piwin/contracts';
import { asRecord, isNonNegativeInteger, isPositiveInteger } from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.session` incl. cold storage and context compaction.
 */

export function normalizeSessionConfig(value: unknown, defaults: SessionConfig): SessionConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const config: SessionConfig = {};
  if (typeof record.autoName === 'boolean') {
    config.autoName = record.autoName;
  } else if (typeof defaults.autoName === 'boolean') {
    config.autoName = defaults.autoName;
  }
  const retention = asRecord(record.runtimeRetention);
  if (retention) {
    config.runtimeRetention = normalizeSessionRuntimeRetentionConfig({
      ...(typeof retention.idleTtlSeconds === 'number'
        ? { idleTtlSeconds: retention.idleTtlSeconds }
        : {}),
      ...(typeof retention.maxIdleRuntimes === 'number'
        ? { maxIdleRuntimes: retention.maxIdleRuntimes }
        : {}),
      ...(typeof retention.maxResidentRuntimes === 'number'
        ? { maxResidentRuntimes: retention.maxResidentRuntimes }
        : {}),
      ...(typeof retention.memoryHighWaterMiB === 'number'
        ? { memoryHighWaterMiB: retention.memoryHighWaterMiB }
        : {}),
    });
  }
  const lifecycle = asRecord(record.lifecycle);
  const archive = asRecord(lifecycle?.archive);
  if (archive) {
    const normalizedArchive: NonNullable<NonNullable<SessionConfig['lifecycle']>['archive']> = {};
    if (isPositiveInteger(archive.maxInactiveDays)) {
      normalizedArchive.maxInactiveDays = archive.maxInactiveDays;
    }
    if (isNonNegativeInteger(archive.maxActiveMainSessions)) {
      normalizedArchive.maxActiveMainSessions = archive.maxActiveMainSessions;
    }
    if (Object.keys(normalizedArchive).length > 0) {
      config.lifecycle = { archive: normalizedArchive };
    }
  }
  if (record.coldStorage !== undefined) {
    config.coldStorage = normalizeSessionColdStorageConfig(record.coldStorage);
  }
  return config;
}

export function normalizeSessionColdStorageConfig(
  value: unknown,
): NonNullable<SessionConfig['coldStorage']> {
  const defaults = createDefaultSessionColdStorageConfig();
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const config: NonNullable<SessionConfig['coldStorage']> = {
    enabled: record.enabled === true,
    minArchivedAgeDays: isPositiveInteger(record.minArchivedAgeDays)
      ? record.minArchivedAgeDays
      : DEFAULT_COLD_STORAGE_MIN_ARCHIVED_AGE_DAYS,
  };
  if (typeof record.packOutputDir === 'string' && record.packOutputDir.trim().length > 0) {
    config.packOutputDir = record.packOutputDir.trim();
  }
  if (isPositiveInteger(record.localBudgetBytes)) {
    config.localBudgetBytes = record.localBudgetBytes;
  }
  return config;
}

export function normalizeCompactionConfig(
  value: unknown,
  defaults: CompactionConfig,
): CompactionConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const normalized: CompactionConfig = {
    autoEnabledDefault:
      typeof record.autoEnabledDefault === 'boolean'
        ? record.autoEnabledDefault
        : defaults.autoEnabledDefault,
  };
  if (typeof record.writeTranscriptNote === 'boolean') {
    normalized.writeTranscriptNote = record.writeTranscriptNote;
  } else if (typeof defaults.writeTranscriptNote === 'boolean') {
    normalized.writeTranscriptNote = defaults.writeTranscriptNote;
  }
  return normalized;
}
