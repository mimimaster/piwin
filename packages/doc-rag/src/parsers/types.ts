import type { ParsedDocument } from '@piwin/contracts';

export type ParserInput = {
  relativePath: string;
  extension: string;
  content: string;
  documentId: string;
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
};
