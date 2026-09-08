import {
  appendMockTranscriptMessage,
  applyMockBranchPrompt,
  applyMockRetryPrompt,
  listMockBranchPoints,
} from './host-client-mock-tree.js';
import { emitMockAssemblySummary } from './host-client-mock-assembly.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  MediaAttachmentRef,
  SessionTranscriptMessage,
  RunInterventionRecord,
  QueuedTurnRecord,
} from '@piwin/contracts';

export async function handleMockTurnCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'session/queued-turn-submit':
        return host.handleMockQueuedTurnSubmit(command, id);
      case 'session/queued-turn-list':
        return host.handleMockQueuedTurnList(command, id);
      case 'session/queued-turn-edit':
        return host.handleMockQueuedTurnEdit(command, id);
      case 'session/queued-turn-cancel':
        return host.handleMockQueuedTurnCancel(command, id);
      case 'session/queued-turn-reorder':
        return host.handleMockQueuedTurnReorder(command, id);
      case 'session/replace-run':
        return host.handleMockReplaceRun(command, id);
      case 'session/prompt': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: `unknown session ${command.sessionId}`,
          };
        }
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        if (activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: `run-active: session ${command.sessionId} already has foreground run`,
          };
        }
        if (
          command.input.source === 'resume' &&
          command.input.resumeCheckpointId !== host.mockPauseCheckpointIds.get(command.sessionId)
        ) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: 'resume-checkpoint-mismatch',
          };
        }
        const now = new Date().toISOString();
        const runId = crypto.randomUUID();
        host.mockActiveRunIds.set(command.sessionId, runId);
        host.pushMockRunUpdated(
          command.sessionId,
          runId,
          'running',
          'accepted',
          now,
          command.input.resumeCheckpointId,
        );
        host.pushMockRunUpdated(command.sessionId, runId, 'running', 'preparing');
        const clientMessageId = command.input.clientMessageId?.trim();
        const userMessage: SessionTranscriptMessage = {
          id: clientMessageId && clientMessageId.length > 0 ? clientMessageId : crypto.randomUUID(),
          role: 'user',
          text: command.input.text,
          createdAt: now,
          status: 'done',
        };
        if (command.input.attachments && command.input.attachments.length > 0) {
          const mediaAttachments = command.input.attachments.filter(
            (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
          );
          if (mediaAttachments.length > 0) {
            userMessage.attachments = mediaAttachments;
          }
        }
        if (
          command.input.branchFromMessageId !== undefined &&
          command.input.retryUserMessageId !== undefined
        ) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: 'retry-and-branch-conflict',
          };
        }
        let retryUser: SessionTranscriptMessage | undefined;
        if (command.input.retryUserMessageId !== undefined) {
          const retried = applyMockRetryPrompt(session, {
            retryUserMessageId: command.input.retryUserMessageId,
            keepPrevious: command.input.keepPreviousAttempt === true,
            confirm: command.confirm === true,
          });
          if (!retried.ok) {
            return {
              id,
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: retried.error,
              ...(retried.writes
                ? { problem: { code: 'retry-discards-writes', data: retried.writes } }
                : {}),
            };
          }
          retryUser = retried.user;
          host.emitPush({
            type: 'session/branch-updated',
            sessionId: command.sessionId,
            activeLeafMessageId: session.activeLeafMessageId ?? null,
            branchPointCount: listMockBranchPoints(session).length,
          });
        } else if (command.input.branchFromMessageId !== undefined) {
          const branched = applyMockBranchPrompt(session, {
            branchFromMessageId: command.input.branchFromMessageId,
            confirm: command.confirm === true,
          });
          if (!branched.ok) {
            return {
              id,
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: branched.error,
              ...(branched.writes
                ? { problem: { code: 'branch-leaves-writes', data: branched.writes } }
                : {}),
            };
          }
          host.emitPush({
            type: 'session/branch-updated',
            sessionId: command.sessionId,
            activeLeafMessageId: session.activeLeafMessageId ?? null,
            branchPointCount: listMockBranchPoints(session).length,
          });
        }
        if (
          retryUser === undefined &&
          command.input.source !== 'resume' &&
          command.input.source !== 'queued-turn'
        ) {
          appendMockTranscriptMessage(session, userMessage);
        }
        // Ordinary prompts replace the paused task. Keep the checkpoint
        // through admission failures above; retire it only when this turn is
        // ready to stream, matching Host executeSessionTurn.
        if (command.input.source !== 'resume') {
          host.mockPauseCheckpointIds.delete(command.sessionId);
        }
        // Immediate text name (matches host recordUserPrompt naming pipeline).
        host.maybeMockAutoName(command.sessionId);
        const attachmentNote =
          command.input.attachments && command.input.attachments.length > 0
            ? `\n[attachments: ${command.input.attachments
                .filter((item): item is MediaAttachmentRef => item.kind === 'media')
                .map((item) => item.path)
                .join(', ')}]`
            : '';
        const promptText = retryUser?.text ?? command.input.text;
        emitMockAssemblySummary(host, {
          sessionId: command.sessionId,
          runId,
          requestClass: command.input.source === 'resume' ? 'pause-resume' : 'prompt',
          ...(command.input.source === 'resume'
            ? {}
            : { userMessageId: retryUser?.id ?? userMessage.id }),
          text: promptText,
          ...(command.input.attachments ? { attachments: command.input.attachments } : {}),
        });
        // Stream asynchronously so concurrent session/abort can cancel mid-turn.
        void host.emitMockPrompt(
          command.sessionId,
          `${promptText}${attachmentNote}`,
          runId,
        );
        return {
          id,
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId,
            acceptedAt: now,
          },
        };
      }
      case 'session/pause': {
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        const existingCheckpoint = host.mockPauseCheckpointIds.get(command.sessionId);
        if (!activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/pause',
            success: true,
            data: {
              sessionId: command.sessionId,
              state: existingCheckpoint ? 'paused' : 'paused',
              ...(existingCheckpoint ? { checkpointId: existingCheckpoint } : {}),
              ...(!existingCheckpoint ? { reason: 'no-active-run' } : {}),
            },
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/pause',
            success: true,
            data: {
              sessionId: command.sessionId,
              runId: activeRunId,
              state: 'pausing',
              reason: 'run-mismatch',
            },
          };
        }
        const checkpointId = existingCheckpoint ?? crypto.randomUUID();
        host.mockPauseCheckpointIds.set(command.sessionId, checkpointId);
        host.mockPauseRequested.add(command.sessionId);
        host.pushMockRunUpdated(command.sessionId, activeRunId, 'cancelling', 'pausing');
        host.mockPromptAborts.get(command.sessionId)?.abort({ code: 'pause-requested' });
        return {
          id,
          type: 'response',
          command: 'session/pause',
          success: true,
          data: { sessionId: command.sessionId, runId: activeRunId, state: 'pausing' },
        };
      }
      case 'session/resume-run': {
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        if (activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: `run-active: session ${command.sessionId} already has foreground run`,
          };
        }
        const checkpointId =
          command.checkpointId ?? host.mockPauseCheckpointIds.get(command.sessionId);
        if (
          checkpointId === undefined ||
          checkpointId !== host.mockPauseCheckpointIds.get(command.sessionId)
        ) {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: 'no-active-checkpoint',
          };
        }
        const response = await host.handle(
          {
            type: 'session/prompt',
            sessionId: command.sessionId,
            input: {
              text: 'Continue the interrupted task from the current transcript and tool state. Inspect completed work before continuing.',
              source: 'resume',
              resumeCheckpointId: checkpointId,
            },
          },
          id,
        );
        if (!response.success) {
          return { ...response, command: 'session/resume-run' };
        }
        const data = response.data as { runId?: string; acceptedAt?: string } | undefined;
        if (typeof data?.runId !== 'string' || typeof data.acceptedAt !== 'string') {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: 'resume prompt acknowledgement was invalid',
          };
        }
        return {
          id,
          type: 'response',
          command: 'session/resume-run',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId: data.runId,
            checkpointId,
            acceptedAt: data.acceptedAt,
          },
        };
      }
      case 'session/abort': {
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        if (!activeRunId) {
          // A paused checkpoint is not a live run. Abort must not throw it away.
          host.mockPauseRequested.delete(command.sessionId);
          return {
            id,
            type: 'response',
            command: 'session/abort',
            success: true,
            data: {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'no-active-run',
            },
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/abort',
            success: true,
            data: {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'run-mismatch',
              activeRunId,
            },
          };
        }
        host.mockPauseRequested.delete(command.sessionId);
        host.mockPauseCheckpointIds.delete(command.sessionId);
        host.pushMockRunUpdated(command.sessionId, activeRunId, 'cancelling', 'cancelling');
        host.mockPromptAborts.get(command.sessionId)?.abort();
        return {
          id,
          type: 'response',
          command: 'session/abort',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId: activeRunId,
            cancelled: true,
          },
        };
      }

      case 'session/steer': {
        const session = host.sessions.get(command.sessionId);
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        if (!session || !activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/steer',
            success: false,
            error: `no-active-run: session ${command.sessionId} has no foreground run`,
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/steer',
            success: false,
            error: `run-mismatch: requested ${command.runId}, active ${activeRunId}`,
          };
        }
        const now = new Date().toISOString();
        const userMessageId = command.clientMessageId?.trim() || crypto.randomUUID();
        appendMockTranscriptMessage(session, {
          id: userMessageId,
          role: 'user',
          text: command.message,
          createdAt: now,
          status: 'done',
        });
        emitMockAssemblySummary(host, {
          sessionId: command.sessionId,
          runId: activeRunId,
          requestClass: 'steer',
          userMessageId,
          text: command.message,
        });
        return {
          id,
          type: 'response',
          command: 'session/steer',
          success: true,
          data: { sessionId: command.sessionId, runId: activeRunId },
        };
      }

      case 'run/intervention-submit': {
        const session = host.sessions.get(command.sessionId);
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        if (!session || activeRunId !== command.runId) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: activeRunId
              ? `run-mismatch: requested ${command.runId}, active ${activeRunId}`
              : `no-active-run: session ${command.sessionId} has no foreground run`,
          };
        }
        const replay = host.mockRunInterventions.get(command.interventionId);
        if (replay) {
          const adopted = command.adoptQueuedTurn
            ? host.mockQueuedTurns
                .get(command.sessionId)
                ?.find(
                  (item) =>
                    item.queuedTurnId === command.adoptQueuedTurn?.queuedTurnId &&
                    item.status === 'cancelled' &&
                    item.terminalReason === 'converted-to-intervention',
                )
            : undefined;
          return {
            id,
            type: 'response',
            command: command.type,
            success: true,
            ...(adopted ? { data: { intervention: replay, queuedTurn: adopted } } : { data: { intervention: replay } }),
          };
        }
        const now = new Date().toISOString();
        // Adoption converts a pending queued turn in place: cancel the queue
        // record and re-bind its already-painted user row instead of appending.
        let adoptedQueuedTurn: QueuedTurnRecord | undefined;
        if (command.adoptQueuedTurn) {
          const queue = host.mockQueuedTurns.get(command.sessionId) ?? [];
          const target = queue.find(
            (item) => item.queuedTurnId === command.adoptQueuedTurn?.queuedTurnId,
          );
          if (
            !target ||
            target.sessionId !== command.sessionId ||
            target.userMessageId !== command.userMessageId ||
            target.input.text !== command.input.text ||
            JSON.stringify(target.input.attachments ?? []) !==
              JSON.stringify(command.input.attachments ?? []) ||
            JSON.stringify(target.input.contextRefs ?? []) !==
              JSON.stringify(command.input.contextRefs ?? [])
          ) {
            return {
              id,
              type: 'response',
              command: command.type,
              success: false,
              error: 'queued-turn-not-found',
            };
          }
          if (target.status !== 'pending' || target.revision !== command.adoptQueuedTurn.expectedRevision) {
            return {
              id,
              type: 'response',
              command: command.type,
              success: false,
              error: 'queued-turn-revision-conflict',
            };
          }
          adoptedQueuedTurn = {
            ...target,
            revision: target.revision + 1,
            status: 'cancelled',
            terminalReason: 'converted-to-intervention',
            updatedAt: now,
          };
          host.mockQueuedTurns.set(
            command.sessionId,
            queue.map((item) => (item.queuedTurnId === adoptedQueuedTurn?.queuedTurnId ? adoptedQueuedTurn : item)),
          );
          host.emitPush({
            type: 'session/queued-turn-updated',
            queuedTurn: adoptedQueuedTurn,
          });
        }
        const intervention: RunInterventionRecord = {
          interventionId: command.interventionId,
          revision: 1,
          sessionId: command.sessionId,
          runId: command.runId,
          runtimeGenerationId: 'mock-generation',
          sequence:
            [...host.mockRunInterventions.values()].filter(
              (item) => item.runId === command.runId,
            ).length + 1,
          userMessageId: command.userMessageId,
          status: 'pending',
          input: command.input,
          submittedAt: now,
          updatedAt: now,
        };
        host.mockRunInterventions.set(intervention.interventionId, intervention);
        if (!adoptedQueuedTurn) {
          const message: SessionTranscriptMessage = {
            id: intervention.userMessageId,
            role: 'user',
            text: intervention.input.text,
            createdAt: now,
            status: 'done',
            runId: intervention.runId,
            instructionDelivery: {
              kind: 'run-intervention',
              instructionId: intervention.interventionId,
              status: intervention.status,
              targetRunId: intervention.runId,
              revision: intervention.revision,
            },
          };
          appendMockTranscriptMessage(session, message);
          host.emitPush({ type: 'transcript/append', sessionId: command.sessionId, message });
        }
        host.emitPush({ type: 'run/intervention-updated', intervention });
        globalThis.setTimeout(() => {
          const current = host.mockRunInterventions.get(intervention.interventionId);
          if (!current || current.status !== 'pending') return;
          if (host.mockActiveRunIds.get(command.sessionId) !== command.runId) {
            const expired: RunInterventionRecord = {
              ...current,
              revision: current.revision + 1,
              status: 'expired',
              updatedAt: new Date().toISOString(),
              terminalReason: 'run-ended',
            };
            host.mockRunInterventions.set(expired.interventionId, expired);
            host.emitPush({ type: 'run/intervention-updated', intervention: expired });
            return;
          }
          const applied: RunInterventionRecord = {
            ...current,
            revision: current.revision + 2,
            status: 'applied',
            updatedAt: new Date().toISOString(),
            appliedAt: new Date().toISOString(),
          };
          host.mockRunInterventions.set(applied.interventionId, applied);
          host.emitPush({ type: 'run/intervention-updated', intervention: applied });
        }, 50);
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          ...(adoptedQueuedTurn
            ? { data: { intervention, queuedTurn: adoptedQueuedTurn } }
            : { data: { intervention } }),
        };
      }

      case 'run/intervention-edit': {
        const current = host.mockRunInterventions.get(command.interventionId);
        if (
          !current ||
          current.sessionId !== command.sessionId ||
          current.runId !== command.runId ||
          current.status !== 'pending' ||
          current.revision !== command.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: 'intervention-revision-conflict',
          };
        }
        const updated: RunInterventionRecord = {
          ...current,
          revision: current.revision + 1,
          input: command.input,
          updatedAt: new Date().toISOString(),
        };
        host.mockRunInterventions.set(updated.interventionId, updated);
        const session = host.sessions.get(command.sessionId);
        const messageIndex = session?.transcript.findIndex(
          (message) => message.id === updated.userMessageId,
        );
        if (session && messageIndex !== undefined && messageIndex >= 0) {
          const previous = session.transcript[messageIndex];
          if (previous) {
            session.transcript[messageIndex] = {
              ...previous,
              text: updated.input.text,
              instructionDelivery: {
                kind: 'run-intervention',
                instructionId: updated.interventionId,
                status: updated.status,
                targetRunId: updated.runId,
                revision: updated.revision,
              },
            };
          }
        }
        host.emitPush({ type: 'run/intervention-updated', intervention: updated });
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { intervention: updated },
        };
      }

      case 'run/intervention-cancel': {
        const current = host.mockRunInterventions.get(command.interventionId);
        if (
          !current ||
          current.sessionId !== command.sessionId ||
          current.runId !== command.runId ||
          current.status !== 'pending' ||
          current.revision !== command.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: 'intervention-revision-conflict',
          };
        }
        const cancelled: RunInterventionRecord = {
          ...current,
          revision: current.revision + 1,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        };
        host.mockRunInterventions.set(cancelled.interventionId, cancelled);
        host.emitPush({ type: 'run/intervention-updated', intervention: cancelled });
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { intervention: cancelled },
        };
      }

      case 'session/compact': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/compact',
            success: false,
            error: `unknown session ${command.sessionId}`,
          };
        }
        host.pushEvent(command.sessionId, { type: 'compaction/start' });
        host.pushEvent(command.sessionId, {
          type: 'compaction/end',
          ok: true,
          message: 'mock compacted',
          summary: 'Mock summary of prior turns for UI testing.',
          tokensBefore: 8000,
          tokensAfter: 2500,
          durationMs: 30,
        });
        return {
          id,
          type: 'response',
          command: 'session/compact',
          success: true,
          data: {
            ok: true,
            message: 'mock compacted',
            summary: 'Mock summary of prior turns for UI testing.',
            tokensBefore: 8000,
            tokensAfter: 2500,
            durationMs: 30,
          },
        };
      }
      case 'session/compact-export': {
        const path =
          command.outputPath?.trim() ||
          `/mock/exports/piwin-compact-${command.sessionId.slice(0, 8)}.md`;
        const summary = 'Mock summary of prior turns for UI testing.';
        const content = `${summary}\n`;
        return {
          id,
          type: 'response',
          command: 'session/compact-export',
          success: true,
          data: {
            sessionId: command.sessionId,
            format: 'md',
            path,
            byteLength: content.length,
            ...(summary ? { summary } : {}),
          },
        };
      }
      case 'session/compact-abort':
        return {
          id,
          type: 'response',
          command: 'session/compact-abort',
          success: true,
          data: { sessionId: command.sessionId },
        };
      case 'session/compaction-settings':
        return {
          id,
          type: 'response',
          command: 'session/compaction-settings',
          success: true,
          data: {
            supported: true,
            autoCompactionEnabled: true,
            source: 'global',
            globalDefault: true,
          },
        };
      case 'session/set-auto-compaction':
        return {
          id,
          type: 'response',
          command: 'session/set-auto-compaction',
          success: true,
          data: { enabled: command.enabled },
        };
      case 'session/set-composer-profile':
        return {
          id,
          type: 'response',
          command: 'session/set-composer-profile',
          success: true,
          data: { ok: true },
        };

    default:
      return null;
  }
}
