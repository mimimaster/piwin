import type { ParsedDocument } from '@piwin/contracts';
import type { ParserHttpClientOptions } from './parser-http.js';

export type ParserInput = {
  relativePath: string;
  extension: string;
  content: string;
  documentId: string;
  /** Original file bytes. HTTP parsers use this; text parsers ignore it. */
  bytes?: Uint8Array;
};

export interface DocumentParser {
  readonly id: string;
  readonly version: string;
  supports(input: { relativePath: string; extension: string }): boolean;
  parse(input: ParserInput, signal?: AbortSignal): Promise<ParsedDocument>;
}

export type ParserRegistryOptions = {
  mineruEnabled?: boolean;
  unstructuredEnabled?: boolean;
  mineru?: ParserHttpClientOptions;
  unstructured?: ParserHttpClientOptions;
};
