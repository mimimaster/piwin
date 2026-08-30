/**
 * CLI flashcard study verbs (spec §10). Same Host protocol as Desktop/Mobile.
 * No local CardStore / StudyService, no tear animation, no touch.
 */
import type {
  FlashcardStudyCatalogPage,
  FlashcardStudyFace,
  FlashcardStudyHostCommand,
  FlashcardStudyMode,
  FlashcardStudyOperationResult,
  FlashcardStudyScope,
  FlashcardStudySnapshot,
  HostCommand,
  HostResponse,
  HostStatusData,
  ReviewRating,
} from '@piwin/contracts';
import {
  FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT,
  hostSupportsFlashcardStudy,
  isFlashcardStudyId,
  parseFlashcardStudyScope,
  remoteCommandRequiresIdempotencyKey,
} from '@piwin/contracts';
import { createIdempotencyKey } from '@piwin/host-client';

export const STUDY_VERBS = [
  'catalog',
  'start',
  'get',
  'claim',
  'checkpoint',
  'next',
  'rate',
  'undo',
  'pause',
  'resume',
  'end',
  'operation',
] as const;

export type StudyVerb = (typeof STUDY_VERBS)[number];

export const CLI_STUDY_NO_MOTION_NOTICE =
  'CLI study has no tear animation and no touch. Progress is the Host snapshot (revision, counts, current entry).';

export const CLI_STUDY_USAGE = `Usage:
  piwin study catalog [--query q] [--cursor c] [--limit n] [--deck d | --all]
  piwin study start sequence --item <id> | --sequence <id> | --parent-round <id> --items a,b [--no-resume]
  piwin study start scheduled [--deck d] [--no-resume]
  piwin study get <roundId>
  piwin study claim <roundId> --revision n --epoch n
  piwin study checkpoint <roundId> --revision n --epoch n --entry id --content-version v --face question|answer [--needs-review]
  piwin study next <roundId> --revision n --epoch n --entry id --content-version v
  piwin study rate <roundId> --revision n --epoch n --entry id --content-version v --rating again|hard|good|easy --review-revision n
  piwin study undo <roundId> --revision n --epoch n --operation id
  piwin study pause|resume|end <roundId> --revision n --epoch n
  piwin study operation <idempotency-key>

claim is explicit (get/start never take control).
checkpoint is the explicit reveal / needs-review path; rate is accepted on the answer face.
${CLI_STUDY_NO_MOTION_NOTICE}`;

export type StudyHostRequestOptions = { idempotencyKey?: string };

export type StudyHostClient = {
  handleCommand: (
    command: HostCommand,
    options?: StudyHostRequestOptions,
  ) => Promise<HostResponse>;
  dispose: () => Promise<void>;
};

export type StudyHostHandle = {
  handleCommand: StudyHostClient['handleCommand'];
  dispose: () => Promise<void>;
};

/** Keep caller-owned idempotency keys. Do not wrap as `(command) => host.handleCommand(command)`. */
export function bindStudyHostClient(host: StudyHostHandle): StudyHostClient {
  return {
    handleCommand: (command, options) => host.handleCommand(command, options),
    dispose: () => host.dispose(),
  };
}

const VALUE_OPTIONS = [
  '--query',
  '--cursor',
  '--limit',
  '--deck',
  '--item',
  '--sequence',
  '--parent-round',
  '--items',
  '--revision',
  '--epoch',
  '--entry',
  '--content-version',
  '--face',
  '--rating',
  '--review-revision',
  '--operation',
  '--idempotency-key',
  '--mode',
  '--needs-review',
] as const;

const RATINGS: ReadonlySet<string> = new Set(['again', 'hard', 'good', 'easy']);
const FACES: ReadonlySet<string> = new Set(['question', 'answer']);

export function formatStudyCatalogPage(page: FlashcardStudyCatalogPage): string {
  const lines = [
    CLI_STUDY_NO_MOTION_NOTICE,
    `due=${page.dueCount}\tnew=${page.newCount}`,
  ];
  if (page.unfinishedRounds.length === 0) {
    lines.push('unfinished\t(none)');
  } else {
    for (const round of page.unfinishedRounds) {
      lines.push(
        `unfinished\t${round.roundId}\t${round.status}\t${round.mode}\trev=${round.revision}\tremaining=${round.counts.remaining}`,
      );
    }
  }
  if (page.tiles.length === 0) {
    lines.push('tile\t(none)');
  } else {
    for (const tile of page.tiles) {
      const preview = tile.preview.replaceAll('\n', ' ').slice(0, 80);
      lines.push(`tile\t${tile.kind}\t${tile.id}\t${tile.count}\t${preview}`);
    }
  }
  if (page.nextCursor) lines.push(`nextCursor\t${page.nextCursor}`);
  return lines.join('\n');
}

export function formatStudySnapshot(
  snapshot: FlashcardStudySnapshot,
  extras?: { idempotencyKey?: string },
): string {
  const round = snapshot.round;
  const counts = snapshot.counts;
  const current = snapshot.current;
  const lines = [
    CLI_STUDY_NO_MOTION_NOTICE,
    `round\t${round.roundId}\trev=${round.revision}\tepoch=${round.controlEpoch}\tstatus=${round.status}\tmode=${round.mode}\tface=${round.face}`,
    `counts\ttotal=${counts.total}\tprocessed=${counts.processed}\tremaining=${counts.remaining}\tinvalidated=${counts.invalidated}`,
  ];
  if (current) {
    lines.push(
      `current\tentry=${current.entryId}\titem=${current.itemId}\tface=${current.face}\tneedsReview=${current.needsReview ? 'yes' : 'no'}\tcontentVersion=${current.contentVersion}`,
    );
  } else {
    lines.push('current\t(none)');
  }
  const control = snapshot.access.hasControl ? 'yes' : 'no';
  lines.push(`access\tcontrol=${control}\tcontroller=${snapshot.access.controllerIdentity}`);
  if (!snapshot.access.hasControl) {
    lines.push(
      `claim is explicit: run piwin study claim ${round.roundId} --revision ${round.revision} --epoch ${round.controlEpoch}`,
    );
  }
  lines.push(`canUndo=${snapshot.canUndo ? 'yes' : 'no'}`);
  if (round.lastAdvanceOperationId) {
    lines.push(`lastAdvance\t${round.lastAdvanceOperationId}`);
  }
  if (extras?.idempotencyKey) {
    lines.push(`idempotencyKey\t${extras.idempotencyKey}`);
  }
  if (current) {
    lines.push('front:');
    lines.push(current.front);
    if (current.face === 'answer' && current.back !== undefined) {
      lines.push('back:');
      lines.push(current.back);
    } else if (round.mode === 'scheduled') {
      lines.push('rate requires the answer face: piwin study checkpoint … --face answer');
    }
  }
  return lines.join('\n');
}

export function formatStudyOperation(result: FlashcardStudyOperationResult): string {
  if (result.status === 'not-found') {
    return `${CLI_STUDY_NO_MOTION_NOTICE}\noperation\tnot-found`;
  }
  if (result.status === 'rejected') {
    return `${CLI_STUDY_NO_MOTION_NOTICE}\noperation\trejected\t${result.code}\t${result.error}`;
  }
  return `${formatStudySnapshot(result.snapshot)}\noperation\tsuccess`;
}

export async function runStudyCommand(
  client: StudyHostClient,
  argv: string[],
  log: (line: string) => void,
  options?: { createIdempotencyKey?: () => string },
): Promise<void> {
  const verb = firstPositional(argv);
  if (verb === undefined || verb === 'help' || verb === '--help' || verb === '-h') {
    throw new Error(CLI_STUDY_USAGE);
  }
  if (!isStudyVerb(verb)) {
    throw new Error(`Unknown study verb: ${verb}\n${CLI_STUDY_USAGE}`);
  }
  await requireStudyCapability(client);
  const command = buildStudyCommand(verb, argv);
  const key = mutationKey(command, argv, options?.createIdempotencyKey ?? createIdempotencyKey);
  const response = await client.handleCommand(
    command,
    key === undefined ? undefined : { idempotencyKey: key },
  );
  if (!response.success) {
    throw new Error(formatStudyFailure(verb, response));
  }
  log(formatStudySuccess(verb, response.data, key));
}

function isStudyVerb(value: string): value is StudyVerb {
  return (STUDY_VERBS as readonly string[]).includes(value);
}

async function requireStudyCapability(client: StudyHostClient): Promise<void> {
  const response = await client.handleCommand({ type: 'host/status' });
  if (!response.success) {
    throw new Error(response.error);
  }
  const data = response.data as HostStatusData | undefined;
  if (!hostSupportsFlashcardStudy(data?.capabilities)) {
    throw new Error('Host does not support flashcards/study (需要更新 Host).');
  }
}

function buildStudyCommand(verb: StudyVerb, argv: string[]): HostCommand {
  switch (verb) {
    case 'catalog':
      return buildCatalog(argv);
    case 'start':
      return buildStart(argv);
    case 'get':
      return { type: 'flashcards/study/get', roundId: requireStudyId(requireRoundId(argv), 'roundId') };
    case 'claim':
      return {
        type: 'flashcards/study/claim',
        roundId: requireStudyId(requireRoundId(argv), 'roundId'),
        expectedRevision: requireInt(argv, '--revision', 'revision'),
        expectedControlEpoch: requireInt(argv, '--epoch', 'epoch'),
      };
    case 'checkpoint':
      return buildCheckpoint(argv);
    case 'next':
      return { type: 'flashcards/study/next', ...advanceBase(argv) };
    case 'rate':
      return {
        type: 'flashcards/study/rate',
        ...advanceBase(argv),
        rating: requireRating(argv),
        expectedReviewStateRevision: requireInt(argv, '--review-revision', 'review-revision'),
      };
    case 'undo':
      return {
        type: 'flashcards/study/undo',
        roundId: requireStudyId(requireRoundId(argv), 'roundId'),
        expectedRevision: requireInt(argv, '--revision', 'revision'),
        controlEpoch: requireInt(argv, '--epoch', 'epoch'),
        targetOperationId: requireStudyId(requireOption(argv, '--operation', 'operation'), 'operation'),
      };
    case 'pause':
    case 'resume':
    case 'end':
      return {
        type: `flashcards/study/${verb}`,
        roundId: requireStudyId(requireRoundId(argv), 'roundId'),
        expectedRevision: requireInt(argv, '--revision', 'revision'),
        controlEpoch: requireInt(argv, '--epoch', 'epoch'),
      };
    case 'operation':
      return {
        type: 'flashcards/study/operation',
        idempotencyKey: requireStudyId(requireRoundId(argv, 'idempotency-key'), 'idempotencyKey'),
      };
  }
}

function buildCatalog(argv: string[]): Extract<FlashcardStudyHostCommand, { type: 'flashcards/study/catalog' }> {
  const limitRaw = readOption(argv, '--limit');
  const limit =
    limitRaw === undefined ? FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT : parsePositiveInt(limitRaw, 'limit');
  const query = readOption(argv, '--query');
  const cursor = readOption(argv, '--cursor');
  const scopeFilter = parseCatalogScope(argv);
  const command: Extract<FlashcardStudyHostCommand, { type: 'flashcards/study/catalog' }> = {
    type: 'flashcards/study/catalog',
    limit,
  };
  if (query !== undefined) command.query = query;
  if (cursor !== undefined) command.cursor = requireStudyId(cursor, 'cursor');
  if (scopeFilter) command.scopeFilter = scopeFilter;
  return command;
}

function parseCatalogScope(argv: string[]): FlashcardStudyScope | undefined {
  const deck = readOption(argv, '--deck');
  if (hasFlag(argv, '--all') && deck) {
    throw new Error('catalog accepts --deck or --all, not both');
  }
  if (hasFlag(argv, '--all')) return { kind: 'all' };
  if (deck) return requireScope({ kind: 'deck', deck });
  return undefined;
}

function buildStart(argv: string[]): Extract<FlashcardStudyHostCommand, { type: 'flashcards/study/start' }> {
  const mode = parseStartMode(argv);
  return {
    type: 'flashcards/study/start',
    mode,
    scope: parseStartScope(mode, argv),
    resumeExisting: !hasFlag(argv, '--no-resume'),
  };
}

function parseStartMode(argv: string[]): FlashcardStudyMode {
  const tokens = positionals(argv);
  const token = tokens[1];
  if (token === 'sequence' || token === 'scheduled') return token;
  throw new Error(`start requires sequence or scheduled\n${CLI_STUDY_USAGE}`);
}

function parseStartScope(mode: FlashcardStudyMode, argv: string[]): FlashcardStudyScope {
  if (mode === 'scheduled') {
    const deck = readOption(argv, '--deck');
    return deck ? requireScope({ kind: 'deck', deck }) : { kind: 'all' };
  }
  const itemId = readOption(argv, '--item');
  const sequenceId = readOption(argv, '--sequence');
  const parentRoundId = readOption(argv, '--parent-round');
  const itemsRaw = readOption(argv, '--items');
  if (itemId && !sequenceId && !parentRoundId) {
    return requireScope({ kind: 'item', itemId });
  }
  if (sequenceId && !itemId && !parentRoundId) {
    return requireScope({ kind: 'sequence', sequenceId });
  }
  if (parentRoundId && itemsRaw && !itemId && !sequenceId) {
    const itemIds = itemsRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return requireScope({ kind: 'selection', parentRoundId, itemIds });
  }
  throw new Error(
    'start sequence requires --item <id>, --sequence <id>, or --parent-round <id> --items a,b',
  );
}

function buildCheckpoint(
  argv: string[],
): Extract<FlashcardStudyHostCommand, { type: 'flashcards/study/checkpoint' }> {
  const faceRaw = requireOption(argv, '--face', 'face');
  if (!isFace(faceRaw)) {
    throw new Error('checkpoint --face must be question or answer');
  }
  const needsReview = readOptionalBoolean(argv, '--needs-review');
  const command: Extract<FlashcardStudyHostCommand, { type: 'flashcards/study/checkpoint' }> = {
    type: 'flashcards/study/checkpoint',
    ...advanceBase(argv),
    face: faceRaw,
  };
  if (needsReview !== undefined) command.needsReview = needsReview;
  return command;
}

function advanceBase(argv: string[]): {
  roundId: string;
  expectedRevision: number;
  controlEpoch: number;
  entryId: string;
  contentVersion: string;
} {
  return {
    roundId: requireStudyId(requireRoundId(argv), 'roundId'),
    expectedRevision: requireInt(argv, '--revision', 'revision'),
    controlEpoch: requireInt(argv, '--epoch', 'epoch'),
    entryId: requireStudyId(requireOption(argv, '--entry', 'entry'), 'entryId'),
    contentVersion: requireStudyId(requireOption(argv, '--content-version', 'content-version'), 'contentVersion'),
  };
}

function mutationKey(
  command: HostCommand,
  argv: string[],
  createKey: () => string,
): string | undefined {
  if (!remoteCommandRequiresIdempotencyKey(command.type)) return undefined;
  const provided = readOption(argv, '--idempotency-key');
  if (provided !== undefined) return requireStudyId(provided, 'idempotencyKey');
  return createKey();
}

function formatStudySuccess(verb: StudyVerb, data: unknown, key: string | undefined): string {
  if (verb === 'catalog') {
    return formatStudyCatalogPage(data as FlashcardStudyCatalogPage);
  }
  if (verb === 'operation') {
    return formatStudyOperation(data as FlashcardStudyOperationResult);
  }
  return formatStudySnapshot(data as FlashcardStudySnapshot, key ? { idempotencyKey: key } : undefined);
}

function formatStudyFailure(verb: StudyVerb, response: Extract<HostResponse, { success: false }>): string {
  const code = response.problem?.code;
  const base = code ? `${code}: ${response.error}` : response.error;
  if (verb === 'rate') {
    return `${base}\nUse checkpoint --face answer to reveal before rate. ${CLI_STUDY_NO_MOTION_NOTICE}`;
  }
  return base;
}

function requireScope(value: unknown): FlashcardStudyScope {
  const parsed = parseFlashcardStudyScope(value);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function requireRoundId(argv: string[], label = 'roundId'): string {
  const tokens = positionals(argv);
  const id = tokens[1];
  if (!id) throw new Error(`Missing ${label}\n${CLI_STUDY_USAGE}`);
  return id;
}

function requireStudyId(value: string, label: string): string {
  if (!isFlashcardStudyId(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function requireOption(argv: string[], flag: string, label: string): string {
  const value = readOption(argv, flag);
  if (value === undefined) throw new Error(`Missing ${flag}\n${CLI_STUDY_USAGE}`);
  return value;
}

function requireInt(argv: string[], flag: string, label: string): number {
  return parseNonNegativeInt(requireOption(argv, flag, label), label);
}

function requireRating(argv: string[]): ReviewRating {
  const value = requireOption(argv, '--rating', 'rating');
  if (!isRating(value)) throw new Error('rate --rating must be again|hard|good|easy');
  return value;
}

function isRating(value: string): value is ReviewRating {
  return RATINGS.has(value);
}

function isFace(value: string): value is FlashcardStudyFace {
  return FACES.has(value);
}

function parseNonNegativeInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = parseNonNegativeInt(value, label);
  if (parsed <= 0) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function readOptionalBoolean(argv: string[], flag: string): boolean | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('--')) return true;
  if (next === 'true' || next === 'yes' || next === '1') return true;
  if (next === 'false' || next === 'no' || next === '0') return false;
  throw new Error(`${flag} must be true or false`);
}

function firstPositional(argv: string[]): string | undefined {
  return positionals(argv)[0];
}

function positionals(argv: string[]): string[] {
  const tokens: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (token.startsWith('--')) {
      if (isValueOption(token) && argv[index + 1] !== undefined && !argv[index + 1]?.startsWith('--')) {
        index += 1;
      }
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function isValueOption(token: string): boolean {
  return (VALUE_OPTIONS as readonly string[]).includes(token);
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}
