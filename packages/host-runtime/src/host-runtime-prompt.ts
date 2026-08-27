/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaAttachmentRef, PromptAttachment, PromptInput } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { formatTextModelWebElementInjection } from '@piwin/contracts';
import {
  assertInsideMediaRoot,
  extractAttachmentText,
  formatAttachmentTextInjection,
} from '@piwin/media';
import {
  formatVisionDescriptionInjection,
  pathInjectMediaAttachment,
  primaryModelSupportsImage,
  resolvePrimaryModelInput,
  shouldDelegateVision,
  splitAttachments,
  VisionDelegationCache,
  sharedVisionDelegationCache,
  delegateImageToVisionModel,
  DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
} from './vision-delegation.js';

import { loadPiwinConfig } from './config-store.js';
import { createSecretResolver } from './secret-resolver.js';
import { findEnabledProvider } from './provider-helpers.js';
import { getPiwinMediaDir, getPiwinRoot } from './paths.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import {
  isTextualAttachment,
  stripMediaAttachments,
  validateMediaAttachment,
} from './prompt-media-attachments.js';

/**
 * Sync path validation only (used before accepting a run).
 * Full model-facing rewrite is async — see {@link buildModelPromptInput}.
 */
export function validatePromptAttachments(deps: HostRuntimeKernel, input: PromptInput): void {
  if (!input.attachments || input.attachments.length === 0) {
    return;
  }
  const mediaRoot = getPiwinMediaDir(getPiwinRoot(deps.options.piwinRoot));
  for (const attachment of input.attachments) {
    if (attachment.kind === 'media') {
      validateMediaAttachment(mediaRoot, attachment);
    } else if (attachment.screenshotPath !== undefined) {
      assertInsideMediaRoot(mediaRoot, attachment.screenshotPath);
    }
  }
}

/**
 * Attachments are accepted only from piwin's media root.
 *
 * Media branching (vision-delegation rev3):
 * - multimodal primary → keep media attachments → adapter loads ImageContent
 * - text-only + D1 on → vision description inject; strip media attachments
 * - text-only + D1 off → path inject; strip media attachments
 * Web-element: structured text injection always.
 */
export async function buildModelPromptInput(
  deps: HostRuntimeKernel,
  input: PromptInput,
  signal?: AbortSignal,
): Promise<PromptInput> {
  if (!input.attachments || input.attachments.length === 0) {
    // Shallow copy so preparePromptInput can rewrite model-facing text
    // (scheme / plan / history) without mutating the caller's PromptInput.
    return {
      ...input,
      text: input.text,
    };
  }

  const mediaRoot = getPiwinMediaDir(getPiwinRoot(deps.options.piwinRoot));
  const safeAttachments: PromptAttachment[] = [];
  const webInjections: string[] = [];
  for (const attachment of input.attachments) {
    if (attachment.kind === 'media') {
      safeAttachments.push(validateMediaAttachment(mediaRoot, attachment));
    } else {
      if (attachment.screenshotPath !== undefined) {
        assertInsideMediaRoot(mediaRoot, attachment.screenshotPath);
      }
      safeAttachments.push(attachment);
      webInjections.push(formatTextModelWebElementInjection(attachment));
    }
  }

  const { media, other } = splitAttachments(safeAttachments);
  const imageMedia: MediaAttachmentRef[] = [];
  const extractedTextInjections: string[] = [];
  for (const mediaAttachment of media) {
    if (isTextualAttachment(mediaAttachment)) {
      if (signal?.aborted) {
        throw new Error('prompt preparation aborted');
      }
      const extracted = await extractAttachmentText(
        mediaAttachment.path,
        mediaAttachment.mimeType,
        mediaAttachment.name !== undefined ? { name: mediaAttachment.name } : undefined,
      );
      extractedTextInjections.push(formatAttachmentTextInjection(extracted));
    } else {
      imageMedia.push(mediaAttachment);
    }
  }
  const config = await loadPiwinConfig(deps.options.piwinRoot);
  const primaryInput = resolvePrimaryModelInput(input, config);
  const supportsImage = primaryModelSupportsImage(primaryInput);
  const textInjections = [input.text, ...webInjections, ...extractedTextInjections].filter(Boolean);

  if (imageMedia.length === 0) {
    return {
      ...input,
      text: textInjections.join('\n\n'),
      ...(other.length > 0 ? { attachments: other } : {}),
    };
  }

  if (supportsImage) {
    // D2: native images via adapter loadPromptImages. Native text stays
    // free of absolute paths/base64; the adapter encodes attachments as
    // ImageContent parts (spec Phase 4: "Remove native path inventory").
    deps.push({
      type: 'host/log',
      level: 'info',
      message: `Sending ${imageMedia.length} image(s) as native vision content to the primary model`,
    });
    return {
      ...input,
      text: textInjections.join('\n\n'),
      attachments: [...other, ...imageMedia],
    };
  }

  // Text-only: never pass ImageContent to the primary model.
  const mediaInjections: string[] = [];
  const delegate =
    shouldDelegateVision({
      primaryModelInput: primaryInput,
      hasMediaAttachments: imageMedia.length > 0,
      config: config.visionDelegation,
    }) && config.visionDelegation?.model
      ? config.visionDelegation
      : undefined;

  if (delegate?.model) {
    const visionRef = delegate.model;
    const visionProvider = findEnabledProvider(config, visionRef.providerId);
    if (!visionProvider) {
      deps.push({
        type: 'host/log',
        level: 'warn',
        message: `vision delegation: provider not found (${visionRef.providerId}); falling back to path injection`,
      });
    } else {
      let apiKey: string | null = null;
      try {
        apiKey = await createSecretResolver().resolveProviderSecret(visionProvider);
      } catch (error) {
        const message = formatError(error);
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `vision delegation: secret resolve failed (${message}); path fallback`,
        });
      }
      if (apiKey) {
        const systemPrompt =
          delegate.systemPrompt?.trim() || DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT;
        for (const mediaAttachment of imageMedia) {
          if (signal?.aborted) {
            throw new Error('prompt preparation aborted');
          }
          try {
            let description: string | undefined;
            const fileBytes = await readFile(mediaAttachment.path);
            const cacheKey =
              delegate.cacheEnabled === false
                ? null
                : VisionDelegationCache.buildKey({
                    fileBytes,
                    mimeType: mediaAttachment.mimeType,
                    providerId: visionRef.providerId,
                    modelId: visionRef.modelId,
                    systemPrompt,
                  });
            if (cacheKey) {
              description = sharedVisionDelegationCache.get(cacheKey);
            }
            if (!description) {
              deps.push({
                type: 'host/log',
                level: 'info',
                message: `Describing image with ${visionRef.providerId}/${visionRef.modelId}…`,
              });
              description = await delegateImageToVisionModel({
                imagePath: mediaAttachment.path,
                mimeType: mediaAttachment.mimeType,
                provider: visionProvider,
                modelId: visionRef.modelId,
                apiKey,
                systemPrompt,
                ...(delegate.timeoutMs !== undefined ? { timeoutMs: delegate.timeoutMs } : {}),
                ...(signal ? { signal } : {}),
              });
              if (cacheKey) {
                sharedVisionDelegationCache.set(cacheKey, description);
              }
            }
            mediaInjections.push(
              formatVisionDescriptionInjection({
                absolutePath: mediaAttachment.path,
                mimeType: mediaAttachment.mimeType,
                model: visionRef,
                description,
              }),
            );
          } catch (error) {
            const message = formatError(error);
            deps.push({
              type: 'host/log',
              level: 'warn',
              message: `vision delegation failed for ${mediaAttachment.path}: ${message}; path fallback`,
            });
            mediaInjections.push(pathInjectMediaAttachment(mediaAttachment));
          }
        }
        // Strip media so adapter does not load ImageContent for text-only primary.
        return stripMediaAttachments(
          input,
          [...textInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
          other,
        );
      }
    }
  }

  // Path fallback (D1 off or vision provider/secret unavailable).
  deps.push({
    type: 'host/log',
    level: 'warn',
    message:
      'Primary model is text-only (or vision input is unset). Images will be path-injected — the model cannot see pixels. Switch to a vision model or enable vision delegation.',
  });
  for (const mediaAttachment of imageMedia) {
    mediaInjections.push(pathInjectMediaAttachment(mediaAttachment));
  }
  return stripMediaAttachments(
    input,
    [...textInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
    other,
  );
}
