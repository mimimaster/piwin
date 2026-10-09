/**
 * Fail-closed read-only admission for one script invocation.
 *
 * A toolbox shell marked read-only does not authorize its target. Shell,
 * browser, process, and other action families stay denied even if a
 * registration sets `readOnly`.
 */

import {
  CODEMODE_TOOL_NAME,
  type HostToolRegistration,
  type SessionToolFamily,
} from '@piwin/contracts';

const ADMITTED_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'filesystem-read',
  'web-search',
  'web-fetch',
  'notes-read',
  'flashcards-read',
]);

const ADMITTED_ACTIONS: ReadonlySet<string> = new Set([
  'filesystem:read',
  'filesystem:list',
  'network:web_search',
  'network:web_fetch',
  'notes:note_list',
  'notes:note_search',
  'notes:note_read',
  'knowledge:knowledge_list',
  'knowledge:knowledge_search',
  'knowledge:knowledge_read',
  'flashcards:list',
]);

export type ScriptReadonlyDenial = {
  code: 'permission-denied' | 'tool-not-available';
  message: string;
};

export function scriptReadonlyDenial(
  registration: HostToolRegistration,
): ScriptReadonlyDenial | undefined {
  const name = registration.descriptor.name;
  if (name === CODEMODE_TOOL_NAME) {
    return { code: 'permission-denied', message: 'codemode cannot call itself' };
  }
  if (!ADMITTED_FAMILIES.has(registration.family)) {
    return {
      code: 'permission-denied',
      message: `script cannot call ${registration.family} tool ${name}`,
    };
  }
  if (registration.permissionSpec.readOnly !== true) {
    return {
      code: 'permission-denied',
      message: `script requires an explicit read-only tool: ${name}`,
    };
  }
  if (!ADMITTED_ACTIONS.has(registration.permissionSpec.action)) {
    return {
      code: 'permission-denied',
      message: `script cannot call action ${registration.permissionSpec.action}`,
    };
  }
  const effect = registration.fileEffect;
  if (effect !== undefined && effect.kind !== 'none') {
    return {
      code: 'permission-denied',
      message: `script tool declares a file effect: ${name}`,
    };
  }
  return undefined;
}

export function compileAdmittedScriptTools(
  tools: readonly HostToolRegistration[],
  maxTools: number,
): { admitted: HostToolRegistration[]; omittedNames: string[] } {
  const eligible = tools
    .filter((tool) => scriptReadonlyDenial(tool) === undefined)
    .sort((left, right) => left.descriptor.name.localeCompare(right.descriptor.name));
  return {
    admitted: eligible.slice(0, maxTools),
    omittedNames: eligible.slice(maxTools).map((tool) => tool.descriptor.name),
  };
}
