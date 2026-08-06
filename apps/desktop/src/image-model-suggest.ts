/**
 * Image-model suggestion dropdown helpers.
 *
 * The matching/filtering logic lives in @piwin/contracts so the host can reuse
 * the exact same rules when auto-tagging discovered models during discovery.
 * This module re-exports the shared pieces to keep the desktop import surface
 * stable.
 */

export {
  splitModelName,
  matchImageCatalog,
  filterSuggestions,
} from '@piwin/contracts';
export type { SuggestionMatch, SuggestionResult } from '@piwin/contracts';
