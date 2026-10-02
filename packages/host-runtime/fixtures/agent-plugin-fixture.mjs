/**
 * Minimal Agent plugin adapter used only by tests (ADR 0082 §验收 fixture).
 *
 * It speaks the piwin-agent-stdio frame protocol directly and never spawns a
 * vendor CLI, so Host behaviour (readiness, permissions, media import,
 * workflows, catalog, cancel) can be verified end to end without a network or
 * a paid CLI. `PIWIN_FIXTURE_SCRIPT` points at a JSON file describing what the
 * adapter answers; without it a single text step is served.
 */
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const scriptPath = process.env.PIWIN_FIXTURE_SCRIPT;
const script = scriptPath ? JSON.parse(readFileSync(scriptPath, 'utf8')) : {};
const steps = script.steps ?? [{ kind: 'text', text: 'fixture reply' }];
const agentId = process.env.PIWIN_FIXTURE_AGENT_ID ?? 'fixture';
const version = script.cliVersion ?? '1.0.0';

const scopeOf = (sessionId, runtimeGenerationId) => ({ kind: 'session', sessionId, runtimeGenerationId });
const pluginScope = { kind: 'plugin' };
const write = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const respond = (frame, result) => write({
  protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId,
  method: frame.method, ok: true, result,
});
const failFrame = (frame, code, message) => write({
  protocolVersion: 1, kind: 'response', scope: frame.scope, requestId: frame.requestId,
  method: frame.method, ok: false, error: { code, message },
});
const emit = (scope, emission) => write({ protocolVersion: 1, kind: 'event', scope, emission });

const callbacks = new Map();
const sessions = new Map();
let callbackSeq = 0;
let messageSeq = 0;

function callHost(scope, method, params) {
  const requestId = `cb-${(callbackSeq += 1)}`;
  return new Promise((resolve, reject) => {
    callbacks.set(requestId, { resolve, reject });
    write({ protocolVersion: 1, kind: 'request', scope, requestId, method, params });
  });
}

const capabilities = script.capabilities ?? { agentId, operations: {} };
const options = script.options ?? { commands: [] };

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  if (frame.kind === 'response') {
    const pending = callbacks.get(frame.requestId);
    if (pending === undefined) return;
    callbacks.delete(frame.requestId);
    if (frame.ok) pending.resolve(frame.result);
    else pending.reject(new Error(frame.error?.message ?? 'callback failed'));
    return;
  }
  if (frame.kind !== 'request') return;
  void handle(frame).catch((error) => failFrame(frame, 'backend-error', String(error)));
});

async function handle(frame) {
  switch (frame.method) {
    case 'plugin/initialize':
      return respond(frame, { agentId, protocolVersion: 1, requestUsage: true });
    case 'plugin/dispose':
      process.exit(0);
      return undefined;
    case 'check':
      if (script.notInstalled === true) {
        return respond(frame, { agentId, state: 'not-installed', searched: ['/nope'], checkedAt: new Date().toISOString() });
      }
      return respond(frame, {
        agentId, state: script.state ?? 'ready', binaryPath: script.binaryPath ?? '/fixture/agent',
        version, supportStatus: 'verified', checkedAt: new Date().toISOString(),
      });
    case 'catalog/list':
      return respond(frame, script.catalog ?? []);
    case 'catalog/usage':
      return respond(frame, script.requestUsage ?? []);
    case 'catalog/rename':
    case 'catalog/delete':
      return respond(frame, null);
    case 'session/new':
    case 'session/load':
    case 'session/resume': {
      const scope = frame.scope;
      sessions.set(scope.sessionId, { cwd: frame.params.cwd, cancelled: false, promptFrame: undefined, interjectFrame: undefined });
      const replayEvents = frame.method === 'session/load' ? (script.replayEvents ?? []) : [];
      return respond(frame, {
        backendSessionId: script.backendSessionId ?? `${agentId}-session-1`,
        agentVersion: version,
        capabilities,
        options,
        replayEvents,
      });
    }
    case 'session/prompt':
      return prompt(frame);
    case 'session/cancel': {
      const slot = sessions.get(frame.scope.sessionId);
      if (slot !== undefined) {
        slot.cancelled = true;
        if (slot.promptFrame !== undefined) {
          respond(slot.promptFrame, { status: 'aborted', stopReason: 'aborted' });
          slot.promptFrame = undefined;
        }
      }
      return respond(frame, null);
    }
    case 'session/options':
      return respond(frame, options);
    case 'session/model':
    case 'session/effort':
    case 'session/mode':
      return respond(frame, options);
    case 'session/commands':
      return respond(frame, options.commands ?? []);
    case 'session/interject': {
      const slot = sessions.get(frame.scope.sessionId);
      if (slot !== undefined) {
        slot.interjectFrame = frame;
        const accepted = await callHost(frame.scope, 'intervention/event', {
          type: 'claim', interventionId: frame.params.interventionId, revision: frame.params.revision,
        });
        if (accepted?.accepted === true) {
          emit(frame.scope, {
            type: 'agent',
            event: { type: 'intervention/applied', interventionId: frame.params.interventionId, revision: frame.params.revision },
          });
        }
      }
      return respond(frame, null);
    }
    case 'session/interject-cancel':
      return respond(frame, true);
    case 'session/mcp-status':
      return respond(frame, { servers: script.mcpServers ?? [], observed: script.mcpObserved ?? false });
    case 'session/workflows':
      return respond(frame, script.workflows ?? []);
    case 'session/workflow-report': {
      const report = (script.workflowReports ?? {})[frame.params.workflowId];
      if (report === undefined) return failFrame(frame, 'unavailable', 'workflow report not found');
      return respond(frame, { workflowId: frame.params.workflowId, text: report });
    }
    case 'session/release':
      sessions.delete(frame.scope.sessionId);
      return respond(frame, null);
    default:
      return failFrame(frame, 'unsupported', `fixture does not serve ${frame.method}`);
  }
}

async function prompt(frame) {
  const slot = sessions.get(frame.scope.sessionId);
  if (slot === undefined) return failFrame(frame, 'invalid-request', 'no session');
  slot.promptFrame = frame;
  const messageId = `fx-msg-${(messageSeq += 1)}`;
  emit(frame.scope, { type: 'agent', event: { type: 'message/start', messageId, role: 'assistant' } });
  if (script.title !== undefined) emit(frame.scope, { type: 'title', title: script.title });
  for (const step of steps) {
    if (slot.cancelled) return undefined;
    if (step.kind === 'delay') {
      await new Promise((resolve) => setTimeout(resolve, step.ms));
      continue;
    }
    if (step.kind === 'text') {
      emit(frame.scope, { type: 'agent', event: { type: 'message/text_delta', messageId, delta: step.text } });
      continue;
    }
    if (step.kind === 'tool') {
      const media = [];
      if (step.media !== undefined) {
        const target = join(slot.cwd, step.media.directory ?? '.piwin-fixture/images', step.media.relativePath);
        if (step.media.writeBytes !== false) {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, Buffer.from(step.media.bytes ?? 'fixture-media-bytes'));
        }
        media.push({
          directoryId: step.media.directoryId,
          relativePath: step.media.relativePath,
          kind: step.media.kind ?? 'image',
          importKey: `${agentId}:${step.media.relativePath}`,
          ...(step.media.prompt !== undefined ? { prompt: step.media.prompt } : {}),
        });
      }
      emit(frame.scope, {
        type: 'agent',
        event: {
          type: 'tool/end', toolCallId: step.toolCallId ?? 'fx-tool-1', isError: false,
          responseMessageId: messageId,
          presentation: {
            kind: step.media?.kind === 'video' ? 'video' : 'image',
            title: step.title ?? 'fixture tool',
            routedToolName: step.toolName ?? 'image_gen',
          },
        },
        ...(media.length > 0 ? { media } : {}),
      });
      continue;
    }
    if (step.kind === 'permission') {
      const decision = await callHost(frame.scope, 'permission/request', {
        action: step.action ?? 'run_fixture',
        detail: step.detail ?? 'fixture wants to act',
        context: { backendOptions: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ] },
        options: [
          { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
          { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
        ],
      });
      emit(frame.scope, {
        type: 'agent',
        event: { type: 'message/text_delta', messageId, delta: `decision:${JSON.stringify(decision)}\n` },
      });
      continue;
    }
    if (step.kind === 'options') {
      emit(frame.scope, { type: 'options', options: { ...options, commands: step.commands ?? options.commands ?? [] } });
      continue;
    }
    if (step.kind === 'mcp') {
      emit(frame.scope, { type: 'mcp-status', servers: step.servers ?? [], observed: true });
      continue;
    }
    if (step.kind === 'crash') {
      process.exit(7);
    }
    if (step.kind === 'hang') {
      // Serve nothing further until the Host cancels or releases the session.
      return undefined;
    }
  }
  if (slot.cancelled) return undefined;
  slot.promptFrame = undefined;
  if (script.usage !== undefined) {
    emit(frame.scope, { type: 'agent', event: { type: 'usage/finalized', measurement: {
      measurementId: `${frame.scope.sessionId}:${messageId}`,
      sessionId: frame.scope.sessionId, messageId, runId: frame.params.runId,
      recordedAt: new Date().toISOString(), ...script.usage,
    } } });
  }
  return respond(frame, {
    status: stepFailed(steps) ? 'failed' : 'completed',
    stopReason: stepFailed(steps) ? 'error' : 'stop',
    ...(stepFailed(steps) ? { failure: { category: 'execution', message: 'fixture failure' } } : {}),
  });
}

function stepFailed(list) {
  return list.some((step) => step.kind === 'fail');
}
