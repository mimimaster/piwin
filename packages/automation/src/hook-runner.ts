import { spawn } from 'node:child_process';
import type { HookDefinition, HookEventName } from '@piwin/contracts';

export type HookRunContext = {
  sessionId?: string;
  projectPath?: string;
  event: HookEventName;
  toolName?: string;
  extra?: Record<string, unknown>;
};

export type HookRunResult = {
  hookId: string;
  ok: boolean;
  message?: string;
};

export async function runMatchingHooks(
  hooks: HookDefinition[],
  context: HookRunContext,
): Promise<HookRunResult[]> {
  const results: HookRunResult[] = [];
  for (const hook of hooks) {
    if (!hook.enabled || hook.event !== context.event) continue;
    if (
      hook.toolNamePrefix &&
      context.toolName &&
      !context.toolName.startsWith(hook.toolNamePrefix)
    ) {
      continue;
    }
    results.push(await runOneHook(hook, context));
  }
  return results;
}

async function runOneHook(
  hook: HookDefinition,
  context: HookRunContext,
): Promise<HookRunResult> {
  try {
    if (hook.action.type === 'shell') {
      await runShellHook(hook, context);
      return { hookId: hook.id, ok: true };
    }
    // HTTP hooks: best-effort fetch with short timeout; no secrets in env.
    const method = hook.action.method ?? 'POST';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const init: RequestInit = {
        method,
        headers: {
          'content-type': 'application/json',
          ...(hook.action.headers ?? {}),
        },
        signal: controller.signal,
      };
      if (method !== 'GET') {
        init.body = JSON.stringify(buildEventPayload(context));
      }
      const response = await fetch(hook.action.url, init);
      if (!response.ok) {
        return {
          hookId: hook.id,
          ok: false,
          message: `http ${response.status}`,
        };
      }
      return { hookId: hook.id, ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { hookId: hook.id, ok: false, message };
  }
}

function buildEventPayload(context: HookRunContext): Record<string, unknown> {
  return {
    event: context.event,
    sessionId: context.sessionId,
    projectPath: context.projectPath,
    toolName: context.toolName,
    ...(context.extra ?? {}),
  };
}

function runShellHook(hook: HookDefinition, context: HookRunContext): Promise<void> {
  if (hook.action.type !== 'shell') {
    return Promise.resolve();
  }
  const timeoutMs = hook.action.timeoutMs ?? 15_000;
  const args = hook.action.args ?? [];
  const cwd = hook.action.cwd ?? context.projectPath ?? process.cwd();
  const payload = JSON.stringify(buildEventPayload(context)).slice(0, 4000);
  return new Promise((resolve, reject) => {
    const child = spawn(hook.action.type === 'shell' ? hook.action.command : 'true', args, {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        PIWIN_SESSION_ID: context.sessionId ?? '',
        PIWIN_PROJECT_PATH: context.projectPath ?? '',
        PIWIN_EVENT_JSON: payload,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`hook ${hook.id} timed out`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`hook ${hook.id} exited ${code}`));
    });
  });
}
