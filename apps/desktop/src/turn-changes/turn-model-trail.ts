/**
 * Which models answered one turn, in order.
 *
 * A turn can switch models mid-run (start on one, continue on another). The
 * byline used to show only the first, so a turn that finished on DeepSeek
 * kept reading "GPT-6-luna". The latest model is the one that is answering
 * now; the trail keeps the switch visible.
 */
import type { ModelRef } from '@piwin/contracts';

export type TurnModelTrail = {
  /** Distinct models in answer order; consecutive repeats collapse. */
  models: ModelRef[];
  latest: ModelRef | null;
};

function sameModel(left: ModelRef, right: ModelRef): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId;
}

export function resolveTurnModelTrail(
  messages: ReadonlyArray<{ role: string; model?: ModelRef | undefined }>,
): TurnModelTrail {
  const models: ModelRef[] = [];
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.model) continue;
    const previous = models[models.length - 1];
    if (previous === undefined || !sameModel(previous, message.model)) {
      models.push(message.model);
    }
  }
  return { models, latest: models[models.length - 1] ?? null };
}

/**
 * `Luna → DeepSeek`; a turn that switched more than once keeps its ends:
 * `Luna → … → DeepSeek`. A single model is just its label.
 */
export function formatTurnModelTrail(
  trail: TurnModelTrail,
  label: (modelId: string) => string,
): string {
  const first = trail.models[0];
  const latest = trail.latest;
  if (!first || !latest) return '';
  if (trail.models.length === 1) return label(latest.modelId);
  const middle = trail.models.length > 2 ? ' → …' : '';
  return `${label(first.modelId)}${middle} → ${label(latest.modelId)}`;
}
