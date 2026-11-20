import { describe, expect, it } from 'vitest';
import {
  isPresetSkillPath,
  nextSkillsConfigForExcludedIds,
  nextSkillsConfigForMapping,
  shortSkillPathLabel,
} from './skill-path-mapping.js';

describe('nextSkillsConfigForMapping', () => {
  it('adds a path and keeps disabled and excluded ids', () => {
    expect(
      nextSkillsConfigForMapping(
        { extraPaths: ['/a'], disabledIds: ['x'], excludedIds: ['aws-cdk'] },
        '~/.claude/skills',
        true,
      ),
    ).toEqual({
      extraPaths: ['/a', '~/.claude/skills'],
      disabledIds: ['x'],
      excludedIds: ['aws-cdk'],
    });
  });

  it('removes a mapped path', () => {
    expect(
      nextSkillsConfigForMapping({ extraPaths: ['/a', '/b'], disabledIds: [] }, '/a', false),
    ).toEqual({ extraPaths: ['/b'], disabledIds: [] });
  });

  it('returns undefined when nothing changes', () => {
    expect(
      nextSkillsConfigForMapping({ extraPaths: ['/a'], disabledIds: [] }, '/a', true),
    ).toBeUndefined();
    expect(nextSkillsConfigForMapping(undefined, '/a', false)).toBeUndefined();
  });
});

describe('nextSkillsConfigForExcludedIds', () => {
  it('adds single and batch excluded ids without duplicates', () => {
    expect(
      nextSkillsConfigForExcludedIds(
        { extraPaths: ['~/.claude/skills'], disabledIds: ['aws-cdk'] },
        ['aws-cdk', 'amazon-bedrock', 'AWS-CDK'],
        true,
      ),
    ).toEqual({
      extraPaths: ['~/.claude/skills'],
      disabledIds: ['aws-cdk'],
      excludedIds: ['aws-cdk', 'amazon-bedrock'],
    });

    expect(
      nextSkillsConfigForExcludedIds(
        { extraPaths: ['~/.claude/skills'], disabledIds: [], excludedIds: ['aws-cdk'] },
        ['aws-cdk'],
        true,
      ),
    ).toBeUndefined();
  });

  it('restores single or all excluded ids case-insensitively', () => {
    expect(
      nextSkillsConfigForExcludedIds(
        { extraPaths: ['~/.claude/skills'], disabledIds: [], excludedIds: ['aws-cdk', 'aws-auth'] },
        ['AWS-CDK'],
        false,
      ),
    ).toEqual({
      extraPaths: ['~/.claude/skills'],
      disabledIds: [],
      excludedIds: ['aws-auth'],
    });

    expect(
      nextSkillsConfigForExcludedIds(
        { extraPaths: ['~/.claude/skills'], disabledIds: [], excludedIds: ['aws-auth'] },
        ['aws-auth'],
        false,
      ),
    ).toEqual({
      extraPaths: ['~/.claude/skills'],
      disabledIds: [],
    });
  });
});

describe('skill path label helpers', () => {
  it('detects preset paths and falls back to raw custom paths', () => {
    expect(isPresetSkillPath('~/.claude/skills')).toBe(true);
    expect(isPresetSkillPath('/tmp/custom-skills')).toBe(false);
    expect(shortSkillPathLabel('~/.claude/skills')).toBe('Claude skills');
    expect(shortSkillPathLabel('/tmp/custom-skills')).toBe('/tmp/custom-skills');
  });
});
