import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from './skill-frontmatter.js';

describe('parseSkillFrontmatter', () => {
  it('parses flat key-value pairs and strips matching outer quotes', () => {
    const parsed = parseSkillFrontmatter(`---
name: my-skill
description: "Helpful skill: does things"
hidden: 'true'
---
# Body
`);
    expect(parsed).toEqual({
      name: 'my-skill',
      description: 'Helpful skill: does things',
      hidden: 'true',
    });
  });

  it('parses YAML folded block scalars (>- and >) without leaking colons', () => {
    const parsed = parseSkillFrontmatter(`---
name: aws-cdk
description: >-
  Guides AWS CDK infrastructure development.
  Use when: deploying AWS CDK stacks or debugging CloudFormation diffs.
version: 1.0.0
---
`);
    expect(parsed).toEqual({
      name: 'aws-cdk',
      description:
        'Guides AWS CDK infrastructure development. Use when: deploying AWS CDK stacks or debugging CloudFormation diffs.',
      version: '1.0.0',
    });

    const multiParagraph = parseSkillFrontmatter(`---
name: amazon-bedrock
description: >
  First paragraph line one
  line two.

  Second paragraph here.
---
`);
    expect(multiParagraph.description).toBe(
      'First paragraph line one line two.\n\nSecond paragraph here.',
    );
  });

  it('parses YAML literal block scalars (| and |-)', () => {
    const parsed = parseSkillFrontmatter(`---
name: literal-skill
description: |-
  Line 1
  Line 2
---
`);
    expect(parsed.description).toBe('Line 1\nLine 2');
  });

  it('ignores nested YAML lists/objects without corrupting subsequent keys', () => {
    const parsed = parseSkillFrontmatter(`---
name: nested-skill
tags:
  - aws
  - label: ignored
metadata:
  author: someone
description: Actual description
---
`);
    expect(parsed).toEqual({
      name: 'nested-skill',
      description: 'Actual description',
    });
  });
});
