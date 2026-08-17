import { createHash } from 'node:crypto';

/** Opaque remote project id. Stable for a given Host path; never the path itself. */
export function createRemoteProjectId(projectPath: string): string {
  return `project-${createHash('sha256').update(projectPath).digest('hex').slice(0, 24)}`;
}

export function isRemoteProjectId(value: string): boolean {
  return /^project-[a-f0-9]{24}$/.test(value);
}
