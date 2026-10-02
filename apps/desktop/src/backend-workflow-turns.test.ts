import { describe, expect, it } from 'vitest';
import type { BackendWorkflowSnapshot } from '@piwin/contracts';
import { groupBackendWorkflowsByTurn } from './backend-workflow-turns.js';
import { groupTranscriptTurns } from './transcript-turns.js';
import type { ChatMessageUi } from './chat-reducer.js';
const user = (id: string, text: string, minute: number): ChatMessageUi => ({
  id, text, role: 'user', thinking: '', tools: [], attachments: [], status: 'done',
  createdAt: `2026-10-02T14:${minute}:00.000Z`,
});
const workflow: BackendWorkflowSnapshot = {
  workflowId: 'wf_test', sessionId: 's1', agentId: 'grok', name: 'deep-research', objective: '鲸鱼形象',
  status: 'active', revision: 1, phases: [], agents: [], reportAvailable: false,
  history: [{ event: 'workflow_started', at: '2026-10-02T14:20:01.000Z' }],
};
describe('workflow transcript anchoring', () => {
  it('keeps a live workflow on its initiating prompt rather than the newest turn', () => {
    const turns = groupTranscriptTurns([user('first', '/deep-research 鲸鱼形象', 20), user('later', '现在进展如何', 21)]);
    const result = groupBackendWorkflowsByTurn(turns, [workflow]);
    expect(result.byTurn.get('turn-first')).toEqual([workflow]);
    expect(result.byTurn.has('turn-later')).toBe(false);
    expect(result.unanchored).toEqual([]);
  });
  it('uses the start time to distinguish repeated identical research prompts', () => {
    const turns = groupTranscriptTurns([user('old', '/deep-research 鲸鱼形象', 19), user('first', '/deep-research 鲸鱼形象', 20), user('repeat', '/deep-research 鲸鱼形象', 22)]);
    expect(groupBackendWorkflowsByTurn(turns, [workflow]).byTurn.get('turn-first')).toEqual([workflow]);
  });
  it('does not attach an omitted historical workflow to an unrelated later turn', () => {
    const result = groupBackendWorkflowsByTurn(groupTranscriptTurns([user('later', '别的问题', 23)]), [workflow]);
    expect(result.byTurn.size).toBe(0);
    expect(result.unanchored).toEqual([workflow]);
  });
  it('can anchor older records lacking timestamps by their explicit slash prompt', () => {
    const result = groupBackendWorkflowsByTurn(groupTranscriptTurns([user('first', '/deep-research 鲸鱼形象', 20)]), [{ ...workflow, history: [] }]);
    expect(result.byTurn.get('turn-first')).toHaveLength(1);
  });
  it('survives reconnect timestamps and pairs repeated workflows in transcript order', () => {
    const turns = groupTranscriptTurns([user('first', '/deep-research 鲸鱼形象', 30), user('second', '/deep-research 鲸鱼形象', 30), user('reminder', 'A background workflow stopped', 30)]);
    const later = { ...workflow, workflowId: 'wf_later', history: [{ event: 'workflow_started', at: '2026-10-02T14:22:00Z' }] };
    const result = groupBackendWorkflowsByTurn(turns, [later, workflow]);
    expect(result.byTurn.get('turn-first')).toEqual([workflow]);
    expect(result.byTurn.get('turn-second')).toEqual([later]);
    expect(result.byTurn.has('turn-reminder')).toBe(false);
    expect(result.unanchored).toEqual([]);
  });

});
