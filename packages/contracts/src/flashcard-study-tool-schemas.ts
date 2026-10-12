/**
 * JSON Schema projected onto HostToolDescriptor.parameters for
 * flashcard_study_read / flashcard_study_write (scheduled MVP).
 *
 * Kept separate from parsers/mapping so production files stay under the
 * ~400-line responsibility split trigger. Enums are inlined (no import cycle
 * with flashcard-study-tools.ts); keep in sync with FLASHCARD_STUDY_*_ACTIONS.
 */

/** JSON Schema for flashcard_study_read. Catalog scopeFilter is scheduled MVP: all|deck only. */
export const FLASHCARD_STUDY_READ_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['catalog', 'get', 'operation'],
      description: 'catalog | get | operation',
    },
    scopeFilter: {
      type: 'object',
      description:
        'Optional catalog scope filter. Scheduled MVP admits all | deck only (no item/sequence/selection).',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['all', 'deck'] },
        deck: { type: 'string', description: 'Required when kind is deck; no leading/trailing whitespace' },
      },
      required: ['kind'],
    },
    query: { type: 'string', description: 'Optional catalog query string' },
    cursor: { type: 'string', description: 'Optional catalog pagination cursor' },
    limit: { type: 'integer', minimum: 1, description: 'Catalog page size (Host clamps to max)' },
    roundId: { type: 'string', description: 'Required for get' },
    idempotencyKey: {
      type: 'string',
      description: 'Required for operation — key of a prior write to inspect',
    },
  },
};

/**
 * JSON Schema for flashcard_study_write (scheduled MVP).
 * `mode` and `scope` apply only to action=start; other actions reject them as unknown fields.
 */
export const FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'idempotencyKey'],
  properties: {
    action: {
      type: 'string',
      enum: ['start', 'claim', 'checkpoint', 'rate', 'undo', 'pause', 'resume', 'end'],
      description:
        'start | claim | checkpoint | rate | undo | pause | resume | end (scheduled MVP; no goto/next)',
    },
    idempotencyKey: {
      type: 'string',
      description: 'Stable client key for mutation idempotency; reuse on unknown result',
    },
    mode: {
      type: 'string',
      enum: ['scheduled'],
      description:
        'start only (omit or scheduled). Sequence mode is not admitted; non-start actions must omit mode',
    },
    scope: {
      type: 'object',
      description: 'start only: all or deck. Non-start actions must omit scope',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['all', 'deck'] },
        deck: { type: 'string', description: 'Required when kind is deck; no leading/trailing whitespace' },
      },
      required: ['kind'],
    },
    resumeExisting: {
      type: 'boolean',
      description: 'start only; defaults true when omitted',
    },
    roundId: { type: 'string' },
    expectedRevision: { type: 'integer', minimum: 0 },
    expectedControlEpoch: { type: 'integer', minimum: 0 },
    controlEpoch: { type: 'integer', minimum: 0 },
    entryId: { type: 'string' },
    contentVersion: { type: 'string' },
    face: { type: 'string', enum: ['question', 'answer'] },
    needsReview: { type: 'boolean' },
    rating: { type: 'string', enum: ['again', 'hard', 'good', 'easy'] },
    expectedReviewStateRevision: { type: 'integer', minimum: 0 },
    targetOperationId: { type: 'string' },
  },
};
