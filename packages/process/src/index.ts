// Phase 1: Unified Job Control exports
export { createJobRegistry } from './job-registry.js';
export type {
  JobPolicy,
  JobRegistryEvent,
  JobRegistryOptions,
} from './job-registry.js';

export {
  createFileRecordStore,
  createMemoryRecordStore,
} from './job-record-store.js';
export type {
  JobRecordStore,
  JobRecordStoreOptions,
} from './job-record-store.js';

export { createJobLogStore } from './job-log-store.js';
export type {
  JobLogStore,
  JobLogReadInput,
  JobLogReadResult,
} from './job-log-store.js';

export { createProcessSupervisor } from './process-supervisor.js';
export type {
  ProcessSupervisor,
  ProcessSupervisorOptions,
  ProcessSpawnInput,
  SupervisedProcess,
} from './process-supervisor.js';

// Existing exports (cwd policy + redaction remain shared utilities)
export { canonicalFsPath, isPathInsideRoot, resolveTrustedCwd } from './cwd-policy.js';
export type { CwdPolicyResult } from './cwd-policy.js';
export { redactSecretText } from './redact-logs.js';
