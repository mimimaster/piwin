import {
  partitionRemoteSettingsMutations,
  type ApplySettingsInput,
  type NotesConfig,
  type PiwinConfig,
  type SettingsDomain,
  type SettingsMutation,
  type SettingsSnapshot,
} from '@piwin/contracts';

function domainRevisionHash(
  domainRevisions: SettingsSnapshot['domainRevisions'] | undefined,
  domain: SettingsDomain,
): string | undefined {
  const hash = domainRevisions?.[domain];
  if (typeof hash !== 'string' || hash.length === 0 || hash.length > 256) {
    return undefined;
  }
  return hash;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function knowledgeExtrasFromValue(value: unknown): NotesConfig['knowledgeExtras'] {
  const record = asRecord(value);
  if (!record) return undefined;
  const parser =
    record.parser && typeof record.parser === 'object' && !Array.isArray(record.parser)
      ? (record.parser as NonNullable<NotesConfig['knowledgeExtras']>['parser'])
      : undefined;
  const reranker =
    record.reranker && typeof record.reranker === 'object' && !Array.isArray(record.reranker)
      ? (record.reranker as NonNullable<NotesConfig['knowledgeExtras']>['reranker'])
      : undefined;
  const extractionLlm =
    record.extractionLlm &&
    typeof record.extractionLlm === 'object' &&
    !Array.isArray(record.extractionLlm)
      ? (record.extractionLlm as NonNullable<NotesConfig['knowledgeExtras']>['extractionLlm'])
      : undefined;
  const flashcardLlm =
    record.flashcardLlm &&
    typeof record.flashcardLlm === 'object' &&
    !Array.isArray(record.flashcardLlm)
      ? (record.flashcardLlm as NonNullable<NotesConfig['knowledgeExtras']>['flashcardLlm'])
      : undefined;
  const extras: NonNullable<NotesConfig['knowledgeExtras']> = {
    ...(parser === undefined ? {} : { parser }),
    ...(reranker === undefined ? {} : { reranker }),
    ...(extractionLlm === undefined ? {} : { extractionLlm }),
    ...(flashcardLlm === undefined ? {} : { flashcardLlm }),
  };
  return Object.keys(extras).length > 0 ? extras : undefined;
}

function mergeKnowledgeIntoNotes(
  kept: SettingsMutation[],
  knowledgeValue: unknown,
  currentNotes: PiwinConfig['notes'] | undefined,
): SettingsMutation[] {
  const extras = knowledgeExtrasFromValue(knowledgeValue);
  if (extras === undefined) {
    return kept;
  }
  const notesIndex = kept.findIndex((mutation) => mutation.domain === 'notes');
  const base =
    notesIndex >= 0
      ? (asRecord(kept[notesIndex]?.value) ?? {})
      : currentNotes
        ? { ...currentNotes }
        : {};
  const notesMutation: SettingsMutation = {
    kind: 'replace-domain',
    domain: 'notes',
    value: { ...base, knowledgeExtras: extras },
  };
  if (notesIndex >= 0) {
    const next = [...kept];
    next[notesIndex] = notesMutation;
    return next;
  }
  return [...kept, notesMutation];
}

/**
 * Remote `settings/apply` admission requires a CAS hash per mutated domain.
 * Hosts that predate `knowledge` omit that hash; sending it rejects the whole
 * payload. Fold reranker / parsers / LLMs onto notes, which those Hosts persist.
 */
export function settingsMutationsAdmittedByRemoteSnapshot(
  mutations: SettingsMutation[],
  domainRevisions: SettingsSnapshot['domainRevisions'] | undefined,
  currentNotes?: PiwinConfig['notes'],
): SettingsMutation[] {
  const allowed = partitionRemoteSettingsMutations(mutations).allowed;
  const kept: SettingsMutation[] = [];
  let droppedKnowledge: unknown;
  for (const mutation of allowed) {
    if (domainRevisionHash(domainRevisions, mutation.domain) !== undefined) {
      kept.push(mutation);
    } else if (mutation.domain === 'knowledge') {
      droppedKnowledge = mutation.value;
    }
  }
  if (
    droppedKnowledge !== undefined &&
    domainRevisionHash(domainRevisions, 'notes') !== undefined
  ) {
    return mergeKnowledgeIntoNotes(kept, droppedKnowledge, currentNotes);
  }
  return kept;
}

export function settingsApplyInputFromSnapshot(
  snapshot: Pick<SettingsSnapshot, 'revision' | 'domainRevisions'>,
  mutations: SettingsMutation[],
): ApplySettingsInput {
  const expectedDomainRevisions: Partial<Record<SettingsDomain, string>> = {};
  for (const mutation of mutations) {
    const hash = domainRevisionHash(snapshot.domainRevisions, mutation.domain);
    if (hash !== undefined) {
      expectedDomainRevisions[mutation.domain] = hash;
    }
  }
  return {
    expectedRevision: snapshot.revision,
    mutations,
    expectedDomainRevisions,
  };
}
