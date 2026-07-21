/**
 * Serialize artifact iframe srcdoc assignment for history performance.
 * Ported from openwebui_m artifactInitQueue.
 */
import { MAX_CONCURRENT_ARTIFACT_INITS } from './constants.js';

type InitRequest = {
  id: string;
  priority: number;
  resolve: (value: { granted: true }) => void;
};

const activeIds = new Set<string>();
const queue: InitRequest[] = [];

export function getActiveArtifactInitCount(): number {
  return activeIds.size;
}

export function getQueuedArtifactInitCount(): number {
  return queue.length;
}

export function resetArtifactInitQueueForTests(): void {
  activeIds.clear();
  queue.length = 0;
}

export function requestArtifactInit(
  id: string,
  options: { priority?: number } = {},
): Promise<{ granted: true }> {
  const priority = options.priority ?? 0;

  if (activeIds.has(id)) {
    return Promise.resolve({ granted: true });
  }

  if (activeIds.size < MAX_CONCURRENT_ARTIFACT_INITS && queue.length === 0) {
    activeIds.add(id);
    return Promise.resolve({ granted: true });
  }

  return new Promise((resolve) => {
    const existingIndex = queue.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
      queue.splice(existingIndex, 1);
    }
    queue.push({ id, priority, resolve });
    queue.sort((left, right) => right.priority - left.priority);
  });
}

export function releaseArtifactInit(id: string): void {
  activeIds.delete(id);

  while (activeIds.size < MAX_CONCURRENT_ARTIFACT_INITS && queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    if (activeIds.has(next.id)) {
      next.resolve({ granted: true });
      continue;
    }
    activeIds.add(next.id);
    next.resolve({ granted: true });
  }
}
