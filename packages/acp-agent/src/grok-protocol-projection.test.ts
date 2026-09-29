import { describe, expect, it } from 'vitest';
import {
  classifyGrokStopReason,
  parseGrokPermissionRequest,
  parseGrokPromptUsage,
  projectGrokCatalogEntry,
} from './grok-protocol-projection.js';
import { GrokSessionOptionsState, parseGrokCommands, parseGrokModelState } from './grok-session-options.js';

const PERMISSION_PARAMS = {
  sessionId: 's-1',
  toolCall: {
    toolCallId: 'call-1',
    kind: 'edit',
    title: 'Write `/tmp/ws/note.txt`',
    rawInput: { path: '/tmp/ws/note.txt' },
  },
  options: [
    { optionId: 'allow-edits-session', kind: 'allow_always', name: 'Yes, allow all edits during this session' },
    { optionId: 'allow-once', kind: 'allow_once', name: 'Yes' },
    { optionId: 'reject-once', kind: 'reject_once', name: 'No, and tell Grok what to do differently' },
    { optionId: 'weird', kind: 'maybe', name: 'dropped' },
  ],
};

const MODELS = {
  currentModelId: 'grok-4.7-build-fast',
  availableModels: [
    {
      modelId: 'grok-4.7',
      name: 'Grok 4.7',
      _meta: {
        totalContextTokens: 256000,
        supportsReasoningEffort: true,
        reasoningEffort: 'high',
        reasoningEfforts: [
          { id: 'high', value: 'high', label: 'High', default: true },
          { id: 'low', value: 'low', label: 'Low', default: false },
        ],
      },
    },
    { modelId: 'grok-4.7-build-fast', name: 'Grok 4.7 Fast', _meta: { supportsReasoningEffort: false } },
    { name: 'no id' },
  ],
};

describe('parseGrokPermissionRequest', () => {
  it('keeps Grok options verbatim and builds a file-write context', () => {
    const prompt = parseGrokPermissionRequest(PERMISSION_PARAMS, 'grok');
    expect(prompt?.options.map((option) => option.optionId)).toEqual([
      'allow-edits-session',
      'allow-once',
      'reject-once',
    ]);
    expect(prompt?.options[2]?.label).toBe('No, and tell Grok what to do differently');
    expect(prompt?.context).toMatchObject({
      kind: 'file-write',
      summary: 'Write `/tmp/ws/note.txt`',
      paths: ['/tmp/ws/note.txt'],
      backendAgentId: 'grok',
    });
    expect(prompt?.toolCallId).toBe('call-1');
  });

  it('returns undefined when no usable option exists', () => {
    expect(parseGrokPermissionRequest({ options: [] }, 'grok')).toBeUndefined();
    expect(parseGrokPermissionRequest({}, 'grok')).toBeUndefined();
  });
});

describe('parseGrokPromptUsage', () => {
  it('maps Grok usage fields', () => {
    expect(
      parseGrokPromptUsage({
        modelId: 'grok-4.6-build',
        usage: { inputTokens: 10, outputTokens: 5, cachedReadTokens: 3, reasoningTokens: 2, apiDurationMs: 900, costUsdTicks: 7 },
      }),
    ).toEqual({
      modelId: 'grok-4.6-build',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      reasoningTokens: 2,
      totalTokens: 15,
      durationMs: 900,
    });
    expect(parseGrokPromptUsage(undefined)).toBeUndefined();
  });
});

describe('classifyGrokStopReason', () => {
  it('distinguishes rejection from user stop', () => {
    expect(classifyGrokStopReason('end_turn', { userCancelled: false, permissionRejected: false })).toEqual({ status: 'completed', stopReason: 'stop' });
    expect(classifyGrokStopReason('cancelled', { userCancelled: false, permissionRejected: true })).toEqual({ status: 'aborted', reason: 'permission-rejected' });
    expect(classifyGrokStopReason('cancelled', { userCancelled: true, permissionRejected: true })).toEqual({ status: 'aborted', reason: 'user-cancelled' });
    expect(classifyGrokStopReason('max_turn_requests', { userCancelled: false, permissionRejected: false }).status).toBe('completed');
    expect(classifyGrokStopReason('refusal', { userCancelled: false, permissionRejected: false }).status).toBe('failed');
  });
});

describe('projectGrokCatalogEntry', () => {
  it('normalizes titles and flags', () => {
    expect(
      projectGrokCatalogEntry({
        sessionId: 'g-1',
        title: { text: ' Hello ' },
        cwd: '/tmp/ws',
        activity: 'idle',
        yolo: true,
        lastChangeUnixMs: 5,
        origin: { kind: 'tui' },
      }),
    ).toEqual({
      backendSessionId: 'g-1',
      title: 'Hello',
      cwd: '/tmp/ws',
      activity: 'idle',
      autoApprove: true,
      lastChangeUnixMs: 5,
      originKind: 'tui',
    });
    expect(projectGrokCatalogEntry({ sessionId: 'g-2', title: null }).title).toBeUndefined();
  });
});

describe('Grok session options', () => {
  it('parses models with efforts and context size', () => {
    const state = parseGrokModelState(MODELS);
    expect(state?.models.map((model) => model.id)).toEqual(['grok-4.7', 'grok-4.7-build-fast']);
    expect(state?.models[0]).toMatchObject({ contextTokens: 256000, efforts: ['high', 'low'] });
    expect(state?.models[1]?.efforts).toBeUndefined();
    expect(state?.defaultEffortByModel.get('grok-4.7')).toBe('high');
  });

  it('parses slash commands with input hints', () => {
    expect(parseGrokCommands([{ name: 'always-approve', description: 'Toggle', input: { hint: 'on|off' } }, { nope: 1 }])).toEqual([
      { name: 'always-approve', description: 'Toggle', inputHint: 'on|off' },
    ]);
  });

  it('tracks current values and unconfirmed mode switches', () => {
    const options = new GrokSessionOptionsState();
    options.applyModels(MODELS);
    options.applyConfigOptions([
      { id: 'model', currentValue: 'grok-4.7' },
      { id: 'reasoning_effort', currentValue: 'low' },
    ]);
    options.requestMode('auto');
    let snapshot = options.snapshot('grok');
    expect(snapshot).toMatchObject({ currentModelId: 'grok-4.7', currentEffortId: 'low', currentModeId: 'auto', modeConfirmed: false });
    options.confirmMode('plan');
    snapshot = options.snapshot('grok');
    expect(snapshot).toMatchObject({ currentModeId: 'plan', modeConfirmed: true });
    expect(options.modelSupportsEffort('grok-4.7', 'low')).toBe(true);
    expect(options.modelSupportsEffort('grok-4.7-build-fast', 'low')).toBe(false);
    expect(snapshot.modes.map((mode) => mode.id)).toContain('bypassPermissions');
  });
});
