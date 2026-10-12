import { vi } from 'vitest';
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import extension from '../index.js';

export function harness(hasUI = true, tools = ['piwin_toolbox']) {
  const events = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let local!: ToolDefinition<any, any>;
  const pi = {
    on: (name: string, handler: any) => events.set(name, handler),
    registerCommand: (_name: string, spec: any) => { command = spec.handler; },
    registerTool: (tool: ToolDefinition<any, any>) => { local = tool; },
    getAllTools: vi.fn(() => tools.map(name => ({ name }))),
    setActiveTools: vi.fn(), exec: vi.fn(), appendEntry: vi.fn(), sendMessage: vi.fn(),
  };
  const ctx = { hasUI, signal: undefined, isIdle: vi.fn(() => true), waitForIdle: vi.fn(async () => undefined), ui: {
    notify: vi.fn(), setStatus: vi.fn(), confirm: vi.fn(async () => true),
    select: vi.fn(async (_title: string, options: string[]) => options[0]), input: vi.fn(async () => 'topic'),
  } } as unknown as ExtensionCommandContext;
  extension(pi as unknown as ExtensionAPI);
  return {
    pi, ctx, local,
    command: (args: string) => command(args, ctx),
    event: async (name: string, event: any = {}) => events.get(name)?.(event, ctx),
    execute: async (params: unknown, signal?: AbortSignal) => local.execute('local-call', params, signal, undefined, ctx),
    prompt: async () => events.get('before_agent_start')?.({ systemPrompt: 'Original coding rules.', prompt: 'user' }, ctx),
  };
}
export const BASIC = { model: 'basic' as const, front: 'Why close the file?', back: 'Release resources.' };
export const SECOND = { model: 'basic' as const, front: 'Why fsync?', back: 'Persist buffered writes.' };
export const EVIDENCE = { prompt: 'Why close a file?', userAnswer: 'It is optional.', assessment: 'Closing releases descriptors; answer misses that.', nextPractice: 'Explain try/finally close.', gap: 'Resource lifecycle misunderstood.' };
export function call(name: string, args: Record<string, unknown>, toolCallId = 'native-call', toolbox = false) {
  return { type: 'tool_call', toolCallId, toolName: toolbox ? 'piwin_toolbox' : name,
    input: toolbox ? { action: 'call', target: name, arguments: args } : args };
}
export function result(name: string, args: Record<string, unknown>, output: unknown, toolCallId = 'native-call', toolbox = false, isError = false) {
  return { ...call(name, args, toolCallId, toolbox), type: 'tool_result', isError,
    content: [{ type: 'text', text: JSON.stringify(output) }], details: { created: 123 } };
}
