/**
 * Managed process contracts (CE-PROC).
 * Domain package `@piwin/process` owns registry; host owns tools/IPC/dispose.
 */

export type ManagedProcessStatus =
  | 'starting'
  | 'running'
  | 'exited'
  | 'error'
  | 'stopped';

/** Long-running job registered by host process manager. */
export type ManagedProcessRecord = {
  id: string;
  /** Executable or entry command (display / audit). */
  command: string;
  /** Argv array only — never a shell string. */
  argv: string[];
  cwd: string;
  status: ManagedProcessStatus;
  pid?: number;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  lastError?: string;
  sessionId?: string;
  projectPath?: string;
  label?: string;
  killOnSessionEnd?: boolean;
};

export type ManagedProcessStartInput = {
  command: string;
  argv: string[];
  cwd: string;
  sessionId?: string;
  projectPath?: string;
  label?: string;
  /** Secret-like env values must be redacted in logs by implementers. */
  env?: Record<string, string>;
  /** Default false (W1): process outlives the agent session. */
  killOnSessionEnd?: boolean;
};

export type ManagedProcessLogChunk = {
  processId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  at: string;
};

export type ManagedProcessLogsQuery = {
  processId: string;
  /** Byte or line offset for tail/pagination (implementation-defined). */
  offset?: number;
  limit?: number;
};

/** Product config under `PiwinConfig.process`. */
export type ProcessConfig = {
  enabled?: boolean;
  /** Hard cap on concurrent managed processes (default 8 in package). */
  maxProcesses?: number;
  killOnSessionEnd?: boolean;
  /** Default true: dispose kills remaining children. */
  killOnHostDispose?: boolean;
};

export function createDefaultProcessConfig(): ProcessConfig {
  return {
    enabled: true,
    maxProcesses: 8,
    killOnSessionEnd: false,
    killOnHostDispose: true,
  };
}
