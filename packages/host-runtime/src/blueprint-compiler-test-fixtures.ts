import {
  createDefaultWebConfig,
  type HostToolDescriptor,
  type HostToolRegistration,
  type PiwinConfig,
  type SessionScope,
  type SessionToolFamily,
} from '@piwin/contracts';
import { toolFamilyIndex } from './tools/tool-family-index.js';

export function createBlueprintTestConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'rpc',
    providers: [
      {
        id: 'openai-1',
        protocol: 'openai-compatible',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
        models: [{ id: 'gpt-4', label: 'GPT-4', reasoning: true, input: ['text', 'image'] }],
      },
    ],
    media: { maxPasteBytes: 10_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100_000,
    },
    web: createDefaultWebConfig(),
    skills: { extraPaths: [], disabledIds: [] },
    extensions: { extraPaths: [], disabledIds: [] },
    prompts: { extraPaths: [], disabledIds: [] },
    notes: { enabled: true },
    flashcards: { enabled: true },
    ...overrides,
  };
}

export const generalBlueprintTestScope: SessionScope = { kind: 'general' };

/** Agent-path tests use a project because general main sessions compile as Conversation. */
export const agentBlueprintTestScope: SessionScope = {
  kind: 'project',
  projectPath: '/tmp/piwin-blueprint-agent-project',
};

export function createBlueprintTestFamilyIndex(
  descriptors: readonly HostToolDescriptor[],
  assignments: ReadonlyMap<string, SessionToolFamily>,
): ReadonlyMap<SessionToolFamily, readonly string[]> {
  const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  const registrations: HostToolRegistration[] = [];

  for (const [name, family] of assignments) {
    const descriptor = descriptorsByName.get(name);
    if (!descriptor) {
      throw new Error(`test family assignment has no descriptor: ${name}`);
    }
    registrations.push({
      descriptor,
      family,
      permissionSpec: {
        action: 'filesystem:read',
        risk: 'unknown',
        rememberable: false,
        readOnly: true,
      },
      execute: async () => ({ ok: true, output: name }),
    });
  }

  return toolFamilyIndex(registrations);
}

export function blueprintTestFamilyAssignments(
  entries: ReadonlyArray<readonly [SessionToolFamily, readonly string[]]>,
): ReadonlyMap<string, SessionToolFamily> {
  return new Map(
    entries.flatMap(([family, names]) => names.map((name) => [name, family] as const)),
  );
}
