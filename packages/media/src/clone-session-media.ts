/**
 * SF-01: Clone media attachments from a source session into a target session vault.
 *
 * Copies referenced media files from `~/.piwin/media/<source-session-id>/` into
 * `~/.piwin/media/<target-session-id>/`, rewrites attachment paths in the
 * target transcript, and generates new attachment IDs.
 *
 * This ensures derived sessions (Duplicate/Fork) own their media independently
 * and survive source session deletion.
 */
import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { SessionTranscriptDocument } from '@piwin/contracts';
import { assertInsideMediaRoot } from './media-service.js';

export type CloneSessionMediaOptions = {
  /** Root media directory (~/.piwin/media/). */
  mediaRoot: string;
  /** Target session ID for the cloned media. */
  targetSessionId: string;
};

export type CloneSessionMediaResult = {
  /** Number of media files cloned. */
  clonedCount: number;
  /** Map from old attachment path → new attachment path. */
  pathMap: Map<string, string>;
};

/**
 * Clone all media attachments referenced in a transcript into the target
 * session's media vault. Mutates the transcript in-place to rewrite paths.
 *
 * Uses hard links when possible (same filesystem), falls back to byte copy.
 */
export async function cloneSessionMedia(
  transcript: SessionTranscriptDocument,
  options: CloneSessionMediaOptions,
): Promise<CloneSessionMediaResult> {
  const { mediaRoot, targetSessionId } = options;
  const targetSessionDir = join(mediaRoot, targetSessionId);
  const pathMap = new Map<string, string>();
  let clonedCount = 0;

  // Collect all media attachment paths from the transcript.
  const mediaPaths: string[] = [];
  for (const message of transcript.messages) {
    if (!message.attachments) continue;
    for (const attachment of message.attachments) {
      if (attachment.kind === 'media' && !pathMap.has(attachment.path)) {
        mediaPaths.push(attachment.path);
      }
    }
  }

  if (mediaPaths.length === 0) {
    return { clonedCount: 0, pathMap };
  }

  // Ensure target session directory exists.
  await mkdir(targetSessionDir, { recursive: true });

  for (const sourcePath of mediaPaths) {
    // Validate source path is inside media root.
    try {
      assertInsideMediaRoot(mediaRoot, sourcePath);
    } catch {
      continue;
    }

    const fileName = basename(sourcePath);
    const newId = randomUUID();
    const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const targetFileName = `${newId}${extension}`;
    const targetPath = resolve(targetSessionDir, targetFileName);

    // Validate target path is inside media root.
    assertInsideMediaRoot(mediaRoot, targetPath);

    try {
      // Try hard link first (fast, same filesystem).
      try {
        await link(sourcePath, targetPath);
      } catch {
        // Fall back to byte copy.
        const bytes = await readFile(sourcePath);
        await writeFile(targetPath, bytes);
      }
      pathMap.set(sourcePath, targetPath);
      clonedCount++;
    } catch {
      // If a single file fails, continue with others.
      // The host transaction will check the result and decide whether to abort.
    }
  }

  // Rewrite attachment paths and IDs in the transcript.
  for (const message of transcript.messages) {
    if (!message.attachments) continue;
    message.attachments = message.attachments.map((attachment) => {
      if (attachment.kind !== 'media') return attachment;
      const newPath = pathMap.get(attachment.path);
      if (!newPath) return attachment;
      return {
        ...attachment,
        id: randomUUID(),
        path: newPath,
      };
    });
  }

  return { clonedCount, pathMap };
}

/**
 * Best-effort cleanup of a failed media clone. Removes the target session
 * media directory if it was created during the clone attempt.
 */
export async function cleanupFailedMediaClone(
  mediaRoot: string,
  targetSessionId: string,
): Promise<void> {
  const targetDir = join(mediaRoot, targetSessionId);
  try {
    const { rm } = await import('node:fs/promises');
    await rm(targetDir, { recursive: true, force: true });
  } catch {
    // Non-fatal: best-effort cleanup.
  }
}
