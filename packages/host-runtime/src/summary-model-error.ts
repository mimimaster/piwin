/**
 * Failure of the model that writes a transcript summary (handoff /
 * compact-export). Carries the model so shells can tell the user which one
 * to change instead of surfacing a bare provider message.
 */
import type { ModelRef, SummaryModelUnavailableProblem } from '@piwin/contracts';

export class SummaryModelError extends Error {
  override readonly name = 'SummaryModelError';

  constructor(
    readonly model: ModelRef | undefined,
    readonly reason: string,
  ) {
    super(
      model
        ? `Summary model ${model.providerId}/${model.modelId} is unavailable: ${reason}. ` +
            "Switch the source session's model and try again."
        : `The summary failed on the runtime's default model: ${reason}. ` +
            'Pick a model for the source session and try again.',
    );
  }

  toProblem(): SummaryModelUnavailableProblem {
    return {
      code: 'summary-model-unavailable',
      data: {
        ...(this.model
          ? { model: { providerId: this.model.providerId, modelId: this.model.modelId } }
          : {}),
        reason: this.reason,
      },
    };
  }
}
