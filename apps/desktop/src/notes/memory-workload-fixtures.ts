/**
 * Deterministic synthetic workloads for memory-reclamation measurement.
 *
 * Each fixture is a bounded script of UI-driving steps a harness can replay
 * while the memory recorder samples. Everything here is synthetic: no real
 * session ids, no user content, no secrets. Step `at` is seconds from start
 * and must stay inside [0, durationSeconds].
 */

export type MemoryWorkloadStep = {
  /** Seconds from workload start. */
  at: number;
  /** Harness action name (e.g. "stream-text", "open-session"). */
  action: string;
  params: Record<string, string | number | boolean>;
};

export type MemoryWorkloadFixture = {
  name: string;
  seed: number;
  durationSeconds: number;
  steps: MemoryWorkloadStep[];
};

function streamSteps(
  seed: number,
  count: number,
  intervalSeconds: number,
  charsPerChunk: number,
): MemoryWorkloadStep[] {
  const steps: MemoryWorkloadStep[] = [];
  for (let i = 0; i < count; i += 1) {
    steps.push({
      at: i * intervalSeconds,
      action: 'stream-text',
      params: {
        chunkIndex: i,
        chars: charsPerChunk,
        syntheticToken: `tok-${seed}-${i}`,
      },
    });
  }
  return steps;
}

/** Long markdown/code streaming — the classic packed-app growth driver. */
const textStream: MemoryWorkloadFixture = {
  name: 'text-stream',
  seed: 101,
  durationSeconds: 60,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-text-1' } },
    ...streamSteps(101, 40, 1.5, 2_048),
  ],
};

/** One background run producing push traffic while the user is idle. */
const backgroundRun: MemoryWorkloadFixture = {
  name: 'background-run',
  seed: 102,
  durationSeconds: 60,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-bg-1' } },
    { at: 0.5, action: 'start-background-run', params: { runId: 'wl-run-1' } },
    ...streamSteps(102, 20, 3, 1_024).map((step) => ({
      ...step,
      at: step.at + 1,
      action: 'run-progress',
    })),
    { at: 59, action: 'await-run-terminal', params: { runId: 'wl-run-1' } },
  ],
};

/** Rapid session switching — exercises the warm-session LRU and unmount path. */
const historyNavigation: MemoryWorkloadFixture = {
  name: 'history-navigation',
  seed: 103,
  durationSeconds: 45,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-hist-1', messages: 200 } },
    { at: 2, action: 'open-session', params: { sessionId: 'wl-hist-2', messages: 200 } },
    { at: 4, action: 'open-session', params: { sessionId: 'wl-hist-3', messages: 200 } },
    { at: 6, action: 'open-session', params: { sessionId: 'wl-hist-4', messages: 200 } },
    ...Array.from({ length: 12 }, (_, i) => ({
      at: 8 + i * 3,
      action: 'open-session',
      params: { sessionId: `wl-hist-${(i % 4) + 1}` },
    })),
  ],
};

/** Transcript with repeated image attachments — object-URL cache + decode work. */
const mediaRich: MemoryWorkloadFixture = {
  name: 'media-rich',
  seed: 104,
  durationSeconds: 45,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-media-1' } },
    ...Array.from({ length: 15 }, (_, i) => ({
      at: i * 3,
      action: 'append-media-message',
      params: {
        attachmentId: `wl-img-${(i % 5) + 1}`,
        edgePx: 1024,
        mimeType: 'image/png',
      },
    })),
  ],
};

/** Streaming artifact fence that mounts a live sandbox iframe per revision. */
const artifactInteractive: MemoryWorkloadFixture = {
  name: 'artifact-interactive',
  seed: 105,
  durationSeconds: 45,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-art-1' } },
    ...Array.from({ length: 10 }, (_, i) => ({
      at: i * 4,
      action: 'stream-artifact',
      params: {
        artifactId: `wl-artifact-${(i % 3) + 1}`,
        revision: i + 1,
        bytes: 4_096,
      },
    })),
    { at: 42, action: 'close-all-artifacts', params: {} },
  ],
};

/** Two visible chat panes streaming in parallel. */
const splitPanes: MemoryWorkloadFixture = {
  name: 'split-panes',
  seed: 106,
  durationSeconds: 40,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-split-1', pane: 'left' } },
    { at: 1, action: 'open-session', params: { sessionId: 'wl-split-2', pane: 'right' } },
    ...Array.from({ length: 16 }, (_, i) => ({
      at: 2 + i * 2,
      action: 'stream-text',
      params: {
        pane: i % 2 === 0 ? 'left' : 'right',
        chunkIndex: i,
        chars: 1_024,
      },
    })),
  ],
};

/** Attention-notification churn — toast mount/unmount cycles. */
const notifications: MemoryWorkloadFixture = {
  name: 'notifications',
  seed: 107,
  durationSeconds: 30,
  steps: [
    { at: 0, action: 'open-session', params: { sessionId: 'wl-notify-1' } },
    ...Array.from({ length: 12 }, (_, i) => ({
      at: i * 2.5,
      action: 'attention-notification',
      params: { notificationId: `wl-notif-${i}`, title: `workload-${i}` },
    })),
  ],
};

export const memoryWorkloadFixtures: Record<string, MemoryWorkloadFixture> = {
  textStream,
  backgroundRun,
  historyNavigation,
  mediaRich,
  artifactInteractive,
  splitPanes,
  notifications,
};
