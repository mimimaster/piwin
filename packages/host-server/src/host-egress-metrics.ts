export type HostEgressClientStats = {
  clientId: string;
  queuedItems: number;
  queuedBytes: number;
  highWaterItems: number;
  highWaterBytes: number;
  sentFrames: number;
  sentItems: number;
  sentBytes: number;
  replayFrames: number;
  replayItems: number;
  replayBytes: number;
  projectionReplacements: number;
  diagnosticsEvicted: number;
  oversizedItems: number;
  slowConsumerDisconnects: number;
  filteredItems: number;
  subscriptionCount: number;
  closed: boolean;
};

/** Bounded, payload-free counters suitable for a local diagnostic surface. */
export type HostEgressStats = {
  ingressByType: Record<string, number>;
  canonicalByPolicy: Record<string, number>;
  batches: number;
  bytes: number;
  projectionsReplaced: number;
  diagnosticsEvicted: number;
  oversizedItems: number;
  slowConsumerDisconnects: number;
  replayRecords: number;
  replayBytes: number;
  snapshotFallbacks: number;
  clients: HostEgressClientStats[];
};
