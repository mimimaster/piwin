import { describe, expect, it } from 'vitest';
import {
  FLASHCARD_STUDY_READ_ACTIONS,
  FLASHCARD_STUDY_READ_PERMISSION_ACTION,
  FLASHCARD_STUDY_READ_TOOL_FAMILY,
  FLASHCARD_STUDY_READ_TOOL_NAME,
  FLASHCARD_STUDY_READ_TOOL_PARAMETERS,
  FLASHCARD_STUDY_WRITE_ACTIONS,
  FLASHCARD_STUDY_WRITE_PERMISSION_ACTION,
  FLASHCARD_STUDY_WRITE_TOOL_FAMILY,
  FLASHCARD_STUDY_WRITE_TOOL_NAME,
  FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS,
  flashcardStudyAgentControllerPrincipal,
  flashcardStudyReadInputToCommand,
  flashcardStudyWriteInputToCommand,
  parseFlashcardStudyReadToolInput,
  parseFlashcardStudyWriteToolInput,
} from './flashcard-study-tools.js';
import { isHostToolPermissionAction } from './tool-registration.js';

describe('flashcard study tool surface constants', () => {
  it('names read/write tools and reuses flashcards families', () => {
    expect(FLASHCARD_STUDY_READ_TOOL_NAME).toBe('flashcard_study_read');
    expect(FLASHCARD_STUDY_WRITE_TOOL_NAME).toBe('flashcard_study_write');
    expect(FLASHCARD_STUDY_READ_TOOL_FAMILY).toBe('flashcards-read');
    expect(FLASHCARD_STUDY_WRITE_TOOL_FAMILY).toBe('flashcards-write');
    expect(FLASHCARD_STUDY_READ_PERMISSION_ACTION).toBe('flashcards:study-read');
    expect(FLASHCARD_STUDY_WRITE_PERMISSION_ACTION).toBe('flashcards:study-write');
    expect(isHostToolPermissionAction(FLASHCARD_STUDY_READ_PERMISSION_ACTION)).toBe(true);
    expect(isHostToolPermissionAction(FLASHCARD_STUDY_WRITE_PERMISSION_ACTION)).toBe(true);
  });

  it('exposes strict parameter schemas without sequence/goto/next', () => {
    expect(FLASHCARD_STUDY_READ_ACTIONS).toEqual(['catalog', 'get', 'operation']);
    expect(FLASHCARD_STUDY_WRITE_ACTIONS).toEqual([
      'start',
      'claim',
      'checkpoint',
      'rate',
      'undo',
      'pause',
      'resume',
      'end',
    ]);
    expect(FLASHCARD_STUDY_READ_TOOL_PARAMETERS.additionalProperties).toBe(false);
    expect(FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS.additionalProperties).toBe(false);
    const writeActionEnum = (
      FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS.properties as {
        action: { enum: string[] };
      }
    ).action.enum;
    expect(writeActionEnum).not.toContain('next');
    expect(writeActionEnum).not.toContain('goto');
    const writeProps = FLASHCARD_STUDY_WRITE_TOOL_PARAMETERS.properties as {
      mode: { enum: string[]; description: string };
      scope: { description: string; properties: { kind: { enum: string[] } } };
    };
    expect(writeProps.mode.enum).toEqual(['scheduled']);
    expect(writeProps.mode.description).toMatch(/start only/i);
    expect(writeProps.scope.description).toMatch(/start only/i);
    expect(writeProps.scope.properties.kind.enum).toEqual(['all', 'deck']);

    const readScope = (
      FLASHCARD_STUDY_READ_TOOL_PARAMETERS.properties as {
        scopeFilter: { properties: { kind: { enum: string[] } }; description: string };
      }
    ).scopeFilter;
    expect(readScope.properties.kind.enum).toEqual(['all', 'deck']);
    expect(readScope.description).toMatch(/all \| deck/i);
  });
});

describe('flashcardStudyAgentControllerPrincipal', () => {
  it('derives a stable agent principal from product sessionId', () => {
    expect(flashcardStudyAgentControllerPrincipal('sess-1')).toEqual({
      ok: true,
      value: 'agent:sess-1',
    });
  });

  it('rejects empty or path-like session ids', () => {
    expect(flashcardStudyAgentControllerPrincipal('').ok).toBe(false);
    expect(flashcardStudyAgentControllerPrincipal('../x').ok).toBe(false);
    expect(flashcardStudyAgentControllerPrincipal('a:b').ok).toBe(false);
  });
});

describe('parseFlashcardStudyReadToolInput', () => {
  it('parses golden catalog / get / operation', () => {
    const catalog = parseFlashcardStudyReadToolInput({
      action: 'catalog',
      query: 'cache',
      limit: 20,
      scopeFilter: { kind: 'deck', deck: 'srs' },
    });
    expect(catalog).toEqual({
      ok: true,
      value: {
        action: 'catalog',
        query: 'cache',
        limit: 20,
        scopeFilter: { kind: 'deck', deck: 'srs' },
      },
    });
    if (catalog.ok) {
      expect(flashcardStudyReadInputToCommand(catalog.value)).toEqual({
        type: 'flashcards/study/catalog',
        query: 'cache',
        limit: 20,
        scopeFilter: { kind: 'deck', deck: 'srs' },
      });
    }

    const get = parseFlashcardStudyReadToolInput({ action: 'get', roundId: 'round-1' });
    expect(get).toEqual({ ok: true, value: { action: 'get', roundId: 'round-1' } });

    const operation = parseFlashcardStudyReadToolInput({
      action: 'operation',
      idempotencyKey: 'op-1',
    });
    expect(operation).toEqual({
      ok: true,
      value: { action: 'operation', idempotencyKey: 'op-1' },
    });
  });

  it('defaults and clamps catalog limit via native parser', () => {
    const omitted = parseFlashcardStudyReadToolInput({ action: 'catalog' });
    expect(omitted).toEqual({ ok: true, value: { action: 'catalog', limit: 50 } });

    const tooBig = parseFlashcardStudyReadToolInput({ action: 'catalog', limit: 10_000 });
    expect(tooBig).toEqual({ ok: true, value: { action: 'catalog', limit: 100 } });

    const zero = parseFlashcardStudyReadToolInput({ action: 'catalog', limit: 0 });
    expect(zero.ok).toBe(false);
  });

  it('rejects unknown actions, authority injection, and unknown fields', () => {
    expect(parseFlashcardStudyReadToolInput({ action: 'next' }).ok).toBe(false);
    expect(parseFlashcardStudyReadToolInput({ action: 'goto' }).ok).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'get',
        roundId: 'round-1',
        controllerIdentity: 'evil',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'get',
        roundId: 'round-1',
        sessionId: 'sess-1',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'get',
        roundId: 'round-1',
        runId: 'run-1',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'get',
        roundId: 'round-1',
        type: 'flashcards/study/get',
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'get',
        roundId: 'round-1',
        extra: true,
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'catalog',
        scopeFilter: { kind: 'all', sneaky: true },
      }).ok,
    ).toBe(false);

    // Scheduled MVP catalog filter: no item/sequence/selection.
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'catalog',
        scopeFilter: { kind: 'item', itemId: 'item-1' },
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyReadToolInput({
        action: 'catalog',
        scopeFilter: { kind: 'sequence', sequenceId: 'seq-1' },
      }).ok,
    ).toBe(false);

    const paddedDeck = parseFlashcardStudyReadToolInput({
      action: 'catalog',
      scopeFilter: { kind: 'deck', deck: ' srs ' },
    });
    expect(paddedDeck.ok).toBe(false);
    if (!paddedDeck.ok) expect(paddedDeck.error).toMatch(/whitespace/i);
  });
});

describe('parseFlashcardStudyWriteToolInput', () => {
  it('parses golden scheduled start and CAS mutations', () => {
    const start = parseFlashcardStudyWriteToolInput({
      action: 'start',
      idempotencyKey: 'start-1',
      scope: { kind: 'all' },
    });
    expect(start).toEqual({
      ok: true,
      value: {
        action: 'start',
        idempotencyKey: 'start-1',
        mode: 'scheduled',
        scope: { kind: 'all' },
        resumeExisting: true,
      },
    });
    if (start.ok) {
      expect(flashcardStudyWriteInputToCommand(start.value)).toEqual({
        id: 'start-1',
        type: 'flashcards/study/start',
        mode: 'scheduled',
        scope: { kind: 'all' },
        resumeExisting: true,
      });
    }

    const startDeck = parseFlashcardStudyWriteToolInput({
      action: 'start',
      idempotencyKey: 'start-deck',
      mode: 'scheduled',
      scope: { kind: 'deck', deck: 'srs' },
      resumeExisting: false,
    });
    expect(startDeck.ok).toBe(true);

    const claim = parseFlashcardStudyWriteToolInput({
      action: 'claim',
      idempotencyKey: 'claim-1',
      roundId: 'round-1',
      expectedRevision: 2,
      expectedControlEpoch: 1,
    });
    expect(claim).toEqual({
      ok: true,
      value: {
        action: 'claim',
        idempotencyKey: 'claim-1',
        roundId: 'round-1',
        expectedRevision: 2,
        expectedControlEpoch: 1,
      },
    });

    const checkpoint = parseFlashcardStudyWriteToolInput({
      action: 'checkpoint',
      idempotencyKey: 'cp-1',
      roundId: 'round-1',
      expectedRevision: 3,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      face: 'answer',
      needsReview: true,
    });
    expect(checkpoint.ok).toBe(true);

    const rate = parseFlashcardStudyWriteToolInput({
      action: 'rate',
      idempotencyKey: 'rate-1',
      roundId: 'round-1',
      expectedRevision: 4,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      rating: 'good',
      expectedReviewStateRevision: 0,
    });
    expect(rate.ok).toBe(true);
    if (rate.ok) {
      const mapped = flashcardStudyWriteInputToCommand(rate.value);
      expect(mapped.type).toBe('flashcards/study/rate');
      expect(mapped.id).toBe('rate-1');
    }

    for (const action of ['undo', 'pause', 'resume', 'end'] as const) {
      const base = {
        action,
        idempotencyKey: `${action}-1`,
        roundId: 'round-1',
        expectedRevision: 5,
        controlEpoch: 1,
        ...(action === 'undo' ? { targetOperationId: 'op-prev' } : {}),
      };
      const parsed = parseFlashcardStudyWriteToolInput(base);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(flashcardStudyWriteInputToCommand(parsed.value).id).toBe(`${action}-1`);
      }
    }
  });

  it('preserves idempotencyKey as native command id on every mutation mapping', () => {
    const claim = parseFlashcardStudyWriteToolInput({
      action: 'claim',
      idempotencyKey: 'claim-map-1',
      roundId: 'round-1',
      expectedRevision: 2,
      expectedControlEpoch: 1,
    });
    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(flashcardStudyWriteInputToCommand(claim.value)).toMatchObject({
        id: 'claim-map-1',
        type: 'flashcards/study/claim',
      });
    }
  });

  it('rejects padded deck names and non-start mode/scope fields', () => {
    const padded = parseFlashcardStudyWriteToolInput({
      action: 'start',
      idempotencyKey: 'deck-pad',
      scope: { kind: 'deck', deck: '  math  ' },
    });
    expect(padded.ok).toBe(false);
    if (!padded.ok) expect(padded.error).toMatch(/whitespace/i);

    const modeOnRate = parseFlashcardStudyWriteToolInput({
      action: 'rate',
      idempotencyKey: 'rate-mode',
      mode: 'scheduled',
      roundId: 'round-1',
      expectedRevision: 1,
      controlEpoch: 1,
      entryId: 'entry-1',
      contentVersion: 'cv-1',
      rating: 'good',
      expectedReviewStateRevision: 0,
    });
    expect(modeOnRate.ok).toBe(false);
    if (!modeOnRate.ok) expect(modeOnRate.error).toMatch(/unknown field mode/i);
  });

  it('rejects missing idempotency / CAS fields', () => {
    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'start',
        scope: { kind: 'all' },
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'rate',
        idempotencyKey: 'rate-1',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
        rating: 'good',
        // missing expectedReviewStateRevision
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'claim',
        idempotencyKey: 'claim-1',
        roundId: 'round-1',
        expectedRevision: 1,
        // missing expectedControlEpoch
      }).ok,
    ).toBe(false);
    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'checkpoint',
        idempotencyKey: 'cp-1',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        entryId: 'entry-1',
        // missing contentVersion + face
      }).ok,
    ).toBe(false);
  });

  it('rejects sequence mode, illegal scopes, next/goto, and authority injection', () => {
    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'start',
        idempotencyKey: 's1',
        mode: 'sequence',
        scope: { kind: 'item', itemId: 'item-1' },
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'start',
        idempotencyKey: 's2',
        mode: 'scheduled',
        scope: { kind: 'item', itemId: 'item-1' },
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'start',
        idempotencyKey: 's3',
        scope: { kind: 'all', principal: 'evil' },
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'next',
        idempotencyKey: 'n1',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'goto',
        idempotencyKey: 'g1',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        entryId: 'entry-1',
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'end',
        idempotencyKey: 'e1',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        controllerIdentity: 'hijack',
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'end',
        idempotencyKey: 'e2',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        runtimeGenerationId: 'gen-1',
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'end',
        idempotencyKey: 'e3',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        principal: 'x',
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'end',
        idempotencyKey: '../bad',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
      }).ok,
    ).toBe(false);

    expect(
      parseFlashcardStudyWriteToolInput({
        action: 'rate',
        idempotencyKey: 'r-bad',
        roundId: 'round-1',
        expectedRevision: 1,
        controlEpoch: 1,
        entryId: 'entry-1',
        contentVersion: 'cv-1',
        rating: 'maybe',
        expectedReviewStateRevision: 0,
      }).ok,
    ).toBe(false);
  });
});
