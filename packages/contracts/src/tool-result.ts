import type { MediaAttachmentRef } from './host.js';

/**
 * Stable result contract for Host-owned Agent tools.
 *
 * The result is intentionally transport-neutral. `output` remains text so it
 * can be projected to Pi's text content, while `details` carries structured
 * facts such as a Job or Run identity. Executors must not return a bare
 * string once their tool family has migrated to this contract.
 *
 * `images` are ephemeral model-facing pixels. Adapters project them to Pi
 * `ImageContent`. Product transcript/UI must use `details.attachments` paths,
 * never this base64.
 */

export type ToolResultDetails = Record<string, unknown> & {
  jobId?: string;
  runId?: string;
  /** Durable media outputs that the product UI may render as attachments. */
  attachments?: MediaAttachmentRef[];
};

/** One raster image the next model turn may see. Raw base64, no data: prefix. */
export type ToolResultImage = {
  mimeType: string;
  dataBase64: string;
};

/** Stable error codes shared by Host, SDK and RPC tool projections. */
export type ToolResultErrorCode =
  | 'tool-not-available'
  | 'tool-disabled'
  | 'permission-denied'
  | 'aborted'
  | 'execution-failed'
  | 'invalid-input'
  | 'job-failed'
  | 'subagent-failed'
  | 'subagent-needs-integration'
  | 'subagent-cancelled'
  | 'subagent-unavailable'
  | 'subagent-unavailable-fallback-main'
  | 'subagent-delegation-disabled'
  | 'mcp-failed'
  | 'browser-user-has-control';

export type ToolResult =
  | {
      ok: true;
      output: string;
      details?: ToolResultDetails;
      images?: ToolResultImage[];
    }
  | {
      ok: false;
      code: ToolResultErrorCode;
      message: string;
      details?: ToolResultDetails;
      cancelled?: boolean;
      retryable?: boolean;
    };

/**
 * Stable details carried by every immediate-safety `tool-disabled` result
 * (repair spec WP2). Consumers may rely on `domain` + `runtimeGenerationId`
 * without re-deriving them from the message text.
 */
export type ToolDisabledDetails = {
  domain: string;
  runtimeGenerationId: string;
};

/**
 * Build the canonical immediate-safety `tool-disabled` result. All Host
 * admission gates (SDK and RPC share the same shape) return this exact shape
 * so the UI and the worker proxy can treat it uniformly.
 */
export function toolDisabledResult(input: {
  message: string;
  domain: string;
  runtimeGenerationId: string;
}): ToolResult {
  return {
    ok: false,
    code: 'tool-disabled',
    message: input.message,
    details: {
      domain: input.domain,
      runtimeGenerationId: input.runtimeGenerationId,
    },
  };
}
