import { describe, expect, it } from 'vitest';
import {
  HOST_TOOL_PERMISSION_ACTIONS,
  isHostToolPermissionAction,
} from './tool-registration.js';

describe('HOST_TOOL_PERMISSION_ACTIONS', () => {
  it('recognizes production actions and rejects parallel taxonomy names', () => {
    expect(isHostToolPermissionAction('file-write')).toBe(true);
    expect(isHostToolPermissionAction('network:video-gen')).toBe(true);
    expect(isHostToolPermissionAction('planning:create')).toBe(true);
    expect(isHostToolPermissionAction('mcp:trusted')).toBe(true);
    expect(isHostToolPermissionAction('planning:write')).toBe(false);
    expect(isHostToolPermissionAction('notes:mutate')).toBe(false);
    expect(isHostToolPermissionAction('browser:lock')).toBe(true);
    expect(isHostToolPermissionAction('browser:interact')).toBe(false);
    expect(new Set(HOST_TOOL_PERMISSION_ACTIONS).size).toBe(HOST_TOOL_PERMISSION_ACTIONS.length);
  });
});
