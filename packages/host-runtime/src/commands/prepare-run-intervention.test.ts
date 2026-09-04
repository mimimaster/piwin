import { describe, expect, it } from 'vitest';
import {
  instructionPayloadFromPromptInput,
  sameInstructionPayload,
  validateRunInterventionInput,
} from './prepare-run-intervention.js';

describe('prepare-run-intervention helpers', () => {
  it('accepts context refs and attachments without treating them as unsupported', () => {
    expect(
      validateRunInterventionInput({
        text: 'use this quote',
        contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
      }),
    ).toBeUndefined();
    expect(
      validateRunInterventionInput({
        text: 'see the screenshot',
        attachments: [
          {
            id: 'att-1',
            kind: 'media',
            path: '/tmp/media/shot.png',
            mimeType: 'image/png',
            byteSize: 12,
            source: 'paste',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('still rejects slash commands and empty payloads', () => {
    expect(validateRunInterventionInput({ text: '/compact' })).toMatch(
      /intervention-command-unsupported/,
    );
    expect(validateRunInterventionInput({ text: '   ' })).toMatch(/intervention-empty/);
  });

  it('compares frozen queued payloads including attachments and refs', () => {
    const queued = instructionPayloadFromPromptInput({
      text: 'adjust mapping',
      contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
    });
    expect(
      sameInstructionPayload(queued, {
        text: 'adjust mapping',
        contextRefs: [{ kind: 'selection', snapshotText: 'quoted', label: 'quoted' }],
      }),
    ).toBe(true);
    expect(sameInstructionPayload(queued, { text: 'adjust mapping' })).toBe(false);
  });
});
