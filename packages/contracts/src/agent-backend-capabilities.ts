/**
 * Per-session backend capabilities and backend-provided option lists
 * (ADR 0082). Clients gate UI on these; the Host rejects unsupported
 * operations regardless of what a client sends.
 */

export const SESSION_BACKEND_OPERATIONS = [
  'prompt',
  'cancel',
  'queue',
  'intervene',
  'setModel',
  'setEffort',
  'setMode',
  'slashCommands',
  'fileReferences',
  'images',
  'rename',
  'delete',
  'archive',
  'pin',
  'export',
  'fork',
  'rewind',
  'duplicate',
  'pause',
  'compact',
  'conversationTree',
  'coldStorage',
  'hostSubagents',
  'hostTools',
] as const;

export type SessionBackendOperation = (typeof SESSION_BACKEND_OPERATIONS)[number];

export type SessionBackendOperationSupport =
  | { supported: true }
  | {
      supported: false;
      /** Short user-facing reason, e.g. "Grok does not accept images". */
      reason: string;
    };

export type SessionBackendCapabilities = {
  agentId: string;
  operations: Record<SessionBackendOperation, SessionBackendOperationSupport>;
};

/** One entry of a backend-provided select list (model, effort, mode). */
export type BackendOption = {
  id: string;
  label: string;
  description?: string;
};

export type BackendModelOption = BackendOption & {
  contextTokens?: number;
  /** Effort ids this model accepts; absent means the model has no effort control. */
  efforts?: readonly string[];
};

/** Slash command reported by the backend for this session. */
export type BackendSlashCommand = {
  name: string;
  description?: string;
  /** Argument hint shown after the command name. */
  inputHint?: string;
};

/** Backend-owned session settings the composer renders. */
export type SessionBackendOptions = {
  agentId: string;
  models: readonly BackendModelOption[];
  currentModelId?: string;
  currentEffortId?: string;
  modes: readonly BackendOption[];
  currentModeId?: string;
  /** True once the backend confirmed `currentModeId`; false while a switch is unconfirmed. */
  modeConfirmed: boolean;
  /** Backend runs tools without asking (e.g. Grok always-approve / yolo). */
  autoApprove?: boolean;
  commands: readonly BackendSlashCommand[];
};

/**
 * Permission choices offered by the backend itself. piwin passes the option
 * id back verbatim; it never maps these onto piwin remembered rules.
 */
export type BackendPermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always';

export type BackendPermissionOption = {
  optionId: string;
  label: string;
  kind: BackendPermissionOptionKind;
};

const BACKEND_PERMISSION_OPTION_KINDS: ReadonlySet<string> = new Set([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);

export function isBackendPermissionOptionKind(
  value: unknown,
): value is BackendPermissionOptionKind {
  return typeof value === 'string' && BACKEND_PERMISSION_OPTION_KINDS.has(value);
}

export function isAllowPermissionOptionKind(kind: BackendPermissionOptionKind): boolean {
  return kind === 'allow_once' || kind === 'allow_always';
}

const PI_SUPPORTED: SessionBackendOperationSupport = { supported: true };

/** Pi sessions support every operation; per-feature gates stay where they are today. */
export function createPiSessionCapabilities(): SessionBackendCapabilities {
  const operations = {} as Record<SessionBackendOperation, SessionBackendOperationSupport>;
  for (const operation of SESSION_BACKEND_OPERATIONS) {
    operations[operation] = PI_SUPPORTED;
  }
  return { agentId: 'pi', operations };
}

export function isSessionOperationSupported(
  capabilities: SessionBackendCapabilities | undefined,
  operation: SessionBackendOperation,
): boolean {
  if (capabilities === undefined) {
    return true;
  }
  return capabilities.operations[operation].supported;
}

/** Reason text for an unsupported operation, or undefined when supported. */
export function sessionOperationUnsupportedReason(
  capabilities: SessionBackendCapabilities | undefined,
  operation: SessionBackendOperation,
): string | undefined {
  if (capabilities === undefined) {
    return undefined;
  }
  const support = capabilities.operations[operation];
  return support.supported ? undefined : support.reason;
}
