import { describe, expect, it } from 'vitest';
import {
  hostOsFamilyFromNodePlatform,
  hostPathStyleFromOsFamily,
  hostWorkspacePathExample,
  looksLikeHostAbsolutePath,
} from './host-platform.js';

describe('host platform facts', () => {
  it('maps Node platforms onto OS family and path style', () => {
    expect(hostOsFamilyFromNodePlatform('darwin')).toBe('darwin');
    expect(hostOsFamilyFromNodePlatform('linux')).toBe('linux');
    expect(hostOsFamilyFromNodePlatform('win32')).toBe('win32');
    expect(hostOsFamilyFromNodePlatform('freebsd')).toBe('other');
    expect(hostPathStyleFromOsFamily('win32')).toBe('windows');
    expect(hostPathStyleFromOsFamily('darwin')).toBe('posix');
    expect(hostPathStyleFromOsFamily('linux')).toBe('posix');
  });

  it('gives a Host-native absolute path example', () => {
    expect(hostWorkspacePathExample('darwin')).toBe('/Users/you/project');
    expect(hostWorkspacePathExample('linux')).toBe('/home/you/project');
    expect(hostWorkspacePathExample('win32')).toBe('C:\\Users\\you\\project');
  });

  it('checks absolute paths against the Host path style, not the shell OS', () => {
    expect(looksLikeHostAbsolutePath('/home/host/app', 'posix')).toBe(true);
    expect(looksLikeHostAbsolutePath('C:\\Users\\host\\app', 'posix')).toBe(false);
    expect(looksLikeHostAbsolutePath('C:\\Users\\host\\app', 'windows')).toBe(true);
    expect(looksLikeHostAbsolutePath('C:/Users/host/app', 'windows')).toBe(true);
    expect(looksLikeHostAbsolutePath('/home/host/app', 'windows')).toBe(false);
    expect(looksLikeHostAbsolutePath('\\\\fileserver\\share\\app', 'windows')).toBe(true);
  });
});
