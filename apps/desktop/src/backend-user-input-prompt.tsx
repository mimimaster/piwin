/**
 * Bounded native backend questions (select/text). Not a permission gate and
 * not vendor-supplied UI — option ids are returned verbatim.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type {
  BackendUserInputAnswer,
  BackendUserInputQuestion,
  BackendUserInputRequest,
  BackendUserInputResult,
} from '@piwin/contracts';
import { parseBackendUserInputResult } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { AgentInterruptionFrame } from './agent-interruption-frame.js';
import { useDesktopLocale } from './desktop-locale-context.js';
import { getBehaviorActivitySpec } from './behavior-activity.js';

export type BackendUserInputPromptProps = {
  request: BackendUserInputRequest | null;
  onResolve: (result: BackendUserInputResult) => void;
};

type Draft = {
  text: Record<string, string>;
  optionIds: Record<string, string[]>;
  otherText: Record<string, string>;
};

function emptyDraft(): Draft {
  return { text: {}, optionIds: {}, otherText: {} };
}

function isRequired(question: BackendUserInputQuestion): boolean {
  return question.required !== false;
}

function draftAnswers(request: BackendUserInputRequest, draft: Draft): BackendUserInputAnswer[] {
  return request.questions.map((question) => {
    if (question.type === 'text') {
      return { questionId: question.id, text: draft.text[question.id] ?? '' };
    }
    const answer: BackendUserInputAnswer = {
      questionId: question.id,
      optionIds: draft.optionIds[question.id] ?? [],
    };
    const other = draft.otherText[question.id];
    if (other !== undefined) answer.otherText = other;
    return answer;
  });
}

export function BackendUserInputPrompt(props: BackendUserInputPromptProps): ReactElement | null {
  if (props.request === null) return null;
  return <BackendUserInputPromptInner request={props.request} onResolve={props.onResolve} />;
}

function BackendUserInputPromptInner(props: {
  request: BackendUserInputRequest;
  onResolve: (result: BackendUserInputResult) => void;
}): ReactElement {
  const { translator } = useDesktopLocale();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const parsed = useMemo(
    () => parseBackendUserInputResult({ answers: draftAnswers(props.request, draft) }, props.request),
    [draft, props.request],
  );

  const setText = (questionId: string, text: string): void => {
    setDraft((current) => ({ ...current, text: { ...current.text, [questionId]: text } }));
  };
  const setOther = (questionId: string, text: string): void => {
    setDraft((current) => ({ ...current, otherText: { ...current.otherText, [questionId]: text } }));
  };
  const toggleOption = (question: Extract<BackendUserInputQuestion, { type: 'select' }>, optionId: string): void => {
    setDraft((current) => {
      const selected = current.optionIds[question.id] ?? [];
      const next = question.multiple === true
        ? (selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
        : (selected.length === 1 && selected[0] === optionId ? [] : [optionId]);
      return { ...current, optionIds: { ...current.optionIds, [question.id]: next } };
    });
  };

  return (
    <AgentInterruptionFrame
      tone="question"
      statusLabel={translator.interruption.agentWaiting}
      title={props.request.title}
      testId="backend-user-input-prompt"
      activityId="ask"
      activityAnimation={getBehaviorActivitySpec('ask').animation}
      activityStatus="running"
    >
      {props.request.questions.map((question) => (
        <fieldset key={question.id} className="agent-interruption-choices" data-testid={`backend-user-input-question-${question.id}`}>
          <legend>{question.prompt}</legend>
          {question.description ? <p className="agent-interruption-description">{question.description}</p> : null}
          {question.type === 'text' ? (
            <input
              data-testid={`backend-user-input-text-${question.id}`}
              value={draft.text[question.id] ?? ''}
              required={isRequired(question)}
              onChange={(event) => setText(question.id, event.target.value)}
            />
          ) : (
            <>
              {question.choices.map((choice, index) => {
                const selected = (draft.optionIds[question.id] ?? []).includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    className="agent-interruption-choice"
                    data-testid="backend-user-input-option"
                    data-option-id={choice.id}
                    aria-pressed={selected}
                    onClick={() => toggleOption(question, choice.id)}
                  >
                    <span className="agent-interruption-choice-badge">{String.fromCharCode(65 + index)}</span>
                    <span className="agent-interruption-choice-label">{choice.label}</span>
                  </button>
                );
              })}
              {question.allowOther === true ? (
                <input
                  data-testid={`backend-user-input-other-${question.id}`}
                  value={draft.otherText[question.id] ?? ''}
                  placeholder={translator.interruption.selectOrCustomPlaceholder}
                  onChange={(event) => setOther(question.id, event.target.value)}
                />
              ) : null}
            </>
          )}
        </fieldset>
      ))}
      <div className="agent-interruption-actions">
        <Button
          variant="primary"
          data-testid="backend-user-input-submit"
          disabled={parsed === undefined}
          onClick={() => { if (parsed !== undefined) props.onResolve(parsed); }}
        >
          {translator.interruption.continue}
        </Button>
      </div>
      <div className="agent-interruption-footer">
        <Button
          variant="ghost"
          size="compact"
          data-testid="backend-user-input-cancel"
          onClick={() => props.onResolve({ cancelled: true })}
        >
          {translator.interruption.cancelQuestion}
        </Button>
      </div>
    </AgentInterruptionFrame>
  );
}
