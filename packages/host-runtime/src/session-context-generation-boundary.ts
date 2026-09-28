import type { ContextMeasurement } from '@piwin/contracts';

/** Durable boundary axes a runtime generation inherited when it was activated. */
export type GenerationActivationBoundary = {
  runtimeGenerationId: string;
  compactionBoundary?: string;
};

/**
 * A freshly bound Pi runtime loads the already-compacted session from disk,
 * but its sampler only learns a compaction boundary from `compaction/end`
 * events it observes itself. Without this, every sample from a generation
 * activated after a durable compaction omits the axis and the Host drops it
 * as boundary-incompatible, leaving occupancy unknown until the next compact.
 *
 * Only the activation-time boundary is inherited, and only for the same
 * generation: once that generation compacts, the sampler stamps the new
 * boundary itself, so late pre-compaction samples still resolve to the old
 * axis and stay rejected.
 */
export function inheritActivationCompactionBoundary(
  measurement: ContextMeasurement,
  activation: GenerationActivationBoundary | undefined,
): ContextMeasurement {
  if (
    activation?.compactionBoundary === undefined ||
    measurement.runtimeGenerationId === undefined ||
    measurement.runtimeGenerationId !== activation.runtimeGenerationId ||
    measurement.contextBoundary.compactionBoundary !== undefined
  ) {
    return measurement;
  }
  return {
    ...measurement,
    contextBoundary: {
      ...measurement.contextBoundary,
      compactionBoundary: activation.compactionBoundary,
    },
  };
}
