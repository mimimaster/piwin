import type { AutomationConfig, HookAction, HookDefinition, HookEventName } from '@piwin/contracts';

export const USER_HOOK_EVENTS: readonly HookEventName[] = [
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'tool_execution_end',
];

export function isHooksArmed(automation: AutomationConfig | undefined): boolean {
  return automation?.enabled === true && automation?.hooksEnabled === true;
}

export function formatHookAction(action: HookAction): string {
  if (action.type === 'shell') {
    return [action.command, ...(action.args ?? [])].filter((part) => part.length > 0).join(' ');
  }
  return action.url;
}

export function createUserHook(input: {
  event: HookEventName;
  actionType: 'shell' | 'http';
  commandOrUrl: string;
}): HookDefinition | null {
  const value = input.commandOrUrl.trim();
  if (!value) {
    return null;
  }
  const id = `hook-${crypto.randomUUID()}`;
  if (input.actionType === 'http') {
    return {
      id,
      enabled: true,
      event: input.event,
      action: { type: 'http', url: value, method: 'POST' },
    };
  }
  const [command, ...args] = value.split(/\s+/);
  if (!command) {
    return null;
  }
  return {
    id,
    enabled: true,
    event: input.event,
    action: args.length > 0 ? { type: 'shell', command, args } : { type: 'shell', command },
  };
}

export function replaceHook(
  hooks: readonly HookDefinition[],
  hookId: string,
  patch: Partial<Pick<HookDefinition, 'enabled'>>,
): HookDefinition[] {
  return hooks.map((hook) => (hook.id === hookId ? { ...hook, ...patch } : hook));
}

export function removeHook(hooks: readonly HookDefinition[], hookId: string): HookDefinition[] {
  return hooks.filter((hook) => hook.id !== hookId);
}
