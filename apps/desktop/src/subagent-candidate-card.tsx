/**
 * Mutex candidate group for subagent delivery.
 * UI keeps one selected option (radio semantics). Host enforces adopt mutex.
 */
import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type SubagentCandidateItem = {
  resultId: string;
  title: string;
  summary?: string;
  fileCount?: number;
};

export type SubagentCandidateAdoptPayload = {
  resultId: string;
  candidateGroupId: string;
};

export type SubagentCandidateCardProps = {
  candidateGroupId: string;
  candidates: readonly SubagentCandidateItem[];
  selectedResultId?: string;
  locale?: 'zh-CN' | 'en';
  onAdopt: (payload: SubagentCandidateAdoptPayload) => void;
};

export function SubagentCandidateCard(props: SubagentCandidateCardProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const isZh = (props.locale ?? contextLocale) === 'zh-CN';
  const [selectedResultId, setSelectedResultId] = useState<string | null>(
    props.selectedResultId ?? null,
  );

  function adopt(resultId: string): void {
    if (selectedResultId === resultId) {
      return;
    }
    setSelectedResultId(resultId);
    props.onAdopt({ resultId, candidateGroupId: props.candidateGroupId });
  }

  return (
    <section
      className="subagent-candidate-card"
      data-testid="subagent-candidate-card"
      data-candidate-group-id={props.candidateGroupId}
      role="radiogroup"
      aria-label={isZh ? '候选方案' : 'Candidate plans'}
    >
      <header className="subagent-candidate-card-head">
        {isZh ? '候选方案' : 'Candidate plans'}
      </header>
      <ul className="subagent-candidate-list">
        {props.candidates.map((candidate) => {
          const selected = selectedResultId === candidate.resultId;
          return (
            <li key={candidate.resultId}>
              <CandidateOption
                candidate={candidate}
                selected={selected}
                isZh={isZh}
                onAdopt={() => adopt(candidate.resultId)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CandidateOption(props: {
  candidate: SubagentCandidateItem;
  selected: boolean;
  isZh: boolean;
  onAdopt: () => void;
}): ReactElement {
  const { candidate, selected, isZh } = props;
  const fileLabel =
    candidate.fileCount === undefined
      ? null
      : isZh
        ? `${candidate.fileCount} 个文件`
        : candidate.fileCount === 1
          ? '1 file'
          : `${candidate.fileCount} files`;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      props.onAdopt();
    }
  }

  return (
    <div
      className={
        selected ? 'subagent-candidate-option is-selected' : 'subagent-candidate-option'
      }
      role="radio"
      tabIndex={0}
      aria-checked={selected}
      data-testid="subagent-candidate-option"
      data-result-id={candidate.resultId}
      data-selected={selected ? 'true' : 'false'}
      onClick={props.onAdopt}
      onKeyDown={onKeyDown}
    >
      <span className="subagent-candidate-option-mark" aria-hidden="true" />
      <div className="subagent-candidate-option-body">
        <strong className="subagent-candidate-option-title">{candidate.title}</strong>
        {candidate.summary ? (
          <span className="subagent-candidate-option-summary">{candidate.summary}</span>
        ) : null}
        {fileLabel ? (
          <span className="subagent-candidate-option-meta">{fileLabel}</span>
        ) : null}
      </div>
      <Button
        variant={selected ? 'primary' : 'secondary'}
        size="compact"
        onClick={(event) => {
          event.stopPropagation();
          props.onAdopt();
        }}
      >
        {selected
          ? isZh
            ? '已采用'
            : 'Adopted'
          : isZh
            ? '采用此方案'
            : 'Adopt this plan'}
      </Button>
    </div>
  );
}
