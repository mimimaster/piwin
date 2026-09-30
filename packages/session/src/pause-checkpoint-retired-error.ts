/**
 * A pause asked to save under a checkpoint id whose task was already retired
 * (consumed by a completed resume, or cleared by a newer prompt or a cancel).
 *
 * Retiring is the owner's decision that the paused task is abandoned, so the
 * store refuses to bring it back and callers must not read this as a storage
 * fault: the run that raced the retirement simply ends as cancelled.
 */
export class PauseCheckpointRetiredError extends Error {
  readonly checkpointId: string;
  readonly retiredStatus: 'consumed' | 'cleared';

  constructor(checkpointId: string, retiredStatus: 'consumed' | 'cleared') {
    super(`pause-checkpoint-retired: checkpoint ${checkpointId} was already ${retiredStatus}`);
    this.name = 'PauseCheckpointRetiredError';
    this.checkpointId = checkpointId;
    this.retiredStatus = retiredStatus;
  }
}
