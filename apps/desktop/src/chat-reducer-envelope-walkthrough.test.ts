import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
} from './chat-reducer';

describe('chatUiReducer envelope and walkthrough', () => {
  describe('C1: envelope-based dedup', () => {
    const makeEnvelope = (eventId: string, sequence: number, runId?: string) => ({
      eventId,
      sequence,
      runId,
    });

    it('rejects an event with a replayed envelope eventId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1),
      } as never);

      const afterReplay = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1),
      } as never);

      expect(state.messages).toHaveLength(1);
      expect(afterReplay).toBe(state);
    });

    it('rejects a stale event with a lower sequence number', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 5, 'run-1'),
      } as never);

      const afterStale = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'stale payload' },
        envelope: makeEnvelope('evt-2', 3, 'run-1'),
      } as never);

      expect(afterStale).toBe(state);
    });

    it('accepts events without envelope (backward compatible)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
      });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'no envelope' },
      });

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.text).toBe('no envelope');
    });

    it('never deduplicates based on equal delta text when envelopes differ', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1, 'run-1'),
      } as never);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'same ' },
        envelope: makeEnvelope('evt-2', 2, 'run-1'),
      } as never);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'same ' },
        envelope: makeEnvelope('evt-3', 3, 'run-1'),
      } as never);

      // Identical delta text must accumulate when envelopes are distinct.
      expect(state.messages[0]?.text).toBe('same same ');
    });

    it('preserves existing message/start idempotency check', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      const startEvent = {
        type: 'message/start' as const,
        messageId: 'dup-id',
        role: 'assistant' as const,
      };
      state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });
      state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });

      expect(state.messages).toHaveLength(1);
    });
  });

  describe('C1: message/text_snapshot', () => {
    it('replaces message text instead of appending', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
      });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'old ' },
      });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_snapshot', messageId: 'a1', text: 'complete replacement' },
      });

      expect(state.messages[0]?.text).toBe('complete replacement');
    });

    it('does not create a missing message row', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/text_snapshot',
          messageId: 'unknown-message',
          text: 'should be ignored',
        },
      });

      expect(state.messages).toHaveLength(0);
    });
  });

  describe('subagent children + streams', () => {
    it('upserts subagent/updated into subagentChildren for the active parent', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: {
          id: 'child-1',
          scope: { kind: 'project', projectPath: '/p' },
          projectPath: '/p',
          workingDirectory: '/p',
          updatedAt: '2026-08-01T00:00:00.000Z',
          messageCount: 0,
          kind: 'subagent',
          depth: 1,
          subagentStatus: 'done',
          parentSessionId: 'parent-1',
        },
      });
      expect(state.subagentChildren['child-1']).toMatchObject({ subagentStatus: 'done' });
    });

    it('replaces a previous child summary on later subagent/updated', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const child = (subagentStatus: 'running' | 'done') => ({
        id: 'child-1',
        scope: { kind: 'project', projectPath: '/p' } as const,
        projectPath: '/p',
        workingDirectory: '/p',
        updatedAt: '2026-08-01T00:00:00.000Z',
        messageCount: 0,
        kind: 'subagent' as const,
        depth: 1,
        subagentStatus,
        parentSessionId: 'parent-1',
      });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: child('running'),
      });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: child('done'),
      });
      expect(state.subagentChildren['child-1']).toMatchObject({ subagentStatus: 'done' });
      expect(Object.keys(state.subagentChildren)).toHaveLength(1);
    });

    it('retains completed assistant messages as segments across message boundaries', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const send = (event: import('@piwin/contracts').AgentEvent): void => {
        state = chatUiReducer(state, {
          type: 'subagent/stream',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          event,
        });
      };
      send({ type: 'message/start', messageId: 'm1', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm1', delta: 'first answer' });
      send({ type: 'message/end', messageId: 'm1' });
      // Causal order: the tool invoked by m1 starts after m1's message/end.
      send({
        type: 'tool/start',
        toolCallId: 't1',
        toolName: 'read_file',
        responseMessageId: 'm1',
      });
      send({ type: 'tool/end', toolCallId: 't1', isError: false, responseMessageId: 'm1' });
      send({ type: 'message/start', messageId: 'm2', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm2', delta: 'second answer' });
      send({ type: 'message/end', messageId: 'm2' });
      send({ type: 'message/start', messageId: 'm3', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm3', delta: 'third in flight' });

      const stream = state.subagentStreams['child-1'];
      expect(stream).toBeDefined();
      if (!stream) throw new Error('missing stream');
      // Middle messages must survive while the child window stays open.
      expect(stream.completedSegments.map((segment) => segment.messageId)).toEqual(['m1', 'm2']);
      expect(stream.completedSegments[0]?.text).toBe('first answer');
      // The late tool call attaches to its owning segment, not the live tail.
      expect(stream.completedSegments[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1']);
      expect(stream.completedSegments[0]?.tools[0]?.status).toBe('done');
      expect(stream.completedSegments[1]?.text).toBe('second answer');
      expect(stream.text).toBe('third in flight');
      expect(stream.currentMessageId).toBe('m3');
      expect(stream.tools).toHaveLength(0);
    });

    it('retains a tool-only assistant shell so late tools are not wiped by the next message', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const send = (event: import('@piwin/contracts').AgentEvent): void => {
        state = chatUiReducer(state, {
          type: 'subagent/stream',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          event,
        });
      };
      send({ type: 'message/start', messageId: 'm1', role: 'assistant' });
      send({ type: 'message/end', messageId: 'm1' });
      send({
        type: 'tool/start',
        toolCallId: 't1',
        toolName: 'read_file',
        responseMessageId: 'm1',
      });
      send({
        type: 'tool/update',
        toolCallId: 't1',
        delta: 'file contents',
        responseMessageId: 'm1',
      });
      send({ type: 'tool/end', toolCallId: 't1', isError: false, responseMessageId: 'm1' });
      send({ type: 'message/start', messageId: 'm2', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm2', delta: 'after the tool' });

      const stream = state.subagentStreams['child-1'];
      if (!stream) throw new Error('missing stream');
      expect(stream.completedSegments.map((segment) => segment.messageId)).toEqual(['m1']);
      expect(stream.completedSegments[0]?.text).toBe('');
      expect(stream.completedSegments[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1']);
      expect(stream.completedSegments[0]?.tools[0]?.status).toBe('done');
      expect(stream.completedSegments[0]?.tools[0]?.output).toContain('file contents');
      expect(stream.currentMessageId).toBe('m2');
      expect(stream.text).toBe('after the tool');
      expect(stream.tools).toHaveLength(0);
    });

    it('attaches late tool outputs to the segment that owns the tool call', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const send = (event: import('@piwin/contracts').AgentEvent): void => {
        state = chatUiReducer(state, {
          type: 'subagent/stream',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          event,
        });
      };
      send({ type: 'message/start', messageId: 'm1', role: 'assistant' });
      send({ type: 'message/end', messageId: 'm1' });
      send({
        type: 'tool/start',
        toolCallId: 't1',
        toolName: 'image_gen',
        responseMessageId: 'm1',
      });
      send({
        type: 'tool/end',
        toolCallId: 't1',
        isError: false,
        responseMessageId: 'm1',
        attachments: [
          {
            id: 'att-1',
            kind: 'media',
            path: '/media/generated.png',
            mimeType: 'image/png',
            byteSize: 1024,
            source: 'generated',
          },
        ],
      });
      send({ type: 'message/start', messageId: 'm2', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm2', delta: 'described the image' });

      const stream = state.subagentStreams['child-1'];
      if (!stream) throw new Error('missing stream');
      // The generated media belongs to the message that ran the tool; the live
      // buffer is cleared by the next message/start.
      expect(stream.completedSegments[0]?.attachments?.map((item) => item.id)).toEqual(['att-1']);
      expect(stream.attachments ?? []).toHaveLength(0);
    });

    it('keeps completionRevision increasing after the retained-segment cap', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const send = (event: import('@piwin/contracts').AgentEvent): void => {
        state = chatUiReducer(state, {
          type: 'subagent/stream',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          event,
        });
      };
      for (let index = 1; index <= 32; index += 1) {
        const messageId = `m${index}`;
        send({ type: 'message/start', messageId, role: 'assistant' });
        send({ type: 'message/text_delta', messageId, delta: `answer ${index}` });
        send({ type: 'message/end', messageId });
      }

      const stream = state.subagentStreams['child-1'];
      if (!stream) throw new Error('missing stream');
      expect(stream.completedSegments).toHaveLength(30);
      expect(stream.completedSegments[0]?.messageId).toBe('m3');
      expect(stream.completedSegments[29]?.messageId).toBe('m32');
      expect(stream.completionRevision).toBe(32);
    });

    it('keeps an aborted partial message as the terminal live tail', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const send = (event: import('@piwin/contracts').AgentEvent): void => {
        state = chatUiReducer(state, {
          type: 'subagent/stream',
          parentSessionId: 'parent-1',
          childSessionId: 'child-1',
          event,
        });
      };
      send({ type: 'message/start', messageId: 'm1', role: 'assistant' });
      send({ type: 'message/text_delta', messageId: 'm1', delta: 'partial before abort' });
      send({ type: 'session/aborted', sessionId: 'child-1' });

      const stream = state.subagentStreams['child-1'];
      if (!stream) throw new Error('missing stream');
      expect(stream.streaming).toBe(false);
      // No message/end: the partial text stays visible as the terminal tail
      // until a history refresh (or clear-stream) replaces it.
      expect(stream.text).toBe('partial before abort');
      expect(stream.completedSegments).toEqual([]);
    });

    it('clear-stream removes only the targeted child stream', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      state = chatUiReducer(state, {
        type: 'subagent/stream',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        event: { type: 'message/start', messageId: 'm1', role: 'assistant' },
      });
      state = chatUiReducer(state, {
        type: 'subagent/stream',
        parentSessionId: 'parent-1',
        childSessionId: 'child-2',
        event: { type: 'message/start', messageId: 'm2', role: 'assistant' },
      });
      state = chatUiReducer(state, { type: 'subagent/clear-stream', childSessionId: 'child-1' });
      expect(state.subagentStreams['child-1']).toBeUndefined();
      expect(state.subagentStreams['child-2']).toBeDefined();
    });
  });

  describe('walkthrough artifacts', () => {
    function readyArtifact(messageId: string): import('@piwin/contracts').WalkthroughArtifact {
      return {
        version: 1,
        id: `wt-${messageId}`,
        sessionId: 's1',
        messageId,
        mode: 'default',
        model: { protocol: 'openai-compatible', providerId: 'mock', modelId: 'mock-wt' },
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'ready',
        markdown: '# Walkthrough',
        generatedAt: '2026-01-01T00:00:00.000Z',
      };
    }

    it('walkthrough/hydrate replaces the map keyed by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1'), readyArtifact('a2')],
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(2);
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
      expect(state.walkthroughsByMessageId['a2']?.status).toBe('ready');
    });

    it('walkthrough/updated upserts an artifact by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: {
          version: 1,
          id: 'wt-a1',
          sessionId: 's1',
          messageId: 'a1',
          mode: 'default',
          sourceHash: 'hash',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          status: 'generating',
          generationId: 'gen-1',
        },
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      // Upsert to ready.
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: readyArtifact('a1'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    function generatingArtifact(
      messageId: string,
      generationId: string,
    ): import('@piwin/contracts').WalkthroughArtifact {
      return {
        version: 1,
        id: `wt-${messageId}`,
        sessionId: 's1',
        messageId,
        mode: 'default',
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'generating',
        generationId,
      };
    }

    it('walkthrough/updated accepts a generating push against a terminal (ready) artifact (force regeneration)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: readyArtifact('a1') });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-2'),
      });
      // A fresh generating push (new generationId) on a ready artifact is a
      // regeneration request and must be accepted so the UI shows "Generating...".
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
    });

    it('walkthrough/updated accepts a generating push against a terminal (error) artifact (force regeneration)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      const errorArtifact: import('@piwin/contracts').WalkthroughArtifact = {
        version: 1,
        id: 'wt-a1',
        sessionId: 's1',
        messageId: 'a1',
        mode: 'default',
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'error',
        error: { code: 'empty-output', message: 'no output' },
        generatedAt: '2026-01-01T00:00:00.000Z',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: errorArtifact });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-2'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
    });

    it('walkthrough/updated drops a stale generating push from an older generation', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      // A late generating push with a different generationId is stale.
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-late'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      expect((state.walkthroughsByMessageId['a1'] as { generationId: string }).generationId).toBe(
        'gen-1',
      );
    });

    it('walkthrough/updated accepts a generating push with the same generationId (update)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      const updated = {
        ...generatingArtifact('a1', 'gen-1'),
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: updated });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      expect(state.walkthroughsByMessageId['a1']?.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('walkthrough/updated always accepts a terminal (ready) push over a generating artifact', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: readyArtifact('a1') });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    it('walkthrough/updated ignores an artifact whose sessionId differs from the active session', () => {
      // Cross-session leak guard: a walkthrough generation that completes for
      // session B after the user switched to session A must not leak into A.
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'sA' });
      const staleArtifact = {
        ...readyArtifact('a1'),
        sessionId: 'sB',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: staleArtifact });
      expect('a1' in state.walkthroughsByMessageId).toBe(false);
    });

    it('walkthrough/remove deletes an artifact by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, { type: 'walkthrough/remove', messageId: 'a1' });
      expect('a1' in state.walkthroughsByMessageId).toBe(false);
    });

    it('session switch clears the walkthrough map', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(1);
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(0);
    });

    it('session/load-messages does NOT clear the walkthrough map (hydrate race)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 's1',
        messages: [
          {
            id: 'u1',
            role: 'user',
            text: 'hi',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'done',
          },
        ],
      });
      // load-messages must not wipe a freshly-hydrated walkthrough map; the
      // map is cleared by session/set which fires before load-messages.
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(1);
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    it('scope/set clears the walkthrough map', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, {
        type: 'scope/set',
        scope: { kind: 'project', projectPath: '/tmp' },
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(0);
    });
  });
});
