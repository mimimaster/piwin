import type { HostProblem, HostResponse } from '@piwin/contracts';

export function ok(id: string | undefined, command: string, data?: unknown): HostResponse {
  if (id === undefined) {
    return { type: 'response', command, success: true, data };
  }
  return { id, type: 'response', command, success: true, data };
}

export function fail(
  id: string | undefined,
  command: string,
  error: string,
  problem?: HostProblem,
): HostResponse {
  const base = { type: 'response' as const, command, success: false as const, error };
  const withProblem = problem === undefined ? base : { ...base, problem };
  return id === undefined ? withProblem : { ...withProblem, id };
}
