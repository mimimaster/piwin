/** CE-CRON / CE-HOOK / CE-TODO contracts. */

export type AutomationConfig = {
  enabled?: boolean;
  cronEnabled?: boolean;
  hooksEnabled?: boolean;
};

export type CronJobType = 'prompt' | 'bash' | 'http';

export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  /** Cron expression or alias like @hourly / @daily / every:1m (test). */
  schedule: string;
  type: CronJobType;
  projectPath?: string;
  promptText?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  method?: 'GET' | 'POST';
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastError?: string;
};

export type CronJobDocument = {
  version: 1;
  jobs: CronJob[];
};

export type HookEventName =
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'tool_execution_end';

export type HookAction =
  | { type: 'shell'; command: string; args?: string[]; cwd?: string; timeoutMs?: number }
  | { type: 'http'; url: string; method?: 'GET' | 'POST'; headers?: Record<string, string> };

export type HookDefinition = {
  id: string;
  enabled: boolean;
  event: HookEventName;
  action: HookAction;
  toolNamePrefix?: string;
};

export type HooksDocument = {
  version: 1;
  hooks: HookDefinition[];
};

export type SessionTodoStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';

export type SessionTodoItem = {
  id: string;
  content: string;
  status: SessionTodoStatus;
};

export type SessionTodoList = {
  sessionId: string;
  items: SessionTodoItem[];
  updatedAt: string;
  /** Hash of items; used as the `todo/set` CAS token. */
  revision: string;
};

export function createDefaultAutomationConfig(): AutomationConfig {
  return {
    enabled: false,
    cronEnabled: false,
    hooksEnabled: false,
  };
}
