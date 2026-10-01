import { describe, expect, it } from 'vitest';
import {
  EXTENSION_SESSION_BACKEND_SCHEMA_VERSION,
  enabledExtensionSessionBackends,
  findDuplicateExtensionBackendIds,
  parseExtensionSessionBackend,
} from './extension-session-backend.js';
import { AGENT_PLUGIN_MAX_ARTIFACT_BYTES, parseExecutableAgentPluginManifest } from './agent-plugin-manifest.js';

const DIGEST = 'a'.repeat(64);

function validDeclaration(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'example-build',
    name: 'Example Build',
    version: '1.0.0',
    minHostVersion: '0.0.0',
    protocol: 'piwin-agent-stdio',
    protocolVersion: 1,
    minHostProtocolVersion: 1,
    platforms: ['darwin'],
    verifiedCliVersions: ['1.0.41'],
    helpUrl: 'https://example.com',
    artifact: {
      format: 'node-esm',
      entrypoint: 'dist/agent.mjs',
      sha256: DIGEST,
      byteSize: 2048,
    },
    compatibleRevisions: [DIGEST],
    unversionedBindingCompatible: false,
    outputDirectories: [
      { id: 'generated', base: 'user-home', relativePath: '.example/sessions/{backendSessionId}', kind: 'image' },
    ],
  };
}

function withPatch(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...validDeclaration(), ...patch };
}

function failureOf(value: unknown): { code: string; detail: string } {
  const result = parseExtensionSessionBackend(value);
  if (result === undefined || result.ok) {
    throw new Error(`expected a failure result, received ${JSON.stringify(result)}`);
  }
  return { code: result.code, detail: result.detail };
}

describe('parseExtensionSessionBackend', () => {
  it('returns undefined when the extension is not a backend', () => {
    expect(parseExtensionSessionBackend(undefined)).toBeUndefined();
  });

  it('parses a valid declaration and preserves every field', () => {
    const result = parseExtensionSessionBackend(validDeclaration());
    expect(result?.ok).toBe(true);
    if (result === undefined || !result.ok) throw new Error('expected ok');
    expect(result.declaration.schemaVersion).toBe(EXTENSION_SESSION_BACKEND_SCHEMA_VERSION);
    expect(result.declaration.id).toBe('example-build');
    expect(result.declaration.artifact).toEqual({
      format: 'node-esm',
      entrypoint: 'dist/agent.mjs',
      sha256: DIGEST,
      byteSize: 2048,
    });
    expect(result.declaration.platforms).toEqual(['darwin']);
    expect(result.declaration.outputDirectories).toEqual([
      { id: 'generated', base: 'user-home', relativePath: '.example/sessions/{backendSessionId}', kind: 'image' },
    ]);
  });

  it('does not leak the parsed input object', () => {
    const input = validDeclaration();
    const result = parseExtensionSessionBackend(input);
    if (result === undefined || !result.ok) throw new Error('expected ok');
    expect(result.declaration).not.toBe(input);
    expect(result.declaration.artifact).not.toBe(input['artifact']);
    expect(result.declaration.platforms).not.toBe(input['platforms']);
  });

  it('rejects a non-object declaration', () => {
    expect(failureOf([validDeclaration()]).code).toBe('not-an-object');
    expect(failureOf('sessionBackend').code).toBe('not-an-object');
  });

  it('rejects an unknown key so a typo fails loudly', () => {
    expect(failureOf(withPatch({ sessionBackends: 1 })).code).toBe('unknown-key');
  });

  it('rejects an unsupported schema version', () => {
    expect(failureOf(withPatch({ schemaVersion: 2 })).code).toBe('unsupported-schema');
  });

  it('rejects an invalid backend id and a reserved backend id', () => {
    expect(failureOf(withPatch({ id: 'Example' })).code).toBe('invalid-backend-id');
    expect(failureOf(withPatch({ id: '-bad' })).code).toBe('invalid-backend-id');
    expect(failureOf(withPatch({ id: 'pi' })).code).toBe('reserved-backend-id');
  });

  it('rejects a missing or oversized name', () => {
    expect(failureOf(withPatch({ name: '' })).code).toBe('invalid-name');
    expect(failureOf(withPatch({ name: '   ' })).code).toBe('invalid-name');
    expect(failureOf(withPatch({ name: 'x'.repeat(121) })).code).toBe('invalid-name');
    expect(failureOf(withPatch({ helpUrl: '' })).code).toBe('invalid-name');
  });

  it('rejects a malformed version or host version', () => {
    expect(failureOf(withPatch({ version: '1.0' })).code).toBe('invalid-version');
    expect(failureOf(withPatch({ minHostVersion: 'v1.0.0' })).code).toBe('invalid-version');
  });

  it('rejects an unsupported protocol', () => {
    expect(failureOf(withPatch({ protocol: 'acp' })).code).toBe('unsupported-protocol');
  });

  it('rejects an unsupported protocol version', () => {
    expect(failureOf(withPatch({ protocolVersion: 2 })).code).toBe('unsupported-protocol-version');
    expect(failureOf(withPatch({ minHostProtocolVersion: 99 })).code).toBe('unsupported-protocol-version');
    expect(failureOf(withPatch({ minHostProtocolVersion: -1 })).code).toBe('unsupported-protocol-version');
  });

  it('rejects an empty, unknown or duplicated platform list', () => {
    expect(failureOf(withPatch({ platforms: [] })).code).toBe('unsupported-platform');
    expect(failureOf(withPatch({ platforms: ['solaris'] })).code).toBe('unsupported-platform');
    expect(failureOf(withPatch({ platforms: ['darwin', 'darwin'] })).code).toBe('unsupported-platform');
  });

  it('rejects an artifact with a bad digest or byte size', () => {
    const base = validDeclaration()['artifact'] as Record<string, unknown>;
    expect(failureOf(withPatch({ artifact: { ...base, sha256: 'abc' } })).code).toBe('invalid-artifact');
    expect(failureOf(withPatch({ artifact: { ...base, byteSize: 0 } })).code).toBe('invalid-artifact');
    expect(failureOf(withPatch({ artifact: { ...base, format: 'cjs' } })).code).toBe('invalid-artifact');
  });

  it('rejects an artifact above the size cap', () => {
    const base = validDeclaration()['artifact'] as Record<string, unknown>;
    expect(failureOf(withPatch({
      artifact: { ...base, byteSize: AGENT_PLUGIN_MAX_ARTIFACT_BYTES + 1 },
    })).code).toBe('artifact-too-large');
  });

  it('rejects an entrypoint that escapes the extension package root', () => {
    const base = validDeclaration()['artifact'] as Record<string, unknown>;
    for (const entrypoint of ['../escape.mjs', '/abs/agent.mjs', 'dist\\agent.mjs', 'dist/agent.js', 'dist/../x.mjs']) {
      expect(failureOf(withPatch({ artifact: { ...base, entrypoint } })).code)
        .toBe('invalid-artifact-entrypoint');
    }
  });

  it('rejects invalid or duplicated output directories', () => {
    expect(failureOf(withPatch({
      outputDirectories: [{ id: 'a', base: 'user-home', relativePath: '{unknownTemplate}/x', kind: 'image' }],
    })).code).toBe('invalid-output-directory');
    expect(failureOf(withPatch({
      outputDirectories: [
        { id: 'same', base: 'user-home', relativePath: 'a', kind: 'image' },
        { id: 'same', base: 'working-directory', relativePath: 'b', kind: 'video' },
      ],
    })).code).toBe('invalid-output-directory');
  });
});

describe('findDuplicateExtensionBackendIds', () => {
  function declarationWith(id: string) {
    const result = parseExtensionSessionBackend(withPatch({ id }));
    if (result === undefined || !result.ok) throw new Error(`test fixture ${id} must parse`);
    return result.declaration;
  }

  it('accepts a set where every backend id is unique', () => {
    expect(findDuplicateExtensionBackendIds([
      declarationWith('example-build'),
      declarationWith('other-build'),
    ])).toEqual([]);
  });

  it('reports an id claimed by two enabled extensions once', () => {
    expect(findDuplicateExtensionBackendIds([
      declarationWith('example-build'),
      declarationWith('example-build'),
      declarationWith('other-build'),
    ])).toEqual(['example-build']);
  });

  it('accepts an empty set', () => {
    expect(findDuplicateExtensionBackendIds([])).toEqual([]);
  });
});

describe('parseExecutableAgentPluginManifest output directories', () => {
  function validManifest(): Record<string, unknown> {
    return {
      schemaVersion: 2,
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      minHostVersion: '0.0.0',
      protocol: 'piwin-agent-stdio',
      protocolVersion: 1,
      minHostProtocolVersion: 1,
      platforms: ['darwin'],
      verifiedCliVersions: ['1.0.41'],
      helpUrl: 'https://example.com',
      sourceRevision: 'b'.repeat(40),
      artifact: {
        format: 'node-esm',
        entrypoint: 'agent.mjs',
        url: 'https://example.com/agent.mjs',
        sha256: DIGEST,
        byteSize: 2048,
      },
      compatibleRevisions: [],
      unversionedBindingCompatible: false,
      outputDirectories: [
        { id: 'generated', base: 'user-home', relativePath: '.example/{backendSessionId}', kind: 'image' },
      ],
    };
  }

  it('still accepts a valid downloaded manifest', () => {
    expect(parseExecutableAgentPluginManifest(validManifest())).toBeDefined();
  });

  it('still rejects duplicate output directory ids after the shared-helper extraction', () => {
    const manifest = validManifest();
    manifest['outputDirectories'] = [
      { id: 'same', base: 'user-home', relativePath: 'a', kind: 'image' },
      { id: 'same', base: 'user-home', relativePath: 'b', kind: 'image' },
    ];
    expect(parseExecutableAgentPluginManifest(manifest)).toBeUndefined();
  });

  it('still rejects an output directory list over the shared 16 entry cap', () => {
    const manifest = validManifest();
    manifest['outputDirectories'] = Array.from({ length: 17 }, (_unused, index) => ({
      id: `dir-${index}`,
      base: 'user-home',
      relativePath: `dir-${index}`,
      kind: 'image',
    }));
    expect(parseExecutableAgentPluginManifest(manifest)).toBeUndefined();
  });
});

describe('enabledExtensionSessionBackends', () => {
  const backend = { id: 'example-build', name: 'Example Build' };

  it('lists only enabled declarations and keeps the first id', () => {
    expect(enabledExtensionSessionBackends([
      { id: 'ext-a', enabled: true, sessionBackend: backend },
      { id: 'tool', enabled: true },
      { id: 'ext-off', enabled: false, sessionBackend: { id: 'other', name: 'Other' } },
      { id: 'ext-dup', enabled: true, sessionBackend: backend },
    ])).toEqual([{ extensionId: 'ext-a', agentId: 'example-build', name: 'Example Build' }]);
  });
});
