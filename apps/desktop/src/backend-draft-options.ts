/** New-session defaults belong to the Agent; choices belong to this draft. */
import type { ExternalAgentStatus, SessionBackendOptions } from '@piwin/contracts';

export type DraftBackendSelections = {
  modelId?: string;
  effortId?: string;
  modeId?: string;
};

export function resolveDraftBackendOptions(
  agentId: string | null | undefined,
  agents: readonly ExternalAgentStatus[] | undefined,
  selections: DraftBackendSelections = {},
): { options: SessionBackendOptions; selections: DraftBackendSelections } | null {
  if (!agentId || agentId === 'pi') return null;
  const status = agents?.find((agent) => agent.agentId === agentId);
  const base = status && 'options' in status ? status.options : undefined;
  if (!base || base.models.length === 0) return null;

  const {
    currentModelId: defaultModelId,
    currentEffortId: defaultEffortId,
    currentModeId: defaultModeId,
    ...catalog
  } = base;
  const chosenModel = base.models.find((model) => model.id === selections.modelId);
  const model =
    chosenModel ?? base.models.find((model) => model.id === defaultModelId) ?? base.models[0];
  if (!model) return null;
  // An effort selected for a removed model must not follow its replacement.
  const modelRemoved = selections.modelId !== undefined && chosenModel === undefined;
  const efforts = model.efforts ?? [];
  const chosenEffort =
    !modelRemoved && selections.effortId !== undefined && efforts.includes(selections.effortId)
      ? selections.effortId
      : undefined;
  const effort =
    chosenEffort ??
    (defaultEffortId !== undefined && efforts.includes(defaultEffortId)
      ? defaultEffortId
      : efforts[0]);
  const chosenMode = base.modes.find((mode) => mode.id === selections.modeId);
  const mode = chosenMode ?? base.modes.find((option) => option.id === defaultModeId);

  return {
    options: {
      ...catalog,
      currentModelId: model.id,
      ...(effort !== undefined ? { currentEffortId: effort } : {}),
      ...(mode ? { currentModeId: mode.id } : {}),
    },
    selections: {
      ...(chosenModel ? { modelId: chosenModel.id } : {}),
      ...(chosenEffort !== undefined ? { effortId: chosenEffort } : {}),
      ...(chosenMode ? { modeId: chosenMode.id } : {}),
    },
  };
}
