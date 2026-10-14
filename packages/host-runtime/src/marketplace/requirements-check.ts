/**
 * Observes a catalog entry's requirements on this Host: OS, commands on PATH,
 * environment variables. Accounts and subscriptions are not observable here,
 * so they report `unknown` rather than a guess.
 */
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type {
  MarketplaceCatalogEntry,
  MarketplaceRequirement,
  MarketplaceRequirementCheck,
  MarketplaceRequirementStatus,
} from '@piwin/contracts';

export type RequirementsProbe = {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  isExecutable: (path: string) => boolean;
};

const HOST_OS_PLATFORM: Record<string, NodeJS.Platform> = {
  macos: 'darwin',
  darwin: 'darwin',
  windows: 'win32',
  win32: 'win32',
  linux: 'linux',
};

/** Command names only; anything path-like is not something PATH lookup answers. */
const COMMAND_NAME = /^[A-Za-z0-9._+-]+$/;

export function defaultRequirementsProbe(): RequirementsProbe {
  return {
    platform: process.platform,
    env: process.env,
    isExecutable: (path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        // Not executable or missing — both mean "not this candidate".
        return false;
      }
    },
  };
}

function commandOnPath(command: string, probe: RequirementsProbe): boolean {
  const pathValue = probe.env.PATH ?? probe.env.Path ?? '';
  const extensions =
    probe.platform === 'win32'
      ? ['', ...(probe.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  return pathValue
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => extensions.some((extension) => probe.isExecutable(join(directory, command + extension))));
}

/**
 * Catalog values may name several commands (`node / npx`, `python3 + playwright`).
 * All found → met, none found → missing; a mix may be a non-PATH dependency
 * (a Python module), so it stays `unknown` instead of a false "missing".
 */
function commandStatus(value: string, probe: RequirementsProbe): MarketplaceRequirementStatus {
  const names = value.split(/\s*[/+]\s*/).filter(Boolean);
  if (names.length === 0 || names.some((name) => !COMMAND_NAME.test(name))) return 'unknown';
  const found = names.filter((name) => commandOnPath(name, probe)).length;
  if (found === names.length) return 'met';
  return found === 0 ? 'missing' : 'unknown';
}

function statusFor(requirement: MarketplaceRequirement, probe: RequirementsProbe): MarketplaceRequirementStatus {
  const value = requirement.value.trim();
  switch (requirement.kind) {
    case 'host-os': {
      const platform = HOST_OS_PLATFORM[value.toLowerCase()];
      if (!platform) return 'unknown';
      return platform === probe.platform ? 'met' : 'missing';
    }
    case 'command':
      return commandStatus(value, probe);
    case 'environment':
      return probe.env[value]?.trim() ? 'met' : 'missing';
    case 'account':
    case 'subscription':
      return 'unknown';
  }
}

export function checkMarketplaceRequirements(
  entry: Pick<MarketplaceCatalogEntry, 'requirements'>,
  probe: RequirementsProbe = defaultRequirementsProbe(),
): MarketplaceRequirementCheck[] {
  return entry.requirements.map((requirement) => ({
    kind: requirement.kind,
    value: requirement.value,
    required: requirement.required,
    status: statusFor(requirement, probe),
  }));
}
