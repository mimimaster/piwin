import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARTIFACT_INSTRUCTIONS_TOOL_NAME, createDefaultArtifactConfig } from '@piwin/contracts';
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
});
