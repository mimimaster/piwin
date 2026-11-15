/**
 * Ask the user structured questions through Pi's native Extension UI.
 * @piwin-bundled-extension
 *
 * Loaded by Pi jiti as a product extension under ~/.piwin/extensions.
 * Disable via config.extensions.disabledIds: ["questionnaire"].
 */

export type QuestionnaireAnswer = {
  id: string;
  value: string;
};

export type QuestionnaireDetails = {
  answers: QuestionnaireAnswer[];
  cancelled: boolean;
};

export type QuestionnaireResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: QuestionnaireDetails;
};

export type QuestionnaireExtensionUi = {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
};

export type ExtensionContext = {
  hasUI: boolean;
  ui: QuestionnaireExtensionUi;
};

export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
  minItems?: number;
  minLength?: number;
};

export type RegisteredTool = {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown | undefined,
    context: ExtensionContext,
  ) => Promise<QuestionnaireResult>;
};

export type ExtensionApi = {
  registerTool: (tool: RegisteredTool) => void;
};

type QuestionnaireQuestion = {
  id: string;
  prompt: string;
  options: string[];
  allowOther?: boolean;
};

type ParsedQuestions =
  | { questions: QuestionnaireQuestion[] }
  | { error: string };

const OTHER_OPTION = 'Other';

export const QUESTIONNAIRE_PARAMETERS: JsonSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Questions to ask in order.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Stable answer identifier.',
            minLength: 1,
          },
          prompt: {
            type: 'string',
            description: 'Question shown to the user.',
            minLength: 1,
          },
          options: {
            type: 'array',
            description: 'Choices shown by the selector.',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
          allowOther: {
            type: 'boolean',
            description: 'Add an Other choice that accepts free-form text.',
          },
        },
        required: ['id', 'prompt', 'options'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

export default function questionnaireExtension(pi: ExtensionApi): void {
  pi.registerTool({
    name: 'questionnaire',
    label: 'Questionnaire',
    description: 'Ask the user one or more questions and use the selected answers.',
    parameters: QUESTIONNAIRE_PARAMETERS,
    async execute(_toolCallId, params, _signal, _onUpdate, context) {
      if (context.hasUI === false) {
        return unavailableResult();
      }

      const parsed = parseQuestions(params);
      if ('error' in parsed) {
        return invalidResult(parsed.error);
      }

      const answers: QuestionnaireAnswer[] = [];
      for (const question of parsed.questions) {
        const options = question.allowOther
          ? [...question.options, OTHER_OPTION]
          : question.options;
        const selected = await context.ui.select(question.prompt, options);
        if (selected === undefined) {
          return cancelledResult(answers);
        }

        if (question.allowOther && selected === OTHER_OPTION) {
          const custom = await context.ui.input(
            `Response for: ${question.prompt}`,
            'Type your answer',
          );
          if (custom === undefined || custom.trim().length === 0) {
            return cancelledResult(answers);
          }
          answers.push({ id: question.id, value: custom.trim() });
          continue;
        }

        answers.push({ id: question.id, value: selected });
      }

      return successResult(answers);
    },
  });
}

function parseQuestions(params: unknown): ParsedQuestions {
  if (!isRecord(params)) {
    return { error: 'Invalid questionnaire parameters' };
  }

  const rawQuestions = params.questions;
  if (!Array.isArray(rawQuestions)) {
    return { error: 'Invalid questionnaire parameters: questions must be an array' };
  }
  if (rawQuestions.length === 0) {
    return { error: 'No questions provided' };
  }

  const questions: QuestionnaireQuestion[] = [];
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const question = parseQuestion(rawQuestions[index]);
    if (question === undefined) {
      return { error: `Invalid questionnaire question at index ${index}` };
    }
    questions.push(question);
  }
  return { questions };
}

function parseQuestion(value: unknown): QuestionnaireQuestion | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readNonEmptyString(value.id);
  const prompt = readNonEmptyString(value.prompt);
  const rawOptions = value.options;
  if (id === undefined || prompt === undefined || !Array.isArray(rawOptions)) {
    return undefined;
  }

  const options: string[] = [];
  for (const rawOption of rawOptions) {
    const option = readNonEmptyString(rawOption);
    if (option === undefined) {
      return undefined;
    }
    options.push(option);
  }
  if (options.length === 0) {
    return undefined;
  }

  const rawAllowOther = value.allowOther;
  if (rawAllowOther !== undefined && typeof rawAllowOther !== 'boolean') {
    return undefined;
  }
  if (rawAllowOther !== undefined) {
    return { id, prompt, options, allowOther: rawAllowOther };
  }
  return { id, prompt, options };
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function successResult(answers: QuestionnaireAnswer[]): QuestionnaireResult {
  return createResult({ answers, cancelled: false });
}

function cancelledResult(answers: QuestionnaireAnswer[]): QuestionnaireResult {
  return createResult({ answers, cancelled: true });
}

function unavailableResult(): QuestionnaireResult {
  return createResult(
    { answers: [], cancelled: true },
    'Questionnaire UI is unavailable',
  );
}

function invalidResult(message: string): QuestionnaireResult {
  return createResult({ answers: [], cancelled: true }, message);
}

function createResult(
  details: QuestionnaireDetails,
  message?: string,
): QuestionnaireResult {
  const serialized = JSON.stringify(details);
  const text = message === undefined ? serialized : `${message}: ${serialized}`;
  return {
    content: [{ type: 'text', text }],
    details,
  };
}
