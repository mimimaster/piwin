import type { ScannedFileV2 } from '@piwin/contracts';
import {
  CODE_EXTENSIONS,
  CONFIG_EXTENSIONS,
  fileExtension,
  MARKDOWN_EXTENSIONS,
  MINERU_EXTENSIONS,
  TEXT_EXTENSIONS,
  UNSTRUCTURED_EXTENSIONS,
} from './extensions.js';
import { createCodeParser } from './code-parser.js';
import { createMarkdownParser } from './markdown-parser.js';
import { createMineruAdapter } from './mineru-adapter.js';
import { createTextParser } from './text-parser.js';
import { createUnstructuredAdapter } from './unstructured-adapter.js';
import type { DocumentParser, ParserRegistryOptions } from './types.js';

export type ParserRegistry = {
  parsers: DocumentParser[];
  getSupportedExtensions(): string[];
  findParser(input: { relativePath: string; extension: string }): DocumentParser | undefined;
  classify(input: { relativePath: string; sizeBytes: number }): ScannedFileV2;
};

export function createParserRegistry(options: ParserRegistryOptions = {}): ParserRegistry {
  const mineruEnabled = options.mineruEnabled === true;
  const unstructuredEnabled = options.unstructuredEnabled === true;
  const parsers: DocumentParser[] = [
    createMarkdownParser(),
    createTextParser(),
    createCodeParser(),
    createUnstructuredAdapter(unstructuredEnabled),
    createMineruAdapter(mineruEnabled),
  ];

  function findParser(input: { relativePath: string; extension: string }): DocumentParser | undefined {
    return parsers.find((parser) => parser.supports(input));
  }

  function getSupportedExtensions(): string[] {
    const catalog = [
      ...MARKDOWN_EXTENSIONS,
      ...TEXT_EXTENSIONS,
      ...CODE_EXTENSIONS,
      ...CONFIG_EXTENSIONS,
      ...UNSTRUCTURED_EXTENSIONS,
      ...MINERU_EXTENSIONS,
    ];
    const extensions = new Set<string>();
    for (const extension of catalog) {
      if (findParser({ relativePath: `file${extension}`, extension })) {
        extensions.add(extension);
      }
    }
    return [...extensions].sort();
  }

  function classify(input: { relativePath: string; sizeBytes: number }): ScannedFileV2 {
    const extension = fileExtension(input.relativePath);
    const parser = findParser({ relativePath: input.relativePath, extension });
    if (parser) {
      return {
        relativePath: input.relativePath,
        extension,
        sizeBytes: input.sizeBytes,
        support: 'supported',
      };
    }
    let unsupportedReason: ScannedFileV2['unsupportedReason'] = 'UNSUPPORTED_FILE_TYPE';
    if (MINERU_EXTENSIONS.includes(extension as (typeof MINERU_EXTENSIONS)[number])) {
      unsupportedReason = 'MINERU_NOT_CONFIGURED';
    } else if (UNSTRUCTURED_EXTENSIONS.includes(extension as (typeof UNSTRUCTURED_EXTENSIONS)[number])) {
      unsupportedReason = 'UNSTRUCTURED_NOT_CONFIGURED';
    }
    return {
      relativePath: input.relativePath,
      extension,
      sizeBytes: input.sizeBytes,
      support: 'unsupported',
      unsupportedReason,
    };
  }

  return { parsers, getSupportedExtensions, findParser, classify };
}

/** Extensions the default (always-on) parsers can ingest. */
export function localSupportedExtensions(): string[] {
  return createParserRegistry().getSupportedExtensions();
}
