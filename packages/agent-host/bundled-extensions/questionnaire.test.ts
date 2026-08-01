import { describe, expect, it } from 'vitest';
import questionnaireExtension, {
  type ExtensionContext,
  type QuestionnaireExtensionUi,
  type RegisteredTool,
} from './questionnaire.js';

function registeredQuestionnaire(): RegisteredTool {
  const registrations: RegisteredTool[] = [];
  questionnaireExtension({ registerTool: (tool) => registrations.push(tool) });
  const registration = registrations[0];
  if (registration === undefined) {
    throw new Error('questionnaire tool was not registered');
  }
  return registration;
}

function interactiveContext(ui: QuestionnaireExtensionUi): ExtensionContext {
  return { hasUI: true, ui };
}

describe('bundled questionnaire extension', () => {
  it('registers a JSON-schema-shaped questionnaire tool', () => {
    const tool = registeredQuestionnaire();

    expect(tool.name).toBe('questionnaire');
    expect(tool.label).toBe('Questionnaire');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'prompt', 'options'],
          },
        },
      },
    });
  });

  it('returns selected answers from a sequential UI flow', async () => {
    const tool = registeredQuestionnaire();
    const selectedTitles: string[] = [];
    const selectedOptions: string[][] = [];
    const ui: QuestionnaireExtensionUi = {
      select: async (title, options) => {
        selectedTitles.push(title);
        selectedOptions.push(options);
        return title === 'Choose scope' ? 'project' : 'global';
      },
      input: async () => undefined,
    };

    const result = await tool.execute(
      'tool-1',
      {
        questions: [
          { id: 'scope', prompt: 'Choose scope', options: ['project', 'global'] },
          { id: 'visibility', prompt: 'Choose visibility', options: ['global', 'private'] },
        ],
      },
      undefined,
      undefined,
      interactiveContext(ui),
    );

    expect(selectedTitles).toEqual(['Choose scope', 'Choose visibility']);
    expect(selectedOptions).toEqual([
      ['project', 'global'],
      ['global', 'private'],
    ]);
    expect(result.content[0]?.text).toContain('project');
    expect(result.details).toEqual({
      answers: [
        { id: 'scope', value: 'project' },
        { id: 'visibility', value: 'global' },
      ],
      cancelled: false,
    });
  });

  it('asks for free-form text when Other is selected', async () => {
    const tool = registeredQuestionnaire();
    const selectedOptions: string[][] = [];
    const inputRequests: Array<{ title: string; placeholder: string | undefined }> = [];
    const ui: QuestionnaireExtensionUi = {
      select: async (_title, options) => {
        selectedOptions.push(options);
        return 'Other';
      },
      input: async (title, placeholder) => {
        inputRequests.push({ title, placeholder });
        return '  custom response  ';
      },
    };

    const result = await tool.execute(
      'tool-2',
      {
        questions: [
          {
            id: 'scope',
            prompt: 'Choose scope',
            options: ['project', 'global'],
            allowOther: true,
          },
        ],
      },
      undefined,
      undefined,
      interactiveContext(ui),
    );

    expect(selectedOptions).toEqual([['project', 'global', 'Other']]);
    expect(inputRequests).toEqual([
      { title: 'Response for: Choose scope', placeholder: 'Type your answer' },
    ]);
    expect(result.details).toEqual({
      answers: [{ id: 'scope', value: 'custom response' }],
      cancelled: false,
    });
  });

  it('returns partial answers when a selection is cancelled', async () => {
    const tool = registeredQuestionnaire();
    let selectionCount = 0;
    const ui: QuestionnaireExtensionUi = {
      select: async () => {
        selectionCount += 1;
        return selectionCount === 1 ? 'project' : undefined;
      },
      input: async () => undefined,
    };

    const result = await tool.execute(
      'tool-3',
      {
        questions: [
          { id: 'scope', prompt: 'Choose scope', options: ['project', 'global'] },
          { id: 'visibility', prompt: 'Choose visibility', options: ['global', 'private'] },
        ],
      },
      undefined,
      undefined,
      interactiveContext(ui),
    );

    expect(result.details).toEqual({
      answers: [{ id: 'scope', value: 'project' }],
      cancelled: true,
    });
  });

  it('treats cancelled or blank Other input as cancellation', async () => {
    const tool = registeredQuestionnaire();
    const ui: QuestionnaireExtensionUi = {
      select: async () => 'Other',
      input: async () => '   ',
    };

    const result = await tool.execute(
      'tool-4',
      {
        questions: [
          { id: 'scope', prompt: 'Choose scope', options: ['project'], allowOther: true },
        ],
      },
      undefined,
      undefined,
      interactiveContext(ui),
    );

    expect(result.details).toEqual({ answers: [], cancelled: true });
  });

  it('returns an unavailable result when UI is not available', async () => {
    const tool = registeredQuestionnaire();
    const context: ExtensionContext = {
      hasUI: false,
      ui: {
        select: async () => 'unexpected',
        input: async () => 'unexpected',
      },
    };

    const result = await tool.execute(
      'tool-5',
      { questions: [{ id: 'scope', prompt: 'Choose scope', options: ['project'] }] },
      undefined,
      undefined,
      context,
    );

    expect(result.content[0]?.text).toContain('unavailable');
    expect(result.details).toEqual({ answers: [], cancelled: true });
  });

  it('returns a structured invalid result for malformed input', async () => {
    const tool = registeredQuestionnaire();

    const result = await tool.execute(
      'tool-6',
      { questions: [{ id: 'scope', prompt: 'Choose scope', options: [42] }] },
      undefined,
      undefined,
      interactiveContext({
        select: async () => 'project',
        input: async () => undefined,
      }),
    );

    expect(result.content[0]?.text).toContain('Invalid questionnaire');
    expect(result.details).toEqual({ answers: [], cancelled: true });
  });
});
