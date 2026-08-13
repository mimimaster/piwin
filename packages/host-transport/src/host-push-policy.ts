import type { AgentEvent, HostPushVariant } from '@piwin/contracts';

/** Collision-safe identity for one append, projection, or barrier scope. */
export type HostDeliveryKey = readonly [namespace: string, ...parts: string[]];

export type HostPushPolicy =
  | {
      kind: 'control';
      barrierKeys: HostDeliveryKey[];
      runBarrierId?: string;
    }
  | {
      kind: 'append';
      key: HostDeliveryKey;
      runId?: string;
    }
  | {
      kind: 'projection';
      key: HostDeliveryKey;
      runId?: string;
    }
  | {
      kind: 'diagnostic';
      key: HostDeliveryKey;
    };

/** Classify a semantic push before it reaches any transport. */
export function classifyHostPush(push: HostPushVariant): HostPushPolicy {
  switch (push.type) {
    case 'event':
      return classifyAgentEvent(deliveryKey('session', push.sessionId), push.event);
    case 'session/name-updated':
      return projection(deliveryKey('session', push.sessionId, 'name'));
    case 'plan/updated':
      return projection(deliveryKey('session', push.sessionId, 'plan'));
    case 'plan/execution-updated':
      return projection(
        deliveryKey('session', push.state.sessionId, 'plan-execution', push.state.planId),
        push.state.runId,
      );
    case 'subagent/updated':
      return projection(deliveryKey('subagent', push.parentSessionId, push.child.id));
    case 'subagent/invocation-updated':
      return projection(
        deliveryKey('subagent', push.parentSessionId, 'invocation', push.invocation.id),
        push.invocation.parentRunId,
      );
    case 'subagent/merged':
      return control([deliveryKey('subagent', push.parentSessionId, push.childSessionId)]);
    case 'subagent/batch-updated':
      return projection(deliveryKey('run', push.runId, 'subagent-batch'), push.runId);
    case 'subagent/task-updated':
      return projection(
        deliveryKey('run', push.runId, 'subagent-task', push.result.taskId),
        push.runId,
      );
    case 'subagent/stream':
      return classifyAgentEvent(
        deliveryKey('subagent', push.parentSessionId, push.childSessionId),
        push.event,
      );
    case 'session/runtime-updated':
      return projection(deliveryKey('session', push.status.sessionId, 'runtime'));
    case 'transcript/append':
      return append(deliveryKey('session', push.sessionId, 'transcript', push.message.id));
    case 'permission/request':
      return control([], push.runId);
    case 'host/status':
      return control([deliveryKey('host', 'status')]);
    case 'host/log':
      return diagnostic(deliveryKey('host', 'log'));
    case 'pty/output':
      return append(deliveryKey('pty', push.ptyId, 'output'));
    case 'pty/exit':
      return control([deliveryKey('pty', push.ptyId, 'output'), deliveryKey('pty', push.ptyId)]);
    case 'todo/updated':
      return projection(deliveryKey('session', push.sessionId, 'todo'));
    case 'automation/cron_finished':
      return control([deliveryKey('automation', 'cron', push.jobId)]);
    case 'extension/ui_request':
      return control([deliveryKey('session', push.sessionId, 'extension', push.requestId)]);
    case 'extension/catalog-updated':
      return projection(deliveryKey('extensions', 'catalog'));
    case 'extension/deployment-updated': {
      const key = deliveryKey('extensions', 'deployment', push.deployment.deploymentId);
      if (
        push.deployment.phase === 'active' ||
        push.deployment.phase === 'failed' ||
        push.deployment.phase === 'rolled-back' ||
        push.deployment.phase === 'restart-required' ||
        push.deployment.phase === 'superseded'
      ) {
        return control([key]);
      }
      return projection(key);
    }
    case 'pet/state':
      return projection(deliveryKey('pet', 'state'));
    case 'browser/frame':
      return projection(deliveryKey('browser', 'frame'));
    case 'browser/state':
      return projection(deliveryKey('browser', 'state'));
    case 'browser/picked':
      return control([deliveryKey('browser', 'picked')]);
    case 'browser/console':
      return diagnostic(deliveryKey('browser', 'console'));
    case 'browser/network':
      return diagnostic(deliveryKey('browser', 'network'));
    case 'walkthrough/updated':
      return projection(
        deliveryKey('session', push.sessionId, 'walkthrough', push.artifact.messageId),
      );
    case 'host/replay-done':
      return control([]);
    case 'job/started':
    case 'job/ready':
      return control([deliveryKey('job', push.job.jobId)]);
    case 'job/updated':
      return projection(deliveryKey('job', push.job.jobId));
    case 'job/log':
      return append(deliveryKey('job', push.chunk.jobId, 'log'));
    case 'job/exited':
      return control(
        [deliveryKey('job', push.job.jobId, 'log'), deliveryKey('job', push.job.jobId)],
        push.job.ownerRunId,
      );
    case 'run/updated':
      return projection(deliveryKey('run', push.run.runId), push.run.runId);
    case 'run/terminal':
      return control([deliveryKey('run', push.run.runId)], push.run.runId);
    default:
      return assertNever(push);
  }
}

function classifyAgentEvent(scope: HostDeliveryKey, event: AgentEvent): HostPushPolicy {
  const runId = 'runId' in event ? event.runId : undefined;
  const runPart = runId ?? 'legacy';
  switch (event.type) {
    case 'message/text_delta':
      return append(
        deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'text'),
        runId,
      );
    case 'message/thinking_delta':
      return append(
        deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'thinking'),
        runId,
      );
    case 'message/search_evidence':
      return append(
        deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'search-evidence'),
        runId,
      );
    case 'tool/update':
      return append(
        deliveryKey(...scope, 'run', runPart, 'tool', event.toolCallId, 'output'),
        runId,
      );
    case 'message/text_snapshot':
      return projection(
        deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'text-snapshot'),
        runId,
      );
    case 'usage/update':
      return projection(deliveryKey(...scope, 'usage'));
    case 'message/end':
      return control(
        [
          deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'text'),
          deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'thinking'),
          deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'search-evidence'),
          deliveryKey(...scope, 'run', runPart, 'message', event.messageId, 'text-snapshot'),
        ],
        runId,
      );
    case 'tool/end':
      return control(
        [deliveryKey(...scope, 'run', runPart, 'tool', event.toolCallId, 'output')],
        runId,
      );
    case 'session/aborted':
      return control([deliveryKey(...scope, 'lifecycle')], runId);
    case 'session/started':
    case 'session/ended':
      return control([deliveryKey(...scope, 'lifecycle')]);
    case 'message/start':
    case 'tool/start':
      return control([]);
    case 'permission/request':
    case 'permission/resolved':
      return control([], runId);
    case 'compaction/start':
    case 'compaction/end':
      return control([deliveryKey(...scope, 'lifecycle')], runId);
    case 'error':
      return control(
        runId ? [deliveryKey('run', runId)] : [deliveryKey(...scope, 'lifecycle')],
        runId,
      );
    case 'memory/extraction_start':
    case 'memory/extraction_end':
      return control([deliveryKey(...scope, 'lifecycle')]);
    case 'message/native_context':
      // Host-runtime strips native context copies before egress
      // (spec: session-conversation-tree §4.3); classify defensively only.
      return control([], runId);
    default:
      return assertNever(event);
  }
}

function append(key: HostDeliveryKey, runId?: string): HostPushPolicy {
  return runId === undefined ? { kind: 'append', key } : { kind: 'append', key, runId };
}

function projection(key: HostDeliveryKey, runId?: string): HostPushPolicy {
  return runId === undefined ? { kind: 'projection', key } : { kind: 'projection', key, runId };
}

function control(barrierKeys: HostDeliveryKey[], runId?: string): HostPushPolicy {
  return runId === undefined
    ? { kind: 'control', barrierKeys }
    : { kind: 'control', barrierKeys, runBarrierId: runId };
}

function diagnostic(key: HostDeliveryKey): HostPushPolicy {
  return { kind: 'diagnostic', key };
}

function deliveryKey(namespace: string, ...parts: string[]): HostDeliveryKey {
  return [namespace, ...parts];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Host push variant: ${JSON.stringify(value)}`);
}
