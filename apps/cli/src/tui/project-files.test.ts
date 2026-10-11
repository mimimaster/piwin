import type { HostCommand, HostResponse, ProjectDirEntry } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import { ProjectFiles } from './project-files.js';

const TREE: Record<string, ProjectDirEntry[]> = {
  '': [
    { name: 'src', relativePath: 'src', kind: 'directory' },
    { name: 'README.md', relativePath: 'README.md', kind: 'file' },
  ],
  src: [
    { name: 'a.ts', relativePath: 'src/a.ts', kind: 'file' },
    ...Array.from({ length: 20 }, (_, index) => ({
      name: `f${index}.ts`,
      relativePath: `src/f${index}.ts`,
      kind: 'file' as const,
    })),
  ],
};

function createFiles(scope: { projectId?: string } = { projectId: 'project-1' }) {
  const { projectId } = scope;
  const commands: HostCommand[] = [];
  let now = 0;
  const files = new ProjectFiles({
    getProjectId: () => projectId,
    now: () => now,
    request: async (command): Promise<HostResponse> => {
      commands.push(command);
      if (command.type === 'project/list-dir') {
        const entries = TREE[command.relativePath ?? ''];
        return entries === undefined
          ? { type: 'response', command: command.type, success: false, error: 'not a directory' }
          : { type: 'response', command: command.type, success: true, data: { entries } };
      }
      return { type: 'response', command: command.type, success: true, data: { matches: [{ relativePath: 'src/a.ts' }] } };
    },
  });
  return { files, commands, advance: (ms: number) => void (now += ms) };
}

describe('ProjectFiles', () => {
  it('addresses the project by id and caches a listing briefly', async () => {
    const { files, commands, advance } = createFiles();
    await files.listDirectory('src');
    await files.listDirectory('src');
    expect(commands).toEqual([{ type: 'project/list-dir', projectPath: 'project-1', relativePath: 'src' }]);
    advance(6_000);
    await files.listDirectory('src');
    expect(commands).toHaveLength(2);
  });

  it('resolves mentions to file and folder refs and leaves unknown ones as text', async () => {
    const { files } = createFiles();
    const resolved = await files.resolveMentions('看 @src/a.ts 和 @src/ 还有 @nope.ts 以及 @src/a.ts和别的');
    expect(resolved.refs).toEqual([
      { kind: 'file', projectPath: 'project-1', relativePath: 'src/a.ts', label: 'src/a.ts' },
      { kind: 'folder', projectPath: 'project-1', relativePath: 'src', label: 'src' },
    ]);
    expect(resolved.unresolved).toEqual(['nope.ts']);
  });

  it('stops at the protocol limit and says what was left out', async () => {
    const { files } = createFiles();
    const text = Array.from({ length: 20 }, (_, index) => `@src/f${index}.ts`).join(' ');
    const resolved = await files.resolveMentions(text);
    expect(resolved.refs).toHaveLength(16);
    expect(resolved.overLimit).toEqual(['src/f16.ts', 'src/f17.ts', 'src/f18.ts', 'src/f19.ts']);
  });

  it('resolves nothing and asks the Host nothing outside a project', async () => {
    const { files, commands } = createFiles({});
    expect(await files.resolveMentions('@src/a.ts')).toEqual({ refs: [], unresolved: [], overLimit: [] });
    expect(await files.listDirectory('')).toEqual([]);
    expect(commands).toEqual([]);
  });

  it('searches the whole project by fragment through a walk of Host listings', async () => {
    const { files, commands } = createFiles();
    const found = await files.search('f1', 3);
    expect(found.map((entry) => entry.relativePath)).toEqual(['src/f1.ts', 'src/f10.ts', 'src/f11.ts']);
    const listed = commands.filter((command) => command.type === 'project/list-dir');
    expect(listed).toHaveLength(2);
    await files.search('a.ts', 3);
    expect(commands.filter((command) => command.type === 'project/list-dir')).toHaveLength(2);
  });

  it('finds a file by name anywhere in the project', async () => {
    const { files } = createFiles();
    expect(await files.findByName('a.ts')).toEqual([{ name: 'a.ts', relativePath: 'src/a.ts', kind: 'file' }]);
  });
});
