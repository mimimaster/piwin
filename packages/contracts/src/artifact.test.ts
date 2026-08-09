import { describe, expect, it } from 'vitest';
import { DEFAULT_ARTIFACT_DECISION_PROMPT, NATIVE_SVG_ARTIFACT_LANGUAGES } from './artifact.js';

describe('SVG artifact contract', () => {
  it('declares the standard svg fence language', () => {
    expect(NATIVE_SVG_ARTIFACT_LANGUAGES).toEqual(['svg']);
  });
});

describe('default artifact decision prompt', () => {
  it('wraps the proactive decision policy in a metadata block', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '[piwin-prompt-meta kind="artifact:decision" version="3" applies="artifacts-enabled"]',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      '<artifact-decision-policy name="piwin-proactive-inline">',
    );
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('</artifact-decision-policy>');
  });

  it('treats dense reference content as a proactive artifact use case', () => {
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('information-dense response');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('command summary');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain('long wall of text');
    expect(DEFAULT_ARTIFACT_DECISION_PROMPT).toContain(
      'prefer an Artifact even when the user does not explicitly mention UI',
    );
  });
});
