import { describe, expect, it } from 'vitest';
import { parsePermissionModeOverride } from './permission-mode-override.js';

describe('parsePermissionModeOverride', () => {
  it('returns undefined when neither flag is present', () => {
    expect(parsePermissionModeOverride(['chat', 'hello'])).toEqual({
      mode: undefined,
      fromDangerousAlias: false,
    });
  });

  it('parses --permission-mode auto', () => {
    expect(parsePermissionModeOverride(['chat', '--permission-mode', 'auto'])).toEqual({
      mode: 'auto',
      fromDangerousAlias: false,
    });
  });

  it('parses --permission-mode ask-all', () => {
    expect(parsePermissionModeOverride(['chat', '--permission-mode', 'ask-all'])).toEqual({
      mode: 'ask-all',
      fromDangerousAlias: false,
    });
  });

  it('parses --permission-mode bypass', () => {
    expect(parsePermissionModeOverride(['chat', '--permission-mode', 'bypass'])).toEqual({
      mode: 'bypass',
      fromDangerousAlias: false,
    });
  });

  it('treats --dangerously-bypass-permissions as an alias for bypass', () => {
    expect(
      parsePermissionModeOverride(['chat', '--dangerously-bypass-permissions', 'hello']),
    ).toEqual({ mode: 'bypass', fromDangerousAlias: true });
  });

  it('throws on an invalid --permission-mode value', () => {
    expect(() =>
      parsePermissionModeOverride(['chat', '--permission-mode', 'yolo']),
    ).toThrowError(/Invalid --permission-mode value: yolo/);
  });

  it('ignores --permission-mode when --dangerously-bypass-permissions is also set', () => {
    expect(
      parsePermissionModeOverride([
        'chat',
        '--dangerously-bypass-permissions',
        '--permission-mode',
        'auto',
      ]),
    ).toEqual({ mode: 'bypass', fromDangerousAlias: true });
  });

  it('returns undefined when --permission-mode has no following value', () => {
    expect(parsePermissionModeOverride(['chat', '--permission-mode'])).toEqual({
      mode: undefined,
      fromDangerousAlias: false,
    });
  });
});
