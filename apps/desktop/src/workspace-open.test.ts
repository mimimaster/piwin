import { describe, expect, it } from 'vitest';
import {
  looksLikeFilesystemWorkspacePath,
  shouldPromptHostBrowser,
  workspacePickerDefaultPath,
} from './workspace-open.js';

describe('workspacePickerDefaultPath', () => {
  it('prefers a real workspace path over an opaque remote project id', () => {
    expect(
      workspacePickerDefaultPath({
        projectPath: 'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        projectInput: '',
        hostHomeDirectory: '/Users/host',
      }),
    ).toBe('/Users/host');
  });

  it('uses the typed path when it looks like a filesystem path', () => {
    expect(
      workspacePickerDefaultPath({
        projectPath: null,
        projectInput: '/Users/host/Developer/piwin',
        hostHomeDirectory: '/Users/host',
      }),
    ).toBe('/Users/host/Developer/piwin');
  });

  it('accepts a Windows Host home', () => {
    expect(
      workspacePickerDefaultPath({
        projectPath: null,
        projectInput: '',
        hostHomeDirectory: 'C:\\Users\\host',
      }),
    ).toBe('C:\\Users\\host');
  });
});

describe('shouldPromptHostBrowser', () => {
  it('uses the OS dialog in the desktop shell when the Host is this computer', () => {
    expect(shouldPromptHostBrowser({ desktopShell: true })).toBe(false);
    expect(shouldPromptHostBrowser({ desktopShell: true, hostFilesystemRemote: false })).toBe(
      false,
    );
  });

  it('opens the Host folder window in the browser, or when the Host is another machine', () => {
    expect(shouldPromptHostBrowser({ desktopShell: false })).toBe(true);
    expect(shouldPromptHostBrowser({ desktopShell: true, hostFilesystemRemote: true })).toBe(true);
  });
});

describe('looksLikeFilesystemWorkspacePath', () => {
  it('accepts posix and windows roots and rejects opaque ids', () => {
    expect(looksLikeFilesystemWorkspacePath('/Users/host')).toBe(true);
    expect(looksLikeFilesystemWorkspacePath('C:\\Users\\host')).toBe(true);
    expect(looksLikeFilesystemWorkspacePath('project-aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
    expect(looksLikeFilesystemWorkspacePath('')).toBe(false);
  });
});
