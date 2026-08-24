/**
 * Descriptor parser entry used by evaluateCodeFence. Implementation lives in
 * fence-parser.ts; this file keeps the historical import path.
 */
export {
  parseArtifactFenceRecord,
  tryParseArtifactFence,
  tryParseHtmlArtifactFence,
} from './fence-parser.js';
export type { ParseArtifactFenceInput } from './fence-parser.js';
