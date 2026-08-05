import { describe, expect, it } from 'vitest';
import type { ResolvedContextFile } from '@piwin/contracts';
import {
  classifyContextFile,
  contextFileSource,
  resolveContextManifest,
  type ContextCandidatesInput,
} from './context-policy-resolver.js';

function file(
  path: string,
  kind: ResolvedContextFile['kind'],
  source: ResolvedContextFile['source'],
) {
  return { kind, source, absolutePath: path };
}

function candidates(overrides: Partial<ContextCandidatesInput> = {}): ContextCandidatesInput {
  return {
    projectAgentsFiles: [],
    projectSystemPrompts: [],
    piNativeFiles: [],
    ...overrides,
  };
}

describe('resolveContextManifest', () => {
  it('disabled project AGENTS files are absent from the manifest', () => {
    const manifest = resolveContextManifest(
      {
        allowPiNativeInstructions: true,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: true,
      },
      candidates({
        projectAgentsFiles: [file('/p/AGENTS.md', 'agents', 'project')],
        projectSystemPrompts: [file('/p/SYSTEM.md', 'system', 'project')],
        piNativeFiles: [file('/home/.pi/agent/SYSTEM.md', 'system', 'pi-native')],
      }),
    );
    expect(manifest.agentsFiles).toEqual([
      file('/home/.pi/agent/SYSTEM.md', 'system', 'pi-native'),
    ]);
    expect(manifest.systemPrompt?.absolutePath).toBe('/p/SYSTEM.md');
  });

  it('disabled project SYSTEM/APPEND_SYSTEM are absent', () => {
    const manifest = resolveContextManifest(
      {
        allowPiNativeInstructions: false,
        allowProjectAgentsFiles: true,
        allowProjectSystemPrompts: false,
      },
      candidates({
        projectAgentsFiles: [file('/p/AGENTS.md', 'agents', 'project')],
        projectSystemPrompts: [
          file('/p/SYSTEM.md', 'system', 'project'),
          file('/p/APPEND_SYSTEM.md', 'append-system', 'project'),
        ],
      }),
    );
    expect(manifest.agentsFiles).toEqual([file('/p/AGENTS.md', 'agents', 'project')]);
    expect(manifest.systemPrompt).toBeUndefined();
    expect(manifest.appendSystemPrompt).toBeUndefined();
  });

  it('Pi-native instructions switch excludes global instruction files', () => {
    const manifest = resolveContextManifest(
      {
        allowPiNativeInstructions: false,
        allowProjectAgentsFiles: true,
        allowProjectSystemPrompts: false,
      },
      candidates({
        projectAgentsFiles: [],
        piNativeFiles: [file('/home/.pi/agent/SYSTEM.md', 'system', 'pi-native')],
      }),
    );
    expect(manifest.agentsFiles).toEqual([]);
  });

  it('routes system and append-system to their dedicated fields', () => {
    const manifest = resolveContextManifest(
      {
        allowPiNativeInstructions: false,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: true,
      },
      candidates({
        projectSystemPrompts: [
          file('/p/SYSTEM.md', 'system', 'project'),
          file('/p/APPEND_SYSTEM.md', 'append-system', 'project'),
        ],
      }),
    );
    expect(manifest.systemPrompt?.absolutePath).toBe('/p/SYSTEM.md');
    expect(manifest.appendSystemPrompt?.absolutePath).toBe('/p/APPEND_SYSTEM.md');
    expect(manifest.agentsFiles).toEqual([]);
  });

  it('does not discover context outside the explicit manifest (SCR-16)', () => {
    const manifest = resolveContextManifest(
      {
        allowPiNativeInstructions: false,
        allowProjectAgentsFiles: false,
        allowProjectSystemPrompts: false,
      },
      candidates({
        projectAgentsFiles: [file('/p/AGENTS.md', 'agents', 'project')],
        projectSystemPrompts: [file('/p/SYSTEM.md', 'system', 'project')],
        piNativeFiles: [file('/home/.pi/agent/SYSTEM.md', 'system', 'pi-native')],
      }),
    );
    expect(manifest.agentsFiles).toEqual([]);
    expect(manifest.systemPrompt).toBeUndefined();
    expect(manifest.appendSystemPrompt).toBeUndefined();
  });
});

describe('context file helpers', () => {
  it('classifies known filenames', () => {
    expect(classifyContextFile('/p/AGENTS.md')).toBe('agents');
    expect(classifyContextFile('/p/CLAUDE.md')).toBe('claude');
    expect(classifyContextFile('/p/SYSTEM.md')).toBe('system');
    expect(classifyContextFile('/p/APPEND_SYSTEM.md')).toBe('append-system');
    expect(classifyContextFile('/p/README.md')).toBeNull();
  });

  it('distinguishes project vs pi-native by root', () => {
    expect(contextFileSource('/p/AGENTS.md', '/p')).toBe('project');
    expect(contextFileSource('/home/.pi/agent/SYSTEM.md', '/p')).toBe('pi-native');
  });
});
