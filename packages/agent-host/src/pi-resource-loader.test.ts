import { describe, expect, it } from 'vitest';
import { collectSkillPaths } from './pi-resource-loader.js';

describe('collectSkillPaths', () => {
  it('includes piwin skills, project roots, and extras without duplicates', () => {
    const paths = collectSkillPaths({
      piwinRoot: '/tmp/piwin-root',
      projectPath: '/tmp/proj',
      extraSkillPaths: ['/tmp/mapped', '/tmp/piwin-root/skills'],
    });
    expect(paths[0]).toBe('/tmp/piwin-root/skills');
    expect(paths).toContain('/tmp/proj/.pi/skills');
    expect(paths).toContain('/tmp/proj/.agents/skills');
    expect(paths).toContain('/tmp/mapped');
    expect(paths.filter((path) => path === '/tmp/piwin-root/skills')).toHaveLength(1);
  });
});
