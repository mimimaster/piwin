import { describe, expect, it } from 'vitest';
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionMode,
} from '@piwin/contracts';
import { HOST_TOOL_PERMISSION_ACTIONS, createEmptyRuleSet } from '@piwin/contracts';
import { createHostToolAdmission, resolveHostToolAdmission } from './tool-admission.js';

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

async function admit(
  options: Parameters<typeof createHostToolAdmission>[0],
  registration: HostToolRegistration,
  args: Record<string, unknown>,
  toolContext: HostToolExecutionContext = { ...context, toolName: registration.descriptor.name },
) {
  return resolveHostToolAdmission({
    admission: createHostToolAdmission(options),
    registration,
    args,
    context: toolContext,
    signal: new AbortController().signal,
  });
}

describe('host tool admission composition', () => {
  it('allows Host-owned plan artifact writes in ask-all mode without prompting', async () => {
    let promptCount = 0;
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'ask-all',
      requestPermission: async () => {
        promptCount += 1;
        return 'deny';
      },
      projectRoot: '/tmp',
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

    const decision = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: {},
      context: { ...context, toolName: registration.descriptor.name },
      signal: new AbortController().signal,
    });

    expect(decision.allowed).toBe(true);
    expect(promptCount).toBe(0);
  });

  it('treats MCP as local trusted execution without permission prompts', async () => {
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'auto',
      projectRoot: '/tmp',
    });

    const decision = await resolveHostToolAdmission({
      admission: gate,
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
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => mode,
      requestPermission: async () => {
        promptCount += 1;
        return 'allow';
      },
      projectRoot: '/tmp',
    });

    const registration = gatewayRegistration();
    const first = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: { action: 'call', selector: 'docs.search', arguments: { query: 'x' } },
      context,
      signal: new AbortController().signal,
    });
    expect(first.allowed).toBe(true);
    expect(promptCount).toBe(0);

    mode = 'ask-all';
    const second = await resolveHostToolAdmission({
      admission: gate,
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
    const gate = createHostToolAdmission({
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

    const approved = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: { command: 'rm -rf /tmp/approved' },
      context: { ...context, toolName: 'bash' },
      signal: new AbortController().signal,
    });
    expect(approved.allowed).toBe(true);

    const denied = await resolveHostToolAdmission({
      admission: gate,
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
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'auto',
      projectRoot: '/tmp/project',
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

    const result = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: { path: '/etc/piwin-shot.jpg' },
      context: { ...context, toolName: 'browser_screenshot' },
      signal: new AbortController().signal,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.result).toMatchObject({ code: 'permission-denied' });
      if (!result.result.ok) {
        expect(result.result.message).toContain('/etc/piwin-shot.jpg');
        expect(result.result.message).toContain("outside this session's workspace was not approved");
      }
    }
  });

  it('explains a rejected outside-workspace Job cwd to the model', async () => {
    const registration: HostToolRegistration = {
      descriptor: {
        name: 'process_start',
        description: 'start a Job',
        parameters: { type: 'object', properties: { cwd: { type: 'string' } } },
      },
      family: 'process',
      permissionSpec: {
        action: 'process:start',
        risk: 'command',
        rememberable: false,
        subjectBuilder: (args) => ({ kind: 'process', cwd: String(args.cwd ?? '') }),
      },
      execute: async () => ({ ok: true, output: 'ok' }),
    };
    const result = await admit({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'bypass',
      requestPermission: async () => 'deny',
      projectRoot: '/tmp/project',
    }, registration, { command: 'pwd', cwd: '/tmp/other' });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      if (!result.result.ok) {
        expect(result.result.message).toContain('/tmp/other');
        expect(result.result.message).toContain("outside this session's workspace was not approved");
      }
    }
  });

  it('fails closed when the interactive permission resolver throws', async () => {
    const diagnostics: string[] = [];
    const gate = createHostToolAdmission({
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

    const result = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: { command: 'danger rm -rf /' },
      context: { ...context, toolName: 'bash' },
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ allowed: false, result: { code: 'permission-denied' } });
    expect(diagnostics[0]).toContain('permission UI unavailable');
  });

  it('allows video-gen without a prompt so default-allow stays explicit', async () => {
    let promptCount = 0;
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'ask-all',
      requestPermission: async () => {
        promptCount += 1;
        return 'deny';
      },
      projectRoot: '/tmp',
    });
    const registration: HostToolRegistration = {
      descriptor: {
        name: 'video_generate',
        description: 'generate video',
        parameters: { type: 'object', properties: {} },
      },
      family: 'video-generation',
      permissionSpec: {
        action: 'network:video-gen',
        risk: 'network',
        rememberable: false,
        subjectBuilder: () => ({ kind: 'tool', action: 'network:video-gen' }),
      },
      execute: async () => ({ ok: true, output: 'ok' }),
    };

    const decision = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: { prompt: 'a cat' },
      context: { ...context, toolName: registration.descriptor.name },
      signal: new AbortController().signal,
    });

    expect(decision.allowed).toBe(true);
    expect(promptCount).toBe(0);
  });

  it('denies unknown side-effect actions even in bypass', async () => {
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'bypass',
      projectRoot: '/tmp',
    });
    const registration: HostToolRegistration = {
      descriptor: {
        name: 'mystery',
        description: 'mystery',
        parameters: { type: 'object', properties: {} },
      },
      family: 'process',
      permissionSpec: {
        action: 'mystery:mutate',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: () => ({ kind: 'tool', action: 'mystery:mutate' }),
      },
      execute: async () => ({ ok: true, output: 'must not execute' }),
    };

    const decision = await resolveHostToolAdmission({
      admission: gate,
      registration,
      args: {},
      context: { ...context, toolName: registration.descriptor.name },
      signal: new AbortController().signal,
    });

    expect(decision).toMatchObject({
      allowed: false,
      result: { code: 'permission-denied', message: expect.stringContaining('unclassified') },
    });
  });

  it('classifies every catalog action instead of falling through to default allow', async () => {
    const readOnly = new Set([
      'filesystem:read',
      'filesystem:list',
      'process:list',
      'process:logs',
      'browser:snapshot',
      'browser:find',
      'browser:wait',
      'browser:status',
      'browser:console',
      'browser:network',
      'notes:note_list',
      'notes:note_search',
      'notes:note_read',
      'knowledge:knowledge_list',
      'knowledge:knowledge_search',
      'knowledge:knowledge_read',
      'flashcards:list',
      'extensions:list',
      'capabilities:search',
      'artifact:instructions',
      'toolbox:route',
    ]);
    const gate = createHostToolAdmission({
      rules: createEmptyRuleSet(),
      getPermissionMode: () => 'bypass',
      projectRoot: '/tmp',
    });

    for (const action of HOST_TOOL_PERMISSION_ACTIONS) {
      const registration: HostToolRegistration = {
        descriptor: {
          name: `tool-${action}`,
          description: action,
          parameters: { type: 'object', properties: {} },
        },
        family: 'process',
        permissionSpec: {
          action,
          risk: 'unknown',
          rememberable: false,
          ...(action === 'mcp:trusted' ? { admission: 'trusted' as const } : {}),
          ...(readOnly.has(action) ? { readOnly: true } : {}),
          subjectBuilder: () =>
            action === 'bash'
              ? { kind: 'bash', command: 'echo hi' }
              : action === 'file-write'
                ? { kind: 'file-write', path: '/tmp/a' }
                : action === 'network:web_fetch' || action === 'browser:navigate'
                  ? { kind: 'web-fetch', host: 'example.com' }
                  : action === 'browser:upload'
                    ? { kind: 'file-write', path: '/tmp/a' }
                    : action === 'network:web_search'
                      ? { kind: 'web-search' }
                      : { kind: 'tool', action },
        },
        execute: async () => ({ ok: true, output: action }),
      };
      const decision = await resolveHostToolAdmission({
        admission: gate,
        registration,
        args: {
          command: 'echo hi',
          path: '/tmp/a',
          url: 'https://example.com',
          query: 'q',
          noteId: 'n1',
          content: 'hello',
        },
        context: { ...context, toolName: registration.descriptor.name },
        signal: new AbortController().signal,
      });
      expect(decision.allowed, action).toBe(true);
    }
  });
});
