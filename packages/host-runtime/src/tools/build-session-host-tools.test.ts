import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultArtifactConfig,
  KNOWLEDGE_TOOL_NAMES,
} from '@piwin/contracts';
import { createFolderRag } from '@piwin/doc-rag';
import { createNoteStore } from '@piwin/notes';
import { createDefaultPiwinConfig } from '../config-store.js';
import { buildSessionHostTools } from './build-session-host-tools.js';

describe('buildSessionHostTools artifact_instructions', () => {
  it('composes the tool when Artifact is enabled and omits it when disabled', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-artifact-compose-'));
    try {
      const enabled = await buildSessionHostTools({
        sessionId: 'session-test',
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
      });
      expect(enabled.some((tool) => tool.descriptor.name === ARTIFACT_INSTRUCTIONS_TOOL_NAME)).toBe(
        true,
      );

      const disabled = await buildSessionHostTools({
        sessionId: 'session-test',
        piwinRoot: rootDir,
        config: {
          ...createDefaultPiwinConfig(),
          artifact: { ...createDefaultArtifactConfig(), enabled: false },
        },
      });
      expect(
        disabled.some((tool) => tool.descriptor.name === ARTIFACT_INSTRUCTIONS_TOOL_NAME),
      ).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('registers knowledge_* tools and omits note_search/list/read', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-kb-compose-'));
    const rag = createFolderRag({ piwinRoot: rootDir });
    const store = createNoteStore({ piwinRoot: rootDir });
    try {
      const tools = await buildSessionHostTools({
        sessionId: 'session-kb',
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
        getFolderRag: async () => rag,
        getNotesServices: async () => ({ store }),
      });
      const names = tools.map((tool) => tool.descriptor.name);
      expect(names).toEqual(
        expect.arrayContaining([
          KNOWLEDGE_TOOL_NAMES.list,
          KNOWLEDGE_TOOL_NAMES.search,
          KNOWLEDGE_TOOL_NAMES.read,
          'note_write',
          'note_update',
          'note_delete',
        ]),
      );
      expect(names).not.toContain('note_search');
      expect(names).not.toContain('note_list');
      expect(names).not.toContain('note_read');
      expect(
        tools
          .filter((tool) =>
            (Object.values(KNOWLEDGE_TOOL_NAMES) as string[]).includes(tool.descriptor.name),
          )
          .every((tool) => tool.permissionSpec.readOnly === true),
      ).toBe(true);
    } finally {
      rag.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
