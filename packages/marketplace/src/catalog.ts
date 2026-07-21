/** Static recommended sources — not a remote marketplace. */

export type RecommendedSkill = {
  id: string;
  name: string;
  description: string;
  source: { kind: 'git'; url: string; subdir?: string };
};

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: 'anthropic-skill-creator',
    name: 'skill-creator',
    description: 'Anthropics public skill-creator template (git)',
    source: {
      kind: 'git',
      url: 'https://github.com/anthropics/skills.git',
      subdir: 'skills/skill-creator',
    },
  },
];
