/**
 * Detect / preview / apply a local Pi CLI home into Host-owned auth.
 * Followed extensions/skills are already unioned; this only writes missing oauth keys.
 */
import { access, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PiEnvironmentApplyData,
  PiEnvironmentDetectData,
  PiEnvironmentPreviewData,
} from '@piwin/contracts';
import {
  copyMissingOauthKeys,
  ensureHostPiAgentDir,
  listOauthProviderIds,
  readAuthObject,
} from './import-legacy-pi-auth.js';
import { loadPiNativeInventory } from './pi-package-inventory.js';
import {
  getPiAgentDir,
  getPiwinPiAgentDir,
  getPiwinRoot,
  isDefaultPiwinRoot,
} from './paths.js';

const INGEST_RECEIPT_NAME = 'ingest-receipt.json';
const DETECT_NAMES = [
  'auth.json',
  'settings.json',
  'models.json',
  'extensions',
  'skills',
  'prompts',
  'npm',
  'git',
  'packages',
] as const;

export type PiEnvironmentOptions = {
  piwinRoot?: string;
  defaultProductRoot?: string;
  piAgentDir?: string;
};

export async function detectPiEnvironment(
  options: PiEnvironmentOptions = {},
): Promise<PiEnvironmentDetectData> {
  const root = getPiwinRoot(options.piwinRoot);
  if (!isDefaultPiwinRoot(root, options.defaultProductRoot)) {
    return { available: false, reason: 'non-default-root' };
  }
  const piAgentDir = options.piAgentDir ?? getPiAgentDir();
  if (!(await piHomeLooksPresent(piAgentDir))) {
    return { available: false, reason: 'not-found', piAgentDir };
  }
  return { available: true, piAgentDir };
}

export async function previewPiEnvironment(
  options: PiEnvironmentOptions = {},
): Promise<PiEnvironmentPreviewData> {
  const detected = await detectPiEnvironment(options);
  if (!detected.available || !detected.piAgentDir) {
    return {
      available: false,
      ...(detected.reason ? { reason: detected.reason } : {}),
      missingProviderIds: [],
      followedExtensionCount: 0,
      followedSkillCount: 0,
    };
  }
  const sourcePath = detected.piAgentDir;
  const sourceAuth = await readAuthObject(join(sourcePath, 'auth.json'));
  const hostAuth = await readAuthObject(
    join(getPiwinPiAgentDir(getPiwinRoot(options.piwinRoot)), 'auth.json'),
  );
  const hostIds = new Set(listOauthProviderIds(hostAuth));
  const missingProviderIds = listOauthProviderIds(sourceAuth).filter((id) => !hostIds.has(id));
  const native = await loadPiNativeInventory({
    agentDir: sourcePath,
    includeUserGlobal: true,
  });
  return {
    available: true,
    sourcePath,
    missingProviderIds,
    followedExtensionCount: native.extensions.length,
    followedSkillCount: native.skills.length,
  };
}

export async function applyPiEnvironment(
  options: PiEnvironmentOptions = {},
): Promise<PiEnvironmentApplyData> {
  const detected = await detectPiEnvironment(options);
  if (!detected.available || !detected.piAgentDir) {
    return {
      ok: false,
      skipped: true,
      ...(detected.reason ? { reason: detected.reason } : {}),
      copiedProviderIds: [],
    };
  }
  const root = getPiwinRoot(options.piwinRoot);
  await ensureHostPiAgentDir(root);
  const destinationPath = join(getPiwinPiAgentDir(root), 'auth.json');
  const source = await readAuthObject(join(detected.piAgentDir, 'auth.json'));
  const destination = (await readAuthObject(destinationPath)) ?? {};
  const copiedProviderIds = source ? copyMissingOauthKeys(source, destination) : [];
  if (copiedProviderIds.length > 0) {
    await writeFile(destinationPath, `${JSON.stringify(destination, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await chmod(destinationPath, 0o600);
    } catch {
      // File mode is best-effort on filesystems that reject chmod.
    }
  }
  const receiptPath = await writeIngestReceipt({
    piwinRoot: root,
    sourcePath: detected.piAgentDir,
    copiedProviderIds,
  });
  return { ok: true, skipped: false, copiedProviderIds, receiptPath };
}

async function writeIngestReceipt(input: {
  piwinRoot: string;
  sourcePath: string;
  copiedProviderIds: string[];
}): Promise<string> {
  const receiptPath = join(getPiwinPiAgentDir(input.piwinRoot), INGEST_RECEIPT_NAME);
  const body = {
    ingestedAt: new Date().toISOString(),
    sourcePath: input.sourcePath,
    copiedProviderIds: input.copiedProviderIds,
    bundledNote:
      'Followed extensions and skills stay on disk under the Pi home. This ingest only merged missing Host oauth keys.',
  };
  await writeFile(receiptPath, `${JSON.stringify(body)}\n`, { encoding: 'utf8', mode: 0o600 });
  return receiptPath;
}

async function piHomeLooksPresent(piAgentDir: string): Promise<boolean> {
  for (const name of DETECT_NAMES) {
    try {
      await access(join(piAgentDir, name));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
