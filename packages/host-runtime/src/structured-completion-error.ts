export type StructuredCompletionErrorCode =
  | 'cancelled'
  | 'provider-timeout'
  | 'provider-request-failed'
  | 'missing-credentials'
  | 'empty-output'
  | 'schema-failed';

export class StructuredCompletionError extends Error {
  readonly code: StructuredCompletionErrorCode;

  constructor(code: StructuredCompletionErrorCode, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}
