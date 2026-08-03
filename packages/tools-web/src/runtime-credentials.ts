/** Raw credentials resolved by the host for one in-memory tool registration. */
export type WebRuntimeCredentials = {
  /** Search source id to API key. Values must never be serialized or logged. */
  searchApiKeysBySourceId?: Readonly<Record<string, string>>;
  /** API key for the selected Jina or Firecrawl fetch provider. */
  fetchApiKey?: string;
};
