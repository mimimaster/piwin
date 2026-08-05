/** Explicit Host tool-family index derived from concrete registrations. */

import type { HostToolRegistration, SessionToolFamily } from '@piwin/contracts';

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
    // Repair spec WP0: side-effect tools must declare a subject builder so the
    // admission gate never guesses from the tool name. Read-only tools must
    // declare `readOnly: true` explicitly instead of omitting the builder.
    if (registration.permissionSpec.readOnly !== true && !registration.permissionSpec.subjectBuilder) {
      throw new HostToolRegistrationError(
        `permission subject builder missing for side-effect tool: ${name}`,
      );
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
