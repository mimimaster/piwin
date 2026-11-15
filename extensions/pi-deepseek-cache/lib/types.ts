export interface PersistedStats {
  cacheRead: number;
  input: number;
  cacheWrite: number;
  turns: number;
}

export interface HistoryPoint {
  turn: number;
  hitRate: number;
  timestamp: number;
}

export interface CachedMessage {
  role: string;
  content?: string;
  customType?: string;
}
