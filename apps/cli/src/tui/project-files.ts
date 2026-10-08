import type {
  HostCommand,
  HostResponse,
  ProjectDirEntry,
  ProjectListDirData,
  PromptContextRef,
} from '@piwin/contracts';
import { extractMentionPaths, mentionWithoutTrailingProse, rankIndexedEntries } from './file-mentions.js';

const LISTING_TTL_MS = 5_000;
/** The remote protocol accepts at most 16 context refs per prompt. */
const MAX_CONTEXT_REFS = 16;
/**
 * The Host can list a directory and find an exact file name, but has no
 * fuzzy search. The index is a bounded walk of its listings, so a large
 * repository costs a fixed number of requests and deep files beyond the cap
 * are simply not suggested (typing the directory still completes them).
 */
const INDEX_MAX_DIRECTORIES = 300;
const INDEX_MAX_ENTRIES = 5_000;
const INDEX_CONCURRENCY = 6;
const INDEX_TTL_MS = 60_000;
/** A completion popup waits this long for a cold index before showing what it has. */
const INDEX_WAIT_MS = 400;

type ProjectIndex = { projectId: string; at: number; entries: ProjectDirEntry[]; done: Promise<void> };

export type ProjectFilesOptions = {
  request: (command: HostCommand) => Promise<HostResponse>;
  /** Project of the session being composed for; absent in the general workspace. */
  getProjectId: () => string | undefined;
  now?: () => number;
};

export type ResolvedMentions = {
  refs: PromptContextRef[];
  /** Mentions that named nothing in the project; they stay plain text. */
  unresolved: string[];
  /** Mentions dropped because the prompt already carries the maximum. */
  overLimit: string[];
};

/**
 * Project files as the Host sees them. The TUI never reads the project from
 * its own disk: it may be attached to a Host on another machine, and the Host
 * owns which paths are inside the project.
 */
export class ProjectFiles {
  private readonly listings = new Map<string, { at: number; entries: Promise<ProjectDirEntry[]> }>();
  private index: ProjectIndex | undefined;

  public constructor(private readonly options: ProjectFilesOptions) {}

  public hasProject(): boolean {
    return this.options.getProjectId() !== undefined;
  }

  /** Entries of a project directory; a missing directory lists as empty. */
  public listDirectory(relativePath: string): Promise<ProjectDirEntry[]> {
    const projectId = this.options.getProjectId();
    if (projectId === undefined) return Promise.resolve([]);
    const now = (this.options.now ?? Date.now)();
    const key = `${projectId}\n${relativePath}`;
    const cached = this.listings.get(key);
    if (cached !== undefined && now - cached.at < LISTING_TTL_MS) return cached.entries;
    const entries = this.options
      .request({
        type: 'project/list-dir',
        projectPath: projectId,
        ...(relativePath.length === 0 ? {} : { relativePath }),
      })
      .then((response) => (response.success ? ((response.data as ProjectListDirData).entries ?? []) : []));
    this.listings.set(key, { at: now, entries });
    // A transport failure must not be served from cache for the next five seconds.
    entries.catch(() => this.listings.delete(key));
    return entries;
  }

  /**
   * Files and folders anywhere in the project whose path contains `fragment`.
   * Returns what the index holds after a short wait; a first call on a big
   * project may be partial and fills in as the walk continues.
   */
  public async search(fragment: string, limit: number): Promise<ProjectDirEntry[]> {
    const index = this.ensureIndex();
    if (index === undefined) return [];
    await Promise.race([index.done, new Promise((resolve) => setTimeout(resolve, INDEX_WAIT_MS))]);
    return rankIndexedEntries(index.entries, fragment, limit);
  }

  private ensureIndex(): ProjectIndex | undefined {
    const projectId = this.options.getProjectId();
    if (projectId === undefined) return undefined;
    const now = (this.options.now ?? Date.now)();
    const current = this.index;
    if (current !== undefined && current.projectId === projectId && now - current.at < INDEX_TTL_MS) {
      return current;
    }
    const entries: ProjectDirEntry[] = [];
    const index: ProjectIndex = { projectId, at: now, entries, done: this.walk(entries) };
    this.index = index;
    return index;
  }

  /** Breadth-first, so the shallow files people mention most are indexed first. */
  private async walk(entries: ProjectDirEntry[]): Promise<void> {
    let frontier = [''];
    let visited = 0;
    while (frontier.length > 0 && visited < INDEX_MAX_DIRECTORIES && entries.length < INDEX_MAX_ENTRIES) {
      const batch = frontier.splice(0, Math.min(INDEX_CONCURRENCY, INDEX_MAX_DIRECTORIES - visited));
      visited += batch.length;
      const listings = await Promise.all(
        // One unreadable directory must not end the walk.
        batch.map((directory) => this.listDirectory(directory).catch((): ProjectDirEntry[] => [])),
      );
      for (const entry of listings.flat()) {
        if (entries.length >= INDEX_MAX_ENTRIES) break;
        entries.push(entry);
        if (entry.kind === 'directory') frontier.push(entry.relativePath);
      }
    }
  }

  /** Files anywhere in the project whose name is exactly `fileName`. */
  public async findByName(fileName: string): Promise<ProjectDirEntry[]> {
    const projectId = this.options.getProjectId();
    if (projectId === undefined || fileName.length === 0) return [];
    const response = await this.options.request({
      type: 'project/find-file',
      projectPath: projectId,
      query: fileName,
      maxMatches: 20,
    });
    if (!response.success) return [];
    const matches = (response.data as { matches?: Array<{ relativePath: string }> }).matches ?? [];
    return matches.map((match) => ({
      name: match.relativePath.split('/').pop() ?? match.relativePath,
      relativePath: match.relativePath,
      kind: 'file' as const,
    }));
  }

  /** Turn the `@path` mentions of a message into context refs the Host will read. */
  public async resolveMentions(text: string): Promise<ResolvedMentions> {
    const result: ResolvedMentions = { refs: [], unresolved: [], overLimit: [] };
    const projectId = this.options.getProjectId();
    if (projectId === undefined) return result;
    for (const path of extractMentionPaths(text)) {
      const fallback = mentionWithoutTrailingProse(path);
      const entry =
        (await this.lookUp(path)) ?? (fallback === undefined ? undefined : await this.lookUp(fallback));
      if (entry === undefined) {
        result.unresolved.push(path);
      } else if (result.refs.some((ref) => 'relativePath' in ref && ref.relativePath === entry.relativePath)) {
        continue;
      } else if (result.refs.length >= MAX_CONTEXT_REFS) {
        result.overLimit.push(entry.relativePath);
      } else {
        result.refs.push({
          kind: entry.kind === 'directory' ? 'folder' : 'file',
          projectPath: projectId,
          relativePath: entry.relativePath,
          label: entry.relativePath,
        });
      }
    }
    return result;
  }

  private async lookUp(relativePath: string): Promise<ProjectDirEntry | undefined> {
    const slash = relativePath.lastIndexOf('/');
    const entries = await this.listDirectory(slash === -1 ? '' : relativePath.slice(0, slash));
    return entries.find((entry) => entry.relativePath === relativePath);
  }
}
