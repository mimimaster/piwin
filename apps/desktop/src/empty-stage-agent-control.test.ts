import { describe, expect, it, vi } from 'vitest';
import { buildEmptyStageAgentControl } from './empty-stage-agent-control.js';

describe('empty stage agent control', () => {
  it('shows the bound backend rather than an unrelated Pi draft', () => {
    const control = buildEmptyStageAgentControl({
      activeSessionId: 'grok-session', activeAgentId: 'grok', draftAgentId: 'pi',
    }, { draftAgentId: 'pi' });
    expect(control.agentId).toBe('grok');
  });

  it('starts an unsent Pi draft instead of changing the bound Grok session', async () => {
    const onStartNewSession = vi.fn();
    const onDraftAgentChange = vi.fn();
    const control = buildEmptyStageAgentControl({
      activeSessionId: 'grok-session', activeAgentId: 'grok',
      onStartNewSession, onDraftAgentChange,
    }, {});
    await control.selectAgent('pi');
    expect(onStartNewSession).toHaveBeenCalledWith({ agentId: 'pi' });
    expect(onDraftAgentChange).not.toHaveBeenCalled();
  });

  it('starts a Grok draft from a bound Pi session', async () => {
    const onStartNewSession = vi.fn();
    const control = buildEmptyStageAgentControl({
      activeSessionId: 'pi-session', activeAgentId: 'pi', onStartNewSession,
    }, {});
    await control.selectAgent('grok');
    expect(onStartNewSession).toHaveBeenCalledWith({ agentId: 'grok' });
  });

  it('uses scoped draft selection and options instead of legacy global props', async () => {
    const onDraftAgentChange = vi.fn();
    const legacySelect = vi.fn();
    const choices = [{ agentId: 'grok', label: 'Grok', ready: true }];
    const control = buildEmptyStageAgentControl({
      activeSessionId: null, draftAgentId: 'grok', draftAgentOptions: choices, onDraftAgentChange,
    }, { draftAgentId: 'pi', onSelectDraftAgent: legacySelect });
    expect(control.agentId).toBe('grok');
    expect(control.agentOptions).toBe(choices);
    await control.selectAgent('pi');
    expect(onDraftAgentChange).toHaveBeenCalledWith('pi');
    expect(legacySelect).not.toHaveBeenCalled();
  });

  it('does not recreate a session when its current engine is selected', async () => {
    const onStartNewSession = vi.fn();
    const onDraftAgentChange = vi.fn();
    const control = buildEmptyStageAgentControl({
      activeSessionId: 'grok-session', activeAgentId: 'grok', onStartNewSession, onDraftAgentChange,
    }, {});
    await control.selectAgent('grok');
    expect(onStartNewSession).not.toHaveBeenCalled();
    expect(onDraftAgentChange).toHaveBeenCalledWith('grok');
  });

  it('propagates a navigation error for the UI boundary to report', async () => {
    const control = buildEmptyStageAgentControl({
      activeSessionId: 'grok-session', activeAgentId: 'grok',
      onStartNewSession: vi.fn().mockRejectedValue(new Error('navigation failed')),
    }, {});
    await expect(control.selectAgent('pi')).rejects.toThrow('navigation failed');
  });
});
