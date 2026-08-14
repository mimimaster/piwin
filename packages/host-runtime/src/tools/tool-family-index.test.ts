import { describe, expect, it } from 'vitest';
import type { HostToolRegistration } from '@piwin/contracts';
import { HostToolRegistrationError, toolFamilyIndex } from './tool-family-index.js';

function registration(name: string, family: HostToolRegistration['family']): HostToolRegistration {
  return {
    descriptor: {
      name,
      description: `${name} description`,
      parameters: { type: 'object' },
    },
    family,
    permissionSpec: {
      action: 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    execute: async () => ({ ok: true, output: name }),
  };
}

describe('toolFamilyIndex', () => {
  it('uses explicit family declarations instead of tool-name inference', () => {
    const index = toolFamilyIndex([
      registration('process_start', 'browser'),
      registration('browser_snapshot', 'process'),
    ]);

    expect(index.get('browser')).toEqual(['process_start']);
    expect(index.get('process')).toEqual(['browser_snapshot']);
  });

  it('rejects duplicate tool names before composition', () => {
    expect(() =>
      toolFamilyIndex([registration('same_tool', 'browser'), registration('same_tool', 'process')]),
    ).toThrowError(new HostToolRegistrationError('duplicate Host tool name: same_tool'));
  });

  it('rejects descriptor names that do not have a canonical spelling', () => {
    expect(() => toolFamilyIndex([registration(' web_fetch ', 'web-fetch')])).toThrow(
      'surrounding whitespace',
    );
  });

  it('keeps descriptor metadata separate from registration metadata', () => {
    const tool = registration('web_fetch', 'web-fetch');

    expect(Object.keys(tool.descriptor).sort()).toEqual(['description', 'name', 'parameters']);
    expect(tool.family).toBe('web-fetch');
    expect(tool.permissionSpec.action).toBe('filesystem:read');
  });

  it('rejects unknown permission actions at compose time', () => {
    const unknown = registration('mystery', 'process');
    unknown.permissionSpec.action = 'mystery:mutate';
    expect(() => toolFamilyIndex([unknown])).toThrow(
      'unknown permission action: mystery/mystery:mutate',
    );
  });

  it('rejects side-effect tools without a subjectBuilder', () => {
    const sideEffectTool = registration('bash_exec', 'process');
    sideEffectTool.permissionSpec.readOnly = false;
    sideEffectTool.prepareArgs = async (args) => ({ ok: true, arguments: args });
    expect(() => toolFamilyIndex([sideEffectTool])).toThrow(
      'permission subject builder missing for side-effect tool: bash_exec',
    );
  });

  it('rejects side-effect tools without prepareArgs', () => {
    const sideEffectTool = registration('bash_exec', 'process');
    sideEffectTool.permissionSpec.readOnly = false;
    sideEffectTool.permissionSpec.subjectBuilder = () => ({ kind: 'process' });
    expect(() => toolFamilyIndex([sideEffectTool])).toThrow(
      'prepareArgs missing for side-effect tool: bash_exec',
    );
  });

  it('exempts trusted-admission tools (e.g. MCP) from the subjectBuilder requirement', () => {
    const trustedTool = registration('mcp_gateway', 'mcp');
    trustedTool.permissionSpec.readOnly = false;
    trustedTool.permissionSpec.admission = 'trusted';
    expect(() => toolFamilyIndex([trustedTool])).not.toThrow();
  });
});
