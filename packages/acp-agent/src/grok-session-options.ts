/**
 * Grok session option projection (ADR 0082): models, reasoning effort,
 * permission modes and slash commands → `SessionBackendOptions`.
 *
 * Wire shapes (grok 1.0.44): `models.availableModels[]` with
 * `{ modelId, name, description, _meta: { totalContextTokens,
 * supportsReasoningEffort, reasoningEffort, reasoningEfforts[{ id|value,
 * label, default }] } }`, and ACP `configOptions[]` with
 * `{ id: 'model' | 'reasoning_effort', currentValue, options[{ value, name }] }`.
 */

import type {
  BackendModelOption,
  BackendOption,
  BackendSlashCommand,
  SessionBackendOptions,
} from '@piwin/contracts';

/**
 * Grok permission modes (CLI `--permission-mode`). `session/new` does not
 * report modes, so the list is registered per verified CLI version.
 */
export const GROK_PERMISSION_MODES: readonly BackendOption[] = [
  { id: 'default', label: 'Default', description: 'Ask before edits and commands' },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Apply edits without asking' },
  { id: 'auto', label: 'Auto', description: 'Grok decides when to ask' },
  { id: 'dontAsk', label: "Don't ask", description: 'Deny anything that would ask' },
  { id: 'bypassPermissions', label: 'Always approve', description: 'Run everything without asking' },
  { id: 'plan', label: 'Plan', description: 'Plan first, no edits' },
];

/** Modes whose switch Grok acknowledges with `current_mode_update`. */
export const GROK_CONFIRMED_MODE_IDS: ReadonlySet<string> = new Set(['plan', 'ask']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export type GrokModelState = {
  models: BackendModelOption[];
  currentModelId?: string;
  /** Default effort per model, used when the session has not chosen one. */
  defaultEffortByModel: Map<string, string>;
};

/** Parse `models` from session setup or `_x.ai/models/update`. */
export function parseGrokModelState(value: unknown): GrokModelState | undefined {
  const record = asRecord(value);
  if (record === undefined || !Array.isArray(record.availableModels)) {
    return undefined;
  }
  const models: BackendModelOption[] = [];
  const defaultEffortByModel = new Map<string, string>();
  for (const entry of record.availableModels) {
    const model = asRecord(entry);
    const id = readString(model, 'modelId');
    if (id === undefined) {
      continue;
    }
    const option: BackendModelOption = { id, label: readString(model, 'name') ?? id };
    const description = readString(model, 'description');
    if (description !== undefined) {
      option.description = description;
    }
    const meta = asRecord(model?._meta);
    if (typeof meta?.totalContextTokens === 'number') {
      option.contextTokens = meta.totalContextTokens;
    }
    if (meta?.supportsReasoningEffort === true && Array.isArray(meta.reasoningEfforts)) {
      const efforts: string[] = [];
      for (const effort of meta.reasoningEfforts) {
        const effortRecord = asRecord(effort);
        const effortId = readString(effortRecord, 'value') ?? readString(effortRecord, 'id');
        if (effortId !== undefined) {
          efforts.push(effortId);
          if (effortRecord?.default === true) {
            defaultEffortByModel.set(id, effortId);
          }
        }
      }
      if (efforts.length > 0) {
        option.efforts = efforts;
      }
      const current = readString(meta, 'reasoningEffort');
      if (current !== undefined && !defaultEffortByModel.has(id)) {
        defaultEffortByModel.set(id, current);
      }
    }
    models.push(option);
  }
  const state: GrokModelState = { models, defaultEffortByModel };
  const currentModelId = readString(record, 'currentModelId');
  if (currentModelId !== undefined) {
    state.currentModelId = currentModelId;
  }
  return state;
}

/** Current values from ACP `configOptions` (`model`, `reasoning_effort`). */
export function parseGrokConfigCurrent(value: unknown): { modelId?: string; effortId?: string } {
  const current: { modelId?: string; effortId?: string } = {};
  if (!Array.isArray(value)) {
    return current;
  }
  for (const entry of value) {
    const option = asRecord(entry);
    const id = readString(option, 'id');
    const currentValue = readString(option, 'currentValue');
    if (currentValue === undefined) {
      continue;
    }
    if (id === 'model') {
      current.modelId = currentValue;
    } else if (id === 'reasoning_effort') {
      current.effortId = currentValue;
    }
  }
  return current;
}

/** Parse `available_commands_update.availableCommands`. */
export function parseGrokCommands(value: readonly unknown[]): BackendSlashCommand[] {
  const commands: BackendSlashCommand[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const name = readString(record, 'name');
    if (name === undefined) {
      continue;
    }
    const command: BackendSlashCommand = { name };
    const description = readString(record, 'description');
    if (description !== undefined) {
      command.description = description;
    }
    const hint = readString(asRecord(record?.input), 'hint');
    if (hint !== undefined) {
      command.inputHint = hint;
    }
    commands.push(command);
  }
  return commands;
}

/** Mutable per-session option state owned by the Host session. */
export class GrokSessionOptionsState {
  private modelState: GrokModelState = { models: [], defaultEffortByModel: new Map() };
  private currentModelId: string | undefined;
  private currentEffortId: string | undefined;
  private currentModeId: string | undefined;
  private modeConfirmed = true;
  private autoApprove: boolean | undefined;
  private commands: BackendSlashCommand[] = [];

  applyModels(value: unknown): void {
    const parsed = parseGrokModelState(value);
    if (parsed === undefined) {
      return;
    }
    this.modelState = parsed;
    if (this.currentModelId === undefined && parsed.currentModelId !== undefined) {
      this.currentModelId = parsed.currentModelId;
    }
  }

  applyConfigOptions(value: unknown): void {
    const current = parseGrokConfigCurrent(value);
    if (current.modelId !== undefined) {
      this.currentModelId = current.modelId;
    }
    if (current.effortId !== undefined) {
      this.currentEffortId = current.effortId;
    }
  }

  applyCommands(value: readonly unknown[]): void {
    this.commands = parseGrokCommands(value);
  }

  /** A mode switch was requested; confirmed only if Grok acknowledges it. */
  requestMode(modeId: string): void {
    this.currentModeId = modeId;
    this.modeConfirmed = false;
  }

  confirmMode(modeId: string): void {
    this.currentModeId = modeId;
    this.modeConfirmed = true;
  }

  setAutoApprove(autoApprove: boolean): void {
    this.autoApprove = autoApprove;
  }

  get modelId(): string | undefined {
    return this.currentModelId;
  }

  modelSupportsEffort(modelId: string, effortId: string): boolean {
    const model = this.modelState.models.find((candidate) => candidate.id === modelId);
    return model?.efforts?.includes(effortId) === true;
  }

  hasModel(modelId: string): boolean {
    return this.modelState.models.some((candidate) => candidate.id === modelId);
  }

  snapshot(agentId: string): SessionBackendOptions {
    const options: SessionBackendOptions = {
      agentId,
      models: this.modelState.models,
      modes: GROK_PERMISSION_MODES,
      modeConfirmed: this.modeConfirmed,
      commands: this.commands,
    };
    if (this.currentModelId !== undefined) {
      options.currentModelId = this.currentModelId;
    }
    const effort =
      this.currentEffortId ??
      (this.currentModelId !== undefined
        ? this.modelState.defaultEffortByModel.get(this.currentModelId)
        : undefined);
    if (effort !== undefined) {
      options.currentEffortId = effort;
    }
    if (this.currentModeId !== undefined) {
      options.currentModeId = this.currentModeId;
    }
    if (this.autoApprove !== undefined) {
      options.autoApprove = this.autoApprove;
    }
    return options;
  }
}
