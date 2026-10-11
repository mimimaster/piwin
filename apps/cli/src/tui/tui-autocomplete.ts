import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  CombinedAutocompleteProvider,
} from '@earendil-works/pi-tui';
import type { ProjectDirEntry } from '@piwin/contracts';
import { findMentionAtCursor, mentionCompletionValue, rankDirEntries } from './file-mentions.js';
import type { ProjectFiles } from './project-files.js';

/** Below this, a project-wide search would match half the project. */
const NAME_SEARCH_MIN_CHARS = 2;
const DEEP_SUGGESTION_LIMIT = 30;

type Lines = string[];
type SuggestionOptions = { signal: AbortSignal; force?: boolean };

/**
 * Composer completion: `@` completes project files from the Host's listing,
 * everything else (slash commands, local paths for `/image`) is pi-tui's own.
 */
export class TuiAutocompleteProvider implements AutocompleteProvider {
  public readonly triggerCharacters = ['@'];

  public constructor(
    private readonly builtin: CombinedAutocompleteProvider,
    private readonly files: ProjectFiles,
  ) {}

  public async getSuggestions(
    lines: Lines,
    cursorLine: number,
    cursorCol: number,
    options: SuggestionOptions,
  ): Promise<AutocompleteSuggestions | null> {
    const beforeCursor = (lines[cursorLine] ?? '').slice(0, cursorCol);
    const mention = findMentionAtCursor(beforeCursor);
    if (mention === undefined) return this.builtin.getSuggestions(lines, cursorLine, cursorCol, options);
    // Outside a project there is nothing a mention could point at.
    if (!this.files.hasProject()) return null;

    const entries = rankDirEntries(await this.files.listDirectory(mention.directory), mention.namePart);
    // A bare fragment also searches the whole project, not just the root.
    if (mention.directory === '' && mention.namePart.length >= NAME_SEARCH_MIN_CHARS) {
      const deeper = [
        ...(await this.files.search(mention.namePart, DEEP_SUGGESTION_LIMIT)),
        // The index is capped; an exact file name still reaches past the cap.
        ...(await this.files.findByName(mention.namePart)),
      ];
      for (const found of deeper) {
        if (!entries.some((entry) => entry.relativePath === found.relativePath)) entries.push(found);
      }
    }
    if (options.signal.aborted || entries.length === 0) return null;
    return { prefix: mention.prefix, items: entries.map(toItem) };
  }

  public applyCompletion(
    lines: Lines,
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: Lines; cursorLine: number; cursorCol: number } {
    // pi-tui already knows how to splice an `@` completion, quotes included.
    return this.builtin.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  public shouldTriggerFileCompletion(lines: Lines, cursorLine: number, cursorCol: number): boolean {
    return this.builtin.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
  }
}

function toItem(entry: ProjectDirEntry): AutocompleteItem {
  return {
    value: mentionCompletionValue(entry.relativePath, entry.kind),
    // The trailing slash is how pi-tui tells a directory completion from a file.
    label: entry.kind === 'directory' ? `${entry.name}/` : entry.name,
    description: entry.relativePath,
  };
}
