/** Explicit Host tool-family index derived from concrete registrations. */

import {
  isHostToolPermissionAction,
  MAX_HOST_TOOL_DURATION_MS,
  type HostToolRegistration,
  type SessionToolFamily,
} from '@piwin/contracts';

export class HostToolRegistrationError extends Error {
  override readonly name = 'HostToolRegistrationError';
}

/**
 * Index concrete registrations by their declared family.
 *
 * Family membership is an explicit registration fact. This function never
 * infers a family from a tool name, and it rejects duplicate tool names so a
 * descriptor cannot silently route to two executors.
 */
export function toolFamilyIndex(
  registrations: readonly HostToolRegistration[],
): ReadonlyMap<SessionToolFamily, readonly string[]> {
  const names = new Set<string>();
  const namesByFamily = new Map<SessionToolFamily, string[]>();

  for (const registration of registrations) {
    const name = registration.descriptor.name.trim();
    if (!name) {
      throw new HostToolRegistrationError('Host tool descriptor name must not be empty');
    }
    if (name !== registration.descriptor.name) {
      throw new HostToolRegistrationError(
        `Host tool descriptor name must not have surrounding whitespace: ${registration.descriptor.name}`,
      );
    }
    if (names.has(name)) {
      throw new HostToolRegistrationError(`duplicate Host tool name: ${name}`);
    }
    if (!registration.permissionSpec.action.trim()) {
      throw new HostToolRegistrationError(`permission action must not be empty: ${name}`);
    }
    if (!isHostToolPermissionAction(registration.permissionSpec.action)) {
      throw new HostToolRegistrationError(
        `unknown permission action: ${name}/${registration.permissionSpec.action}`,
      );
    }
    // Repair spec WP0: side-effect tools must declare a subject builder so the
    // admission gate never guesses from the tool name. Read-only tools must
    // declare `readOnly: true` explicitly instead of omitting the builder.
    // Trusted-admission tools (e.g. MCP, ADR 0033) bypass the permission engine
    // entirely, so they are exempt from both requirements.
    if (
      registration.permissionSpec.admission !== 'trusted' &&
      registration.permissionSpec.readOnly !== true &&
      !registration.permissionSpec.subjectBuilder
    ) {
      throw new HostToolRegistrationError(
        `permission subject builder missing for side-effect tool: ${name}`,
      );
    }
    if (
      registration.permissionSpec.admission !== 'trusted' &&
      registration.permissionSpec.readOnly !== true &&
      !registration.prepareArgs
    ) {
      throw new HostToolRegistrationError(
        `prepareArgs missing for side-effect tool: ${name}`,
      );
    }
    const maxDurationMs = registration.executionSpec?.maxDurationMs;
    if (maxDurationMs !== undefined) {
      if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > MAX_HOST_TOOL_DURATION_MS) {
        throw new HostToolRegistrationError(
          `invalid executionSpec.maxDurationMs for ${name}: ${String(maxDurationMs)}`,
        );
      }
    }
    names.add(name);

    const familyNames = namesByFamily.get(registration.family) ?? [];
    familyNames.push(name);
    namesByFamily.set(registration.family, familyNames);
  }

  return new Map(
    [...namesByFamily.entries()].map(([family, familyNames]) => [
      family,
      Object.freeze([...familyNames].sort()),
    ]),
  );
}
