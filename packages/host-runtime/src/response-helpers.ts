import type { HostResponse } from '@piwin/contracts';

export function ok(id: string | undefined, command: string, data?: unknown): HostResponse {
  if (id === undefined) {
    return { type: 'response', command, success: true, data };
  }
  return { id, type: 'response', command, success: true, data };
}

export function fail(id: string | undefined, command: string, error: string): HostResponse {
  if (id === undefined) {
    return { type: 'response', command, success: false, error };
  }
  return { id, type: 'response', command, success: false, error };
}
