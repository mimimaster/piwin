/**
 * Tests for host-filesystem-tools: verifies the Host-owned fs/bash tools
 * are correctly composed with permission gates.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildHostFilesystemTools } from './host-filesystem-tools.js';

describe('buildHostFilesystemTools', () => {
  it('returns 5 tools: read_file, write_file, list_directory, bash, run_bash', () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['bash', 'list_directory', 'read_file', 'run_bash', 'write_file']);
  });

  it('read_file executes without permission gate', async () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const readFileTool = tools.find((t) => t.name === 'read_file');
    expect(readFileTool).toBeDefined();

    // Write a temp file then read it
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const tmpPath = join('/tmp', `piwin-test-${Date.now()}.txt`);
    await writeFile(tmpPath, 'hello world', 'utf-8');

    const result = await readFileTool!.execute({ path: tmpPath });
    expect(result).toBe('hello world');

    // Cleanup
    const { unlink } = await import('node:fs/promises');
    await unlink(tmpPath);
  });

  it('write_file gates through evaluateFileWritePermission', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
      requestPermission,
    });
    const writeFileTool = tools.find((t) => t.name === 'write_file');
    expect(writeFileTool).toBeDefined();

    const tmpPath = `piwin-test-write-${Date.now()}.txt`;
    const result = await writeFileTool!.execute({ path: tmpPath, content: 'test' });
    expect(result).toContain('Wrote');

    // Cleanup
    const { unlink } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    await unlink(resolve('/tmp', tmpPath));
  });

  it('bash gates through evaluateBashPermission', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
      requestPermission,
    });
    const bashTool = tools.find((t) => t.name === 'bash');
    expect(bashTool).toBeDefined();

    const result = await bashTool!.execute({ command: 'echo hello' });
    expect(result.trim()).toBe('hello');
  });

  it('bash denies destructive commands without permission gate', async () => {
    const tools = buildHostFilesystemTools({
      cwd: '/tmp',
      // No requestPermission — ask → deny in non-interactive mode
    });
    const bashTool = tools.find((t) => t.name === 'bash');

    // rm -rf / is denied by bundled rules (hard deny)
    await expect(bashTool!.execute({ command: 'rm -rf /' })).rejects.toThrow(
      /piwin blocked bash/,
    );
  });

  it('list_directory returns entries with kind', async () => {
    const tools = buildHostFilesystemTools({ cwd: '/tmp' });
    const listTool = tools.find((t) => t.name === 'list_directory');
    expect(listTool).toBeDefined();

    const result = await listTool!.execute({ path: '/tmp' });
    const entries = JSON.parse(result);
    expect(Array.isArray(entries)).toBe(true);
    for (const entry of entries) {
      expect(entry.kind).toMatch(/^(file|directory)$/);
    }
  });
});
