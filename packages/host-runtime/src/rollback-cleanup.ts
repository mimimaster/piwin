import { formatError } from '@piwin/contracts';

/**
 * Catch handler for a best-effort rollback step. The original failure is what
 * the caller reports, so the rollback must not throw over it; but a rollback
 * that fails leaves residue (an orphan index row, a live session, a stored
 * secret), so it is logged at the Host boundary instead of vanishing.
 */
export function logRollbackFailure(step: string, subject: string): (error: unknown) => void {
  return (error) => {
    console.warn(`Rollback step "${step}" failed for ${subject}: ${formatError(error)}`);
  };
}
