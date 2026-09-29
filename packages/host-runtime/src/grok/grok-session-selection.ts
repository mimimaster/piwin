/**
 * Grok model / effort / mode selection for one live session (ADR 0082).
 * Validates against Grok-reported options, writes through ACP, and keeps the
 * shared option state current. `set_config_option` takes a plain string.
 */

import type { AcpClient, GrokSessionOptionsState } from '@piwin/acp-agent';

export type GrokSelectionTarget = {
  client: AcpClient;
  options: GrokSessionOptionsState;
  backendSessionId: () => string;
  publishOptions: () => void;
};

export async function selectGrokModel(target: GrokSelectionTarget, modelId: string): Promise<void> {
  if (!target.options.hasModel(modelId)) {
    throw new Error(`unknown-grok-model: ${modelId}`);
  }
  const result = await target.client.setConfigOption(target.backendSessionId(), 'model', modelId);
  target.options.applyConfigOptions(readConfigOptions(result));
  target.options.applyConfigOptions([{ id: 'model', currentValue: modelId }]);
  target.publishOptions();
}

export async function selectGrokEffort(target: GrokSelectionTarget, effortId: string): Promise<void> {
  const modelId = target.options.modelId;
  if (modelId !== undefined && !target.options.modelSupportsEffort(modelId, effortId)) {
    throw new Error(`unsupported-grok-effort: ${effortId}`);
  }
  const result = await target.client.setConfigOption(target.backendSessionId(), 'reasoning_effort', effortId);
  target.options.applyConfigOptions(readConfigOptions(result));
  target.options.applyConfigOptions([{ id: 'reasoning_effort', currentValue: effortId }]);
  target.publishOptions();
}

/** Mode is unconfirmed until Grok acknowledges it (only plan/ask do today). */
export async function selectGrokMode(target: GrokSelectionTarget, modeId: string): Promise<void> {
  target.options.requestMode(modeId);
  target.publishOptions();
  await target.client.setMode(target.backendSessionId(), modeId);
}

/** Re-apply the user's persisted choices after new/resume/load. */
export async function applyGrokInitialSelections(
  target: GrokSelectionTarget,
  input: { modelId?: string; effortId?: string; modeId?: string },
): Promise<void> {
  if (
    input.modelId !== undefined &&
    input.modelId !== target.options.modelId &&
    target.options.hasModel(input.modelId)
  ) {
    await selectGrokModel(target, input.modelId);
  }
  if (input.effortId !== undefined) {
    const modelId = target.options.modelId;
    if (modelId === undefined || target.options.modelSupportsEffort(modelId, input.effortId)) {
      await selectGrokEffort(target, input.effortId);
    }
  }
  if (input.modeId !== undefined) {
    await selectGrokMode(target, input.modeId);
  }
}

function readConfigOptions(result: unknown): unknown {
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? (result as Record<string, unknown>).configOptions
    : undefined;
}
