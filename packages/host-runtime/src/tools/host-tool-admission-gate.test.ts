import { describe, expect, it } from 'vitest';
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionMode,
} from '@piwin/contracts';
import { createEmptyRuleSet } from '@piwin/contracts';
import { createHostToolPermissionGate } from './host-tool-admission-gate.js';

function gatewayRegistration(): HostToolRegistration {
  return {
    descriptor: {
      name: 'mcp_gateway',
      description: 'MCP gateway',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['search', 'describe', 'call', 'status'] } },
      },
    },
    family: 'mcp',
    permissionSpec: {
      action: 'mcp:trusted',
      risk: 'mcp',
      rememberable: false,
      admission: 'trusted',
    },
    execute: async () => ({ ok: true, output: 'ok' }),
  };
}

const context: HostToolExecutionContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'generation-1',
  runId: 'run-1',
  toolName: 'mcp_gateway',
};

describe('createHostToolPermissionGate', () => {
  it('allows Host-owned plan artifact writes in ask-all mode without prompting', async () => {
    let promptCount = 0;
    const gate = createHostToolPermissionGate({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'ask-all',
      requestPermission: async () => {
        promptCount += 1;
        return 'deny';
      },
      projectRoot: '/tmp',
      mcpEnabledServerIds: [],
    });
    const registration: HostToolRegistration = {
      descriptor: {
        name: 'piwin_plan_create',
        description: 'persist plan',
        parameters: { type: 'object', properties: {} },
      },
      family: 'planning',
      permissionSpec: {
        action: 'planning:create',
        risk: 'unknown',
        rememberable: false,
      },
      execute: async () => ({ ok: true, output: 'persisted' }),
    };

    const decision = await gate({
      registration,
      args: {},
      context: { ...context, toolName: registration.descriptor.name },
      signal: new AbortController().signal,
    });

    expect(decision.allowed).toBe(true);
    expect(promptCount).toBe(0);
  });

  it('treats MCP as local trusted execution without permission prompts', async () => {
    const gate = createHostToolPermissionGate({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'auto',
      projectRoot: '/tmp',
      mcpEnabledServerIds: ['docs'],
    });

    const decision = await gate({
      registration: gatewayRegistration(),
      args: { action: 'call' },
      context,
      signal: new AbortController().signal,
    });

    expect(decision.allowed).toBe(true);
  });

  it('does not enter ask-all mode for MCP calls', async () => {
    let mode: PermissionMode = 'auto';
    let promptCount = 0;
    const gate = createHostToolPermissionGate({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => mode,
      requestPermission: async () => {
        promptCount += 1;
        return 'allow';
      },
      projectRoot: '/tmp',
      mcpEnabledServerIds: ['docs'],
    });

    const registration = gatewayRegistration();
    const first = await gate({
      registration,
      args: { action: 'call', selector: 'docs.search', arguments: { query: 'x' } },
      context,
      signal: new AbortController().signal,
    });
    expect(first.allowed).toBe(true);
    expect(promptCount).toBe(0);

    mode = 'ask-all';
    const second = await gate({
      registration,
      args: { action: 'call', selector: 'docs.search', arguments: { query: 'x' } },
      context,
      signal: new AbortController().signal,
    });
    expect(second.allowed).toBe(true);
    expect(promptCount).toBe(0);
  });

  it('uses session-scoped bash approvals without overriding an explicit deny', async () => {
    const allowlist = new Set(['rm -rf /tmp/approved']);
    const gate = createHostToolPermissionGate({
      rules: {
        deny: [
          {
            target: { kind: 'bash', pattern: 'rm -rf /tmp/blocked' },
            decision: 'deny',
            reason: 'blocked-by-bundled-policy',
          },
        ],
        ask: [
          {
            target: { kind: 'bash', pattern: 'rm -rf *' },
            decision: 'ask',
            reason: 'destructive-command',
          },
        ],
        allow: [],
      },
      getPermissionMode: () => 'auto',
      getSessionAllowlist: () => ({
        hasBashCommand: (command) => allowlist.has(command),
        hasFilePath: () => false,
      }),
      projectRoot: '/tmp',
      mcpEnabledServerIds: [],
    });

    const registration: HostToolRegistration = {
      descriptor: {
        name: 'bash',
        description: 'bash',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
      family: 'shell',
      permissionSpec: {
        action: 'bash',
        risk: 'command',
        rememberable: false,
        subjectBuilder: (args) => ({ kind: 'bash', command: String(args.command ?? '') }),
      },
      execute: async () => ({ ok: true, output: 'ok' }),
    };

    const approved = await gate({
      registration,
      args: { command: 'rm -rf /tmp/approved' },
      context: { ...context, toolName: 'bash' },
      signal: new AbortController().signal,
    });
    expect(approved.allowed).toBe(true);

    const denied = await gate({
      registration,
      args: { command: 'rm -rf /tmp/blocked' },
      context: { ...context, toolName: 'bash' },
      signal: new AbortController().signal,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.result).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('does not treat browser screenshot output as read-only file access', async () => {
    const gate = createHostToolPermissionGate({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'auto',
      projectRoot: '/tmp/project',
      mcpEnabledServerIds: [],
    });
    const registration: HostToolRegistration = {
      descriptor: {
        name: 'browser_screenshot',
        description: 'browser screenshot',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
      family: 'browser',
      permissionSpec: {
        action: 'browser:screenshot',
        risk: 'file-write',
        rememberable: false,
        subjectBuilder: (args) =>
          typeof args.path === 'string' && args.path.length > 0
            ? { kind: 'file-write', path: args.path }
            : { kind: 'tool', action: 'browser:screenshot' },
      },
      execute: async () => ({ ok: true, output: 'ok' }),
    };

    const result = await gate({
      registration,
      args: { path: '/etc/piwin-shot.jpg' },
      context: { ...context, toolName: 'browser_screenshot' },
      signal: new AbortController().signal,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.result).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('fails closed when the interactive permission resolver throws', async () => {
    const diagnostics: string[] = [];
    const gate = createHostToolPermissionGate({
      rules: {
        deny: [],
        ask: [
          {
            target: { kind: 'bash', pattern: 'danger *' },
            decision: 'ask',
            reason: 'requires-review',
          },
        ],
        allow: [],
      },
      getPermissionMode: () => 'auto',
      requestPermission: async () => {
        throw new Error('permission UI unavailable');
      },
      projectRoot: '/tmp',
      mcpEnabledServerIds: [],
      onDiagnostic: (message) => diagnostics.push(message),
    });
    const registration = {
      descriptor: {
        name: 'bash',
        description: 'bash',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
      family: 'shell' as const,
      permissionSpec: {
        action: 'bash',
        risk: 'command' as const,
        rememberable: false,
        subjectBuilder: (args: Record<string, unknown>) => ({
          kind: 'bash' as const,
          command: String(args.command ?? ''),
        }),
      },
      execute: async () => ({ ok: true as const, output: 'must not execute' }),
    } satisfies HostToolRegistration;

    const result = await gate({
      registration,
      args: { command: 'danger rm -rf /' },
      context: { ...context, toolName: 'bash' },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ allowed: false, result: { code: 'permission-denied' } });
    expect(diagnostics[0]).toContain('permission UI unavailable');
  });
});
