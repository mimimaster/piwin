import { describe, expect, it } from 'vitest';
import type { ResourceCatalogEntry, ToolPresentation } from '@piwin/contracts';
import {
  buildDocumentTargetsForPath,
  enrichAgentEventDocumentTargets,
  enrichToolPresentationDocumentTargets,
  extractSkillIdFromPath,
} from './document-targets.js';

const skillEntry = (partial: Partial<ResourceCatalogEntry> & Pick<ResourceCatalogEntry, 'resourceId' | 'path'>): ResourceCatalogEntry => ({
  kind: 'skill',
  name: partial.name ?? partial.resourceId,
  source: partial.source ?? 'user',
  ...partial,
});

describe('extractSkillIdFromPath', () => {
  it('extracts executing-plans from bundle path', () => {
    expect(
      extractSkillIdFromPath(
        '/Applications/piwinwin.app/Contents/Resources/host/skills/executing-plans/SKILL.md',
      ),
    ).toBe('executing-plans');
  });
});

describe('buildDocumentTargetsForPath', () => {
  it('maps skill catalog path to skill ref', () => {
    const targets = buildDocumentTargetsForPath(
      '/Users/me/.piwin/skills/executing-plans/SKILL.md',
      {
        skillEntries: [
          skillEntry({
            resourceId: 'executing-plans',
            path: '/Users/me/.piwin/skills/executing-plans',
            source: 'user',
          }),
        ],
      },
    );
    expect(targets).toEqual([
      {
        kind: 'skill',
        skillId: 'executing-plans',
        displayRef: 'skill:executing-plans',
        effectiveSource: 'user',
      },
    ]);
  });

  it('maps project absolute path to project-file relative ref', () => {
    const targets = buildDocumentTargetsForPath('/workspace/docs/plan.md', {
      projectPath: '/workspace',
    });
    expect(targets).toEqual([
      {
        kind: 'project-file',
        relativePath: 'docs/plan.md',
        displayRef: 'docs/plan.md',
      },
    ]);
  });

  it('maps bundle path without catalog via id extraction', () => {
    const targets = buildDocumentTargetsForPath(
      '/Applications/x.app/Contents/Resources/host/skills/writing-plans/SKILL.md',
      {},
    );
    expect(targets[0]).toMatchObject({
      kind: 'skill',
      skillId: 'writing-plans',
      displayRef: 'skill:writing-plans',
    });
  });
});

describe('enrichToolPresentationDocumentTargets', () => {
  it('adds documentTargets and leaves targetPaths unchanged', () => {
    const presentation: ToolPresentation = {
      kind: 'filesystem',
      title: 'Read',
      targetPaths: [
        '/Applications/x/Contents/Resources/host/skills/executing-plans/SKILL.md',
      ],
    };
    const enriched = enrichToolPresentationDocumentTargets(presentation, {
      projectPath: '/workspace',
    });
    expect(enriched.targetPaths).toEqual(presentation.targetPaths);
    expect(enriched.documentTargets).toEqual([
      {
        kind: 'skill',
        skillId: 'executing-plans',
        displayRef: 'skill:executing-plans',
      },
    ]);
  });

  it('does not overwrite existing documentTargets', () => {
    const presentation: ToolPresentation = {
      kind: 'filesystem',
      title: 'Read',
      targetPaths: ['/workspace/a.md'],
      documentTargets: [
        { kind: 'project-file', relativePath: 'a.md', displayRef: 'a.md' },
      ],
    };
    const enriched = enrichToolPresentationDocumentTargets(presentation, {
      projectPath: '/workspace',
    });
    expect(enriched).toBe(presentation);
  });
});

describe('enrichAgentEventDocumentTargets', () => {
  it('enriches tool/start presentation', () => {
    const event = enrichAgentEventDocumentTargets(
      {
        type: 'tool/start',
        toolCallId: 't1',
        toolName: 'read',
        presentation: {
          kind: 'filesystem',
          title: 'Read',
          targetPaths: ['/workspace/README.md'],
        },
      },
      { projectPath: '/workspace' },
    );
    expect(event.type).toBe('tool/start');
    if (event.type === 'tool/start') {
      expect(event.presentation?.documentTargets?.[0]).toMatchObject({
        kind: 'project-file',
        relativePath: 'README.md',
      });
    }
  });
});
