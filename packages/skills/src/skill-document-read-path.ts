/**
 * Remap a guessed Skill `read` path onto the catalog winner.
 *
 * Packaged Agents often invent `bundled-assets/skills/<id>/SKILL.md` because
 * that is where most catalog `<location>` values live. Project-local skills
 * (`.agents/skills`, `.pi/skills`) must still open.
 */
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { resolve } from 'node:path';
import { catalogSkillMarkdownPathForRead } from '@piwin/contracts';

export type SkillDocumentReadTarget = {
  id: string;
  name?: string;
  path: string;
  enabled?: boolean;
};

export async function resolveSkillDocumentReadPath(input: {
  requestedPath: string;
  skills: readonly SkillDocumentReadTarget[];
}): Promise<string> {
  const requested = resolve(input.requestedPath);
  if (await isReadableFile(requested)) {
    return requested;
  }
  const catalogMarkdownRaw = catalogSkillMarkdownPathForRead({
    requestedPath: requested,
    skills: input.skills,
  });
  if (!catalogMarkdownRaw) {
    return requested;
  }
  const catalogMarkdown = resolve(catalogMarkdownRaw);
  if (await isReadableFile(catalogMarkdown)) {
    return catalogMarkdown;
  }
  return requested;
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
