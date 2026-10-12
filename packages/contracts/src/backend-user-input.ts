/**
 * Bounded native backend user-input request/answer contracts.
 *
 * Pure validators only: no Host pending-request registry, UI, or run lifecycle.
 * Correlation stays on the outer plugin frame (`requestId` / session scope).
 */
import type { BackendOption } from './agent-backend-capabilities.js';

export const BACKEND_USER_INPUT_MAX_QUESTIONS = 8;
export const BACKEND_USER_INPUT_MAX_CHOICES_PER_QUESTION = 20;
export const BACKEND_USER_INPUT_MAX_TITLE_CHARS = 120;
export const BACKEND_USER_INPUT_MAX_ID_CHARS = 128;
export const BACKEND_USER_INPUT_MAX_LABEL_CHARS = 500;
export const BACKEND_USER_INPUT_MAX_DESCRIPTION_CHARS = 2000;
export const BACKEND_USER_INPUT_MAX_TEXT_CHARS = 8000;
export const BACKEND_USER_INPUT_MAX_JSON_BYTES = 64 * 1024;

export type BackendUserInputTextQuestion = {
  id: string;
  prompt: string;
  type: 'text';
  description?: string;
  /** Defaults to true when omitted. */
  required?: boolean;
};

export type BackendUserInputSelectQuestion = {
  id: string;
  prompt: string;
  type: 'select';
  choices: readonly BackendOption[];
  description?: string;
  multiple?: boolean;
  allowOther?: boolean;
  /** Defaults to true when omitted. */
  required?: boolean;
};

export type BackendUserInputQuestion = BackendUserInputTextQuestion | BackendUserInputSelectQuestion;

export type BackendUserInputRequest = {
  title: string;
  questions: readonly BackendUserInputQuestion[];
};

export type BackendUserInputTextAnswer = {
  questionId: string;
  text: string;
};

export type BackendUserInputSelectAnswer = {
  questionId: string;
  optionIds: readonly string[];
  otherText?: string;
};

export type BackendUserInputAnswer = BackendUserInputTextAnswer | BackendUserInputSelectAnswer;

export type BackendUserInputResult =
  | { cancelled: true }
  | { answers: readonly BackendUserInputAnswer[] };

const REQUEST_KEYS = ['title', 'questions'] as const;
const TEXT_QUESTION_KEYS = ['id', 'prompt', 'type', 'description', 'required'] as const;
const SELECT_QUESTION_KEYS = ['id', 'prompt', 'type', 'choices', 'description', 'multiple', 'allowOther', 'required'] as const;
const CHOICE_KEYS = ['id', 'label', 'description'] as const;
const TEXT_ANSWER_KEYS = ['questionId', 'text'] as const;
const SELECT_ANSWER_KEYS = ['questionId', 'optionIds', 'otherText'] as const;
const CANCELLED_RESULT_KEYS = ['cancelled'] as const;
const ANSWERS_RESULT_KEYS = ['answers'] as const;

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function jsonByteLength(value: unknown): number {
  try {
    return textEncoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= BACKEND_USER_INPUT_MAX_ID_CHARS &&
    !/[\0\r\n]/.test(value);
}

function isBoundedText(value: unknown, maxChars: number, allowEmpty = false): value is string {
  return typeof value === 'string' &&
    (allowEmpty ? value.length >= 0 : value.length > 0) &&
    value.length <= maxChars &&
    !value.includes('\0');
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function parseChoice(value: unknown): BackendOption | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, CHOICE_KEYS) ||
      !isBoundedId(value.id) || !isBoundedText(value.label, BACKEND_USER_INPUT_MAX_LABEL_CHARS)) {
    return undefined;
  }
  if (value.description !== undefined &&
      !isBoundedText(value.description, BACKEND_USER_INPUT_MAX_DESCRIPTION_CHARS, true)) {
    return undefined;
  }
  return value.description === undefined
    ? { id: value.id, label: value.label }
    : { id: value.id, label: value.label, description: value.description };
}

function parseQuestion(value: unknown): BackendUserInputQuestion | undefined {
  if (!isRecord(value) || !isBoundedId(value.id) ||
      !isBoundedText(value.prompt, BACKEND_USER_INPUT_MAX_LABEL_CHARS) ||
      !isOptionalBoolean(value.required)) {
    return undefined;
  }
  if (value.description !== undefined &&
      !isBoundedText(value.description, BACKEND_USER_INPUT_MAX_DESCRIPTION_CHARS, true)) {
    return undefined;
  }

  if (value.type === 'text') {
    if (!hasOnlyKeys(value, TEXT_QUESTION_KEYS)) return undefined;
    const question: BackendUserInputTextQuestion = {
      id: value.id,
      prompt: value.prompt,
      type: 'text',
    };
    if (value.description !== undefined) question.description = value.description;
    if (value.required !== undefined) question.required = value.required;
    return question;
  }

  if (value.type !== 'select' || !hasOnlyKeys(value, SELECT_QUESTION_KEYS) ||
      !Array.isArray(value.choices) ||
      value.choices.length === 0 ||
      value.choices.length > BACKEND_USER_INPUT_MAX_CHOICES_PER_QUESTION ||
      !isOptionalBoolean(value.multiple) ||
      !isOptionalBoolean(value.allowOther)) {
    return undefined;
  }

  const choices: BackendOption[] = [];
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  for (const entry of value.choices) {
    const choice = parseChoice(entry);
    if (!choice || seenIds.has(choice.id) || seenLabels.has(choice.label)) {
      return undefined;
    }
    seenIds.add(choice.id);
    seenLabels.add(choice.label);
    choices.push(choice);
  }

  const question: BackendUserInputSelectQuestion = {
    id: value.id,
    prompt: value.prompt,
    type: 'select',
    choices,
  };
  if (value.description !== undefined) question.description = value.description;
  if (value.multiple !== undefined) question.multiple = value.multiple;
  if (value.allowOther !== undefined) question.allowOther = value.allowOther;
  if (value.required !== undefined) question.required = value.required;
  return question;
}

/** Parse a backend user-input request. Unknown keys and oversize payloads fail closed. */
export function parseBackendUserInputRequest(value: unknown): BackendUserInputRequest | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, REQUEST_KEYS) ||
      !isBoundedText(value.title, BACKEND_USER_INPUT_MAX_TITLE_CHARS) ||
      !Array.isArray(value.questions) ||
      value.questions.length === 0 ||
      value.questions.length > BACKEND_USER_INPUT_MAX_QUESTIONS) {
    return undefined;
  }

  const questions: BackendUserInputQuestion[] = [];
  const seenIds = new Set<string>();
  for (const entry of value.questions) {
    const question = parseQuestion(entry);
    if (!question || seenIds.has(question.id)) {
      return undefined;
    }
    seenIds.add(question.id);
    questions.push(question);
  }

  const request: BackendUserInputRequest = { title: value.title, questions };
  if (jsonByteLength(request) > BACKEND_USER_INPUT_MAX_JSON_BYTES) {
    return undefined;
  }
  return request;
}

export function isBackendUserInputRequest(value: unknown): value is BackendUserInputRequest {
  return parseBackendUserInputRequest(value) !== undefined;
}

function isRequired(question: BackendUserInputQuestion): boolean {
  return question.required !== false;
}

function parseAnswerForQuestion(
  value: unknown,
  question: BackendUserInputQuestion,
): BackendUserInputAnswer | undefined {
  if (!isRecord(value) || value.questionId !== question.id) {
    return undefined;
  }

  if (question.type === 'text') {
    if (!hasOnlyKeys(value, TEXT_ANSWER_KEYS) ||
        !isBoundedText(value.text, BACKEND_USER_INPUT_MAX_TEXT_CHARS, !isRequired(question))) {
      return undefined;
    }
    if (isRequired(question) && value.text.trim() === '') {
      return undefined;
    }
    return { questionId: question.id, text: value.text };
  }

  if (!hasOnlyKeys(value, SELECT_ANSWER_KEYS) || !Array.isArray(value.optionIds)) {
    return undefined;
  }
  if (value.otherText !== undefined &&
      (!question.allowOther || !isBoundedText(value.otherText, BACKEND_USER_INPUT_MAX_TEXT_CHARS, true))) {
    return undefined;
  }
  if (value.otherText === undefined && question.allowOther !== true && 'otherText' in value) {
    return undefined;
  }

  const allowed = new Set(question.choices.map((choice) => choice.id));
  const optionIds: string[] = [];
  const seen = new Set<string>();
  for (const optionId of value.optionIds) {
    if (typeof optionId !== 'string' || !allowed.has(optionId) || seen.has(optionId)) {
      return undefined;
    }
    seen.add(optionId);
    optionIds.push(optionId);
  }

  if (question.multiple !== true && optionIds.length > 1) {
    return undefined;
  }

  const hasOther = typeof value.otherText === 'string' && value.otherText.trim() !== '';
  if (isRequired(question) && optionIds.length === 0 && !hasOther) {
    return undefined;
  }
  if (!isRequired(question) && optionIds.length === 0 && value.otherText !== undefined &&
      value.otherText.trim() === '' && !question.allowOther) {
    return undefined;
  }

  const answer: BackendUserInputSelectAnswer = { questionId: question.id, optionIds };
  if (value.otherText !== undefined) {
    answer.otherText = value.otherText;
  }
  return answer;
}

/**
 * Parse a result against the request that produced it.
 * Selected option ids are preserved verbatim; types must match the question.
 */
export function parseBackendUserInputResult(
  value: unknown,
  request: BackendUserInputRequest,
): BackendUserInputResult | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.cancelled === true) {
    if (!hasOnlyKeys(value, CANCELLED_RESULT_KEYS)) {
      return undefined;
    }
    const result: BackendUserInputResult = { cancelled: true };
    if (jsonByteLength(result) > BACKEND_USER_INPUT_MAX_JSON_BYTES) {
      return undefined;
    }
    return result;
  }

  if (!hasOnlyKeys(value, ANSWERS_RESULT_KEYS) || !Array.isArray(value.answers) ||
      value.answers.length !== request.questions.length) {
    return undefined;
  }

  const answers: BackendUserInputAnswer[] = [];
  const seenQuestionIds = new Set<string>();
  for (let index = 0; index < request.questions.length; index += 1) {
    const question = request.questions[index]!;
    const answer = parseAnswerForQuestion(value.answers[index], question);
    if (!answer || seenQuestionIds.has(answer.questionId)) {
      return undefined;
    }
    seenQuestionIds.add(answer.questionId);
    answers.push(answer);
  }

  if (seenQuestionIds.size !== request.questions.length) {
    return undefined;
  }

  const result: BackendUserInputResult = { answers };
  if (jsonByteLength(result) > BACKEND_USER_INPUT_MAX_JSON_BYTES) {
    return undefined;
  }
  return result;
}

export function isBackendUserInputResult(
  value: unknown,
  request: BackendUserInputRequest,
): value is BackendUserInputResult {
  return parseBackendUserInputResult(value, request) !== undefined;
}
