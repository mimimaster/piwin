import { describe, expect, it } from 'vitest';
import type { ModelRef } from '@piwin/contracts';
import { resolveSessionTurnProfile } from './session-turn-profile.js';

const applied: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'acme',
  modelId: 'applied-chat',
};

const recordModel: ModelRef = {
  protocol: 'openai-compatible',
  providerId: 'acme',
  modelId: 'record-chat',
};

const inputModel: ModelRef = {
  protocol: 'anthropic-compatible',
  providerId: 'other',
  modelId: 'input-chat',
};

describe('resolveSessionTurnProfile', () => {
  it('lets input.model win over record and applied', () => {
    const profile = resolveSessionTurnProfile({
      input: { model: inputModel, thinkingLevel: 'low' },
      record: { model: recordModel, thinkingLevel: 'high' },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(profile.desiredModel).toEqual(inputModel);
    expect(profile.previousModel).toEqual(applied);
  });

  it('uses record.model when input.model is omitted', () => {
    const profile = resolveSessionTurnProfile({
      input: {},
      record: { model: recordModel },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(profile.desiredModel).toEqual(recordModel);
    expect(profile.previousModel).toEqual(applied);
  });

  it('uses applied when input and record omit model', () => {
    const profile = resolveSessionTurnProfile({
      input: {},
      record: {},
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(profile.desiredModel).toEqual(applied);
  });

  it('does not require replacement when the provider is unchanged', () => {
    const profile = resolveSessionTurnProfile({
      input: {},
      record: { model: recordModel },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(profile.desiredModel?.providerId).toBe(applied.providerId);
    expect(profile.requiresModelRuntimeReplacement).toBe(false);
  });

  it('requires replacement when the provider changes and a live handle exists', () => {
    const profile = resolveSessionTurnProfile({
      input: {},
      record: { model: inputModel },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(profile.requiresModelRuntimeReplacement).toBe(true);
  });

  it('does not require replacement when there is no live handle', () => {
    const profile = resolveSessionTurnProfile({
      input: {},
      record: { model: inputModel },
      appliedModel: applied,
      hasLiveHandle: false,
    });
    expect(profile.requiresModelRuntimeReplacement).toBe(false);
  });

  it('lets input thinkingLevel win, otherwise uses the record', () => {
    const fromInput = resolveSessionTurnProfile({
      input: { thinkingLevel: 'minimal' },
      record: { thinkingLevel: 'high' },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(fromInput.desiredThinkingLevel).toBe('minimal');

    const fromRecord = resolveSessionTurnProfile({
      input: {},
      record: { thinkingLevel: 'high' },
      appliedModel: applied,
      hasLiveHandle: true,
    });
    expect(fromRecord.desiredThinkingLevel).toBe('high');
  });
});
