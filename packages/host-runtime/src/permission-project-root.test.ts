import { describe, expect, it } from 'vitest';
import {
  isBoundPermissionProjectRoot,
  resolvePermissionProjectRoot,
} from './permission-project-root.js';

const GENERAL = '/home/u/.piwin/workspace';

describe('resolvePermissionProjectRoot', () => {
  it('treats missing and empty as unbound; No Repo workspace is a bound project root', () => {
    expect(resolvePermissionProjectRoot(undefined, GENERAL)).toBe('');
    expect(resolvePermissionProjectRoot('', GENERAL)).toBe('');
    expect(resolvePermissionProjectRoot('  ', GENERAL)).toBe('');
    expect(resolvePermissionProjectRoot(GENERAL, GENERAL)).toBe(GENERAL);
    expect(resolvePermissionProjectRoot(`${GENERAL}/`, GENERAL)).toBe(`${GENERAL}/`);
  });

  it('keeps a real project path', () => {
    expect(resolvePermissionProjectRoot('/home/u/project', GENERAL)).toBe('/home/u/project');
  });
});

describe('isBoundPermissionProjectRoot', () => {
  it('is false for empty', () => {
    expect(isBoundPermissionProjectRoot('')).toBe(false);
    expect(isBoundPermissionProjectRoot(' /home/u/project ')).toBe(true);
  });
});
