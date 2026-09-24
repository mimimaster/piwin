import { homedir } from 'node:os';
import { join } from 'node:path';
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

describe('buildDocumentTargetsForPath media vault dispatch', () => {
  it('emits a logical media target for vault asset paths', () => {
    const targets = buildDocumentTargetsForPath(
      '/Users/t/.piwin/media/sess-1/0b1c2d3e-4f5a-6789-abcd-ef0123456789.png',
      { projectPath: '/Users/t/project' },
    );
    expect(targets).toEqual([
      {
        kind: 'media',
        sessionId: 'sess-1',
        assetId: '0b1c2d3e-4f5a-6789-abcd-ef0123456789',
        displayRef: '0b1c2d3e-4f5a-6789-abcd-ef0123456789.png',
      },
    ]);
  });

  it('never emits media targets for traversal-shaped vault paths', () => {
    expect(
      buildDocumentTargetsForPath('/Users/t/.piwin/media/../secret/id_rsa', {
        projectPath: null,
      }),
    ).toEqual([]);
  });
});

describe('buildDocumentTargetsForPath trusted-config dispatch', () => {
  it('emits a relative trusted-config target for config-root text', () => {
    const targets = buildDocumentTargetsForPath('/Users/t/.piwin/config.json', {
      piwinRoot: '/Users/t/.piwin',
    });
    expect(targets).toEqual([
      {
        kind: 'trusted-config',
        relativePath: 'config.json',
        displayRef: '~/.piwin/config.json',
      },
    ]);
  });

  it('emits trusted-config for a home-relative config path', () => {
    expect(
      buildDocumentTargetsForPath('~/.piwin/pi-agent/auth.json', { piwinRoot: '~/.piwin' }),
    ).toEqual([
      {
        kind: 'trusted-config',
        relativePath: 'pi-agent/auth.json',
        displayRef: '~/.piwin/pi-agent/auth.json',
      },
    ]);
    // An expanded root and a `~` path name the same store in either direction.
    expect(
      buildDocumentTargetsForPath(join(homedir(), '.piwin/pi-agent/auth.json'), {
        piwinRoot: '~/.piwin',
      }),
    ).toMatchObject([{ kind: 'trusted-config', relativePath: 'pi-agent/auth.json' }]);
    expect(
      buildDocumentTargetsForPath('~/.piwin/pi-agent/auth.json', {
        piwinRoot: join(homedir(), '.piwin'),
      }),
    ).toMatchObject([{ kind: 'trusted-config', relativePath: 'pi-agent/auth.json' }]);
  });

  it('never claims another config store for this Host root', () => {
    const testRoot = join(homedir(), '.piwin-test');
    expect(buildDocumentTargetsForPath('~/.piwin/pi-agent/auth.json', { piwinRoot: testRoot })).toEqual([]);
    expect(
      buildDocumentTargetsForPath('/Users/someone-else/.piwin/config.json', { piwinRoot: '~/.piwin' }),
    ).toEqual([]);
    expect(
      buildDocumentTargetsForPath('~/.piwin-test/pi-agent/auth.json', { piwinRoot: testRoot }),
    ).toEqual([
      {
        kind: 'trusted-config',
        relativePath: 'pi-agent/auth.json',
        displayRef: '~/.piwin-test/pi-agent/auth.json',
      },
    ]);
  });

  it('never maps a home path outside the config store to a project file', () => {
    expect(
      buildDocumentTargetsForPath('~/notes/plan.md', {
        projectPath: '/workspace',
        piwinRoot: '~/.piwin',
      }),
    ).toEqual([]);
  });

  it('does not emit trusted-config for media vault or project files', () => {
    expect(
      buildDocumentTargetsForPath('/Users/t/.piwin/media/sess-1/a.png', {
        piwinRoot: '/Users/t/.piwin',
      }),
    ).toMatchObject([{ kind: 'media' }]);
    expect(
      buildDocumentTargetsForPath('/workspace/docs/plan.md', {
        projectPath: '/workspace',
        piwinRoot: '/Users/t/.piwin',
      }),
    ).toMatchObject([{ kind: 'project-file' }]);
  });
});
