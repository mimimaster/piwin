import { vi } from 'vitest';
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import extension from '../index.js';

export const ALL_TOOLS = ['piwin_toolbox'];
export function harness(hasUI = true, tools = ALL_TOOLS) {
  const events = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const commands = new Map<string, { description: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  let local!: ToolDefinition<any, any>;
  const pi = {
    on: (name: string, handler: any) => events.set(name, handler),
    registerCommand: (name: string, spec: any) => { commands.set(name, spec); },
    registerTool: (tool: ToolDefinition<any, any>) => { local = tool; },
    getAllTools: vi.fn(() => tools.map(name => ({ name }))),
    setActiveTools: vi.fn(), exec: vi.fn(), appendEntry: vi.fn(), sendMessage: vi.fn(), sendUserMessage: vi.fn(),
  };
  const ctx = { hasUI, signal: undefined, isIdle: vi.fn(() => true), waitForIdle: vi.fn(async () => undefined),
    ui: {
      notify: vi.fn(), setStatus: vi.fn(), setWidget: vi.fn(), confirm: vi.fn(async () => true),
      select: vi.fn(async (_title: string, options: string[]) => options[0] as string | undefined), input: vi.fn(async () => 'topic' as string | undefined),
    } } as unknown as ExtensionCommandContext;
  extension(pi as unknown as ExtensionAPI);
  return {
    pi, ctx, local, commands,
    ui: ctx.ui as unknown as Record<'notify' | 'setStatus' | 'setWidget' | 'confirm' | 'select' | 'input', ReturnType<typeof vi.fn>>,
    command: (name: string, args = '') => {
      const command = commands.get(name);
      if (!command) throw new Error(`Missing command: ${name}`);
      return command.handler(args, ctx);
    },
    event: async (name: string, event: any = {}) => events.get(name)?.(event, ctx),
    execute: async (params: unknown, signal?: AbortSignal) => {
      const result = await local.execute('local-call', params, signal, undefined, ctx);
      const text = (result.content[0] as { text: string }).text;
      return { text, rejected: Boolean((result.details as { rejected?: boolean }).rejected), json: () => JSON.parse(text) };
    },
    prompt: async (): Promise<string | undefined> => (await events.get('before_agent_start')?.({ systemPrompt: 'Original coding rules.', prompt: 'user' }, ctx))?.systemPrompt,
  };
}
export function call(name: string, args: Record<string, unknown>, toolbox = false) {
  return { type: 'tool_call', toolCallId: 'native-call', toolName: toolbox ? 'piwin_toolbox' : name,
    input: toolbox ? { action: 'call', target: name, arguments: args } : args };
}
