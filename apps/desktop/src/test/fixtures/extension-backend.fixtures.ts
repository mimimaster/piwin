import type { ExtensionSummary } from '@piwin/contracts';

export function backendExtension(enabled: boolean): ExtensionSummary {
  return {
    id: 'example-build',
    name: 'Example Build',
    description: 'A session backend extension.',
    source: 'user',
    path: '/tmp/example-build',
    enabled,
    sessionBackend: {
      schemaVersion: 1,
      id: 'example-build',
      name: 'Example Build',
      version: '1.0.0',
      minHostVersion: '0.0.0',
      protocol: 'piwin-agent-stdio',
      protocolVersion: 1,
      minHostProtocolVersion: 1,
      platforms: ['darwin'],
      verifiedCliVersions: ['1.0.0'],
      helpUrl: 'https://example.test',
      artifact: { format: 'node-esm', entrypoint: 'dist/agent.mjs', sha256: 'a'.repeat(64), byteSize: 12 },
      compatibleRevisions: [],
      unversionedBindingCompatible: false,
      outputDirectories: [],
    },
  };
}

