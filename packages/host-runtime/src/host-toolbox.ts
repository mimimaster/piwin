/** Lazy model surface for low-frequency Host tools. */

import type {
  HostToolRegistration,
  SessionToolFamily,
  ToolResult,
} from '@piwin/contracts';

export const HOST_TOOLBOX_NAME = 'piwin_toolbox';

const TOOLBOX_TARGET_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'process',
  'browser',
  'notes-read',
  'notes-write',
  'flashcards-read',
  'flashcards-write',
  'image-generation',
  'video-generation',
]);

export function isHostToolboxTargetFamily(family: SessionToolFamily): boolean {
  return TOOLBOX_TARGET_FAMILIES.has(family);
}

export function buildHostToolboxRegistration(
  targets: readonly HostToolRegistration[],
): HostToolRegistration {
  const targetNames = targets
    .filter((tool) => isHostToolboxTargetFamily(tool.family))
    .map((tool) => tool.descriptor.name)
    .sort();

  return {
    descriptor: buildHostToolboxDescriptor(targetNames),
    family: 'toolbox',
    permissionSpec: {
      action: 'toolbox:route',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(): Promise<ToolResult> {
      // SessionHostToolExecutionPort owns describe/call dispatch so calls are
      // admitted against the target registration, never this routing shell.
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'piwin_toolbox requires the session Host tool execution port',
      };
    },
  };
}

export function buildHostToolboxDescriptor(targetNames: readonly string[]) {
  const exactTargetNames = [...new Set(targetNames)].sort();
  return {
    name: HOST_TOOLBOX_NAME,
    description:
      'Lazy access to low-frequency Host tools. Use proactively when the task needs browser, process, notes, flashcards, image, or video capabilities. First describe a target to load its exact schema, then call it. Available targets: ' +
      exactTargetNames.join(', '),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['describe', 'call'] },
        target: { type: 'string', enum: exactTargetNames },
        arguments: { type: 'object', additionalProperties: true },
      },
      required: ['action', 'target'],
      additionalProperties: false,
    },
  };
}
