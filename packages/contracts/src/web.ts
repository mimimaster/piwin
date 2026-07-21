/** Web search / fetch contracts for @piwin/tools-web */

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

export type WebSearchResult = {
  query: string;
  providerId: string;
  hits: SearchHit[];
};

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
};

export type WebConfig = {
  searchProvider: 'brave' | 'tavily' | 'none';
  searchApiKeyEnv: string;
  searchMaxResults: number;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  fetchBlockedUrlPrefixes: string[];
};
