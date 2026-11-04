import type { ReactElement } from 'react';
import { Notice } from '@piwin/ui-kit';
import { KnowledgeProduceNotices } from './KnowledgeProduceNotices.js';
import type { KnowledgeProduceNotice } from './use-knowledge-produce.js';

export type KnowledgeWorkspaceNoticesProps = {
  locale: 'zh-CN' | 'en';
  generating: boolean;
  notice: KnowledgeProduceNotice | null;
  onOpenWiki: () => void;
  onOpenFlashcards: () => void;
  /** Sources: list/detail read errors, folder-add errors, produce errors. */
  errors: readonly (string | null)[];
};

const ERROR_TEST_IDS = ['knowledge-error', 'knowledge-add-error', 'knowledge-produce-error'] as const;

/** One band for everything that went wrong or just finished, above the section. */
export function KnowledgeWorkspaceNotices(props: KnowledgeWorkspaceNoticesProps): ReactElement {
  return (
    <>
      <KnowledgeProduceNotices
        locale={props.locale}
        generating={props.generating}
        notice={props.notice}
        onOpenWiki={props.onOpenWiki}
        onOpenFlashcards={props.onOpenFlashcards}
      />
      {props.errors.map((message, index) =>
        message ? (
          <Notice
            key={ERROR_TEST_IDS[index] ?? index}
            tone="error"
            testId={ERROR_TEST_IDS[index] ?? 'knowledge-error'}
          >
            {message}
          </Notice>
        ) : null,
      )}
    </>
  );
}
