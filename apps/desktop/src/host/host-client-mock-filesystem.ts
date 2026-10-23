import type { HostCommand, HostDirEntry, HostResponse } from '@piwin/contracts';
import { isValidHostEntryName } from '@piwin/contracts';

/** Each preview Host owns its own in-memory file picker entries. */
export class MockHostFileSystem {
  private readonly homePath = '/Users/mock';
  private readonly directories = new Map<string, HostDirEntry[]>();

  constructor() {
    this.directories.set(this.homePath, [
      ...[
        'Applications',
        'Desktop',
        'Developer',
        'Documents',
        'Downloads',
        'Projects',
        '.piwin',
      ].map((name): HostDirEntry => ({
        name,
        kind: 'directory',
        path: `${this.homePath}/${name}`,
      })),
    ]);
    this.directories.set(`${this.homePath}/Developer`, [
      { name: 'piwin', kind: 'directory', path: `${this.homePath}/Developer/piwin` },
      { name: 'notes.md', kind: 'file', path: `${this.homePath}/Developer/notes.md` },
    ]);
    this.directories.set(`${this.homePath}/.piwin`, [
      { name: 'search.mjs', kind: 'file', path: `${this.homePath}/.piwin/search.mjs` },
    ]);
  }

  handle(command: HostCommand, id: string): HostResponse | null {
    if (command.type === 'host/list-dir') {
      const current = command.path?.trim() || this.homePath;
      const entries = this.directories.get(current) ?? [];
      // Unknown preview workspace paths remain browsable, matching existing fixtures.
      this.directories.set(current, entries);
      return {
        id,
        type: 'response',
        command: command.type,
        success: true,
        data: {
          path: current,
          parentPath: current === '/' ? null : current.slice(0, current.lastIndexOf('/')) || '/',
          homePath: this.homePath,
          entries: entries.filter((entry) => command.includeHidden || !entry.name.startsWith('.')),
        },
      };
    }
    if (command.type !== 'host/create-entry') return null;
    const { parentPath, name, kind } = command.input;
    if (!isValidHostEntryName(name, 'posix') || (kind !== 'directory' && kind !== 'file')) {
      return this.fail(id, 'host-entry-invalid-name', 'Enter a valid name.');
    }
    const entries = this.directories.get(parentPath);
    if (!entries)
      return this.fail(id, 'host-entry-not-directory', 'The parent folder does not exist.');
    if (entries.some((entry) => entry.name === name)) {
      return this.fail(
        id,
        'host-entry-already-exists',
        'A file or folder with this name already exists.',
      );
    }
    const entry: HostDirEntry = {
      name,
      kind,
      path: `${parentPath === '/' ? '' : parentPath}/${name}`,
    };
    entries.push(entry);
    if (kind === 'directory') this.directories.set(entry.path, []);
    return { id, type: 'response', command: command.type, success: true, data: entry };
  }

  private fail(id: string, code: string, error: string): HostResponse {
    return {
      id,
      type: 'response',
      command: 'host/create-entry',
      success: false,
      error,
      problem: { code },
    };
  }
}
