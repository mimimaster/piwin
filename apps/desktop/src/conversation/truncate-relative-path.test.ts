import { describe, expect, it } from 'vitest';
import {
  formatDisplayPathParts,
  getRelativeFilePath,
  resolveChangeStatusInfo,
} from './truncate-relative-path';

describe('truncate-relative-path', () => {
  describe('getRelativeFilePath', () => {
    it('returns empty string for empty input', () => {
      expect(getRelativeFilePath('')).toBe('');
    });

    it('normalizes backslashes', () => {
      expect(getRelativeFilePath('apps\\cli\\src\\main.ts')).toBe('apps/cli/src/main.ts');
    });

    it('strips projectPath prefix correctly', () => {
      const full = '/Volumes/BigDisk/Projects/piwin/apps/cli/src/attach.test.ts';
      const project = '/Volumes/BigDisk/Projects/piwin';
      expect(getRelativeFilePath(full, project)).toBe('apps/cli/src/attach.test.ts');
    });

    it('handles trailing slash on projectPath', () => {
      const full = '/Volumes/BigDisk/Projects/piwin/apps/cli/src/attach.test.ts';
      const project = '/Volumes/BigDisk/Projects/piwin/';
      expect(getRelativeFilePath(full, project)).toBe('apps/cli/src/attach.test.ts');
    });

    it('returns dot if path matches project path exactly', () => {
      expect(getRelativeFilePath('/workspace', '/workspace')).toBe('.');
    });

    it('returns relative path unchanged if projectPath does not match', () => {
      expect(getRelativeFilePath('src/index.ts', '/other/project')).toBe('src/index.ts');
    });
  });

  describe('formatDisplayPathParts', () => {
    it('splits directory and filename for nested paths', () => {
      const full = '/project/root/apps/desktop/src/goal/GoalRunControl.tsx';
      const parts = formatDisplayPathParts(full, '/project/root');
      expect(parts.fileName).toBe('GoalRunControl.tsx');
      expect(parts.dirPath).toBe('apps/desktop/src/goal/');
      expect(parts.fullDisplayPath).toBe('apps/desktop/src/goal/GoalRunControl.tsx');
    });

    it('handles root-level file with empty dirPath', () => {
      const parts = formatDisplayPathParts('/project/root/package.json', '/project/root');
      expect(parts.fileName).toBe('package.json');
      expect(parts.dirPath).toBe('');
      expect(parts.fullDisplayPath).toBe('package.json');
    });

    it('handles relative path input directly', () => {
      const parts = formatDisplayPathParts('apps/cli/src/attach.test.ts', null);
      expect(parts.fileName).toBe('attach.test.ts');
      expect(parts.dirPath).toBe('apps/cli/src/');
      expect(parts.fullDisplayPath).toBe('apps/cli/src/attach.test.ts');
    });
  });

  describe('resolveChangeStatusInfo', () => {
    it('resolves added and untracked status to success tone', () => {
      expect(resolveChangeStatusInfo('added', 'en')).toEqual({
        label: 'New',
        tone: 'success',
        shortCode: 'A',
      });
      expect(resolveChangeStatusInfo('untracked', 'zh-CN')).toEqual({
        label: '新增',
        tone: 'success',
        shortCode: 'U',
      });
    });

    it('resolves deleted status to danger tone', () => {
      expect(resolveChangeStatusInfo('deleted', 'zh-CN')).toEqual({
        label: '删除',
        tone: 'danger',
        shortCode: 'D',
      });
    });

    it('resolves modified status to warning tone', () => {
      expect(resolveChangeStatusInfo('modified', 'en')).toEqual({
        label: 'Modified',
        tone: 'warning',
        shortCode: 'M',
      });
    });
  });
});
