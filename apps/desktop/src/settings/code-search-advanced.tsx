/**
 * Settings → Code search loop budgets, folded away by default. The summary
 * line says whether anything differs from the defaults so the user never has
 * to open the fold just to check.
 */
import type { ReactElement } from 'react';
import {
  DEFAULT_CODE_SEARCH_MAX_COMMANDS,
  DEFAULT_CODE_SEARCH_MAX_RESULTS,
  DEFAULT_CODE_SEARCH_MAX_TURNS,
  DEFAULT_CODE_SEARCH_TREE_DEPTH,
} from '@piwin/contracts';
import { Field, Switch, TextInput } from '@piwin/ui-kit';

import { FieldRow } from './field-row.js';

export type CodeSearchBudgetDrafts = {
  turns: string;
  commands: string;
  results: string;
  depth: string;
};

type BudgetKey = keyof CodeSearchBudgetDrafts;

const BUDGET_FIELDS: ReadonlyArray<{
  key: BudgetKey;
  testId: string;
  min: number;
  fallback: number;
  zh: string;
  en: string;
  zhHint?: string;
  enHint?: string;
}> = [
  { key: 'turns', testId: 'code-search-max-turns', min: 1, fallback: DEFAULT_CODE_SEARCH_MAX_TURNS, zh: '搜索轮数', en: 'Search rounds' },
  { key: 'commands', testId: 'code-search-max-commands', min: 1, fallback: DEFAULT_CODE_SEARCH_MAX_COMMANDS, zh: '每轮命令数', en: 'Commands per round' },
  { key: 'results', testId: 'code-search-max-results', min: 1, fallback: DEFAULT_CODE_SEARCH_MAX_RESULTS, zh: '最多返回文件', en: 'Max files returned' },
  {
    key: 'depth',
    testId: 'code-search-tree-depth',
    min: 0,
    fallback: DEFAULT_CODE_SEARCH_TREE_DEPTH,
    zh: '目录树深度',
    en: 'Repo map depth',
    zhHint: '0 表示自动',
    enHint: '0 means auto',
  },
];

/** Empty means "use the default", so only a different number counts as custom. */
export function countCustomizedBudgets(drafts: CodeSearchBudgetDrafts, includeSnippets: boolean): number {
  let count = includeSnippets ? 0 : 1;
  for (const field of BUDGET_FIELDS) {
    const raw = drafts[field.key].trim();
    if (raw && Number(raw) !== field.fallback) count += 1;
  }
  return count;
}

export function CodeSearchAdvanced(props: {
  zh: boolean;
  drafts: CodeSearchBudgetDrafts;
  onDraftChange: (key: BudgetKey, value: string) => void;
  includeSnippets: boolean;
  onIncludeSnippetsChange: (value: boolean) => void;
  invalid: boolean;
}): ReactElement {
  const { zh, drafts } = props;
  const customized = countCustomizedBudgets(drafts, props.includeSnippets);

  return (
    <details className="code-search-advanced" data-testid="code-search-advanced">
      <summary>
        <span className="code-search-advanced-title">{zh ? '高级参数' : 'Advanced'}</span>
        <span className="code-search-advanced-summary" data-customized={customized > 0}>
          {props.invalid
            ? zh
              ? '有无效数值'
              : 'Invalid value'
            : customized > 0
              ? zh
                ? `已自定义 ${customized} 项`
                : `${customized} customized`
              : zh
                ? '默认值'
                : 'Defaults'}
        </span>
      </summary>
      <div className="code-search-advanced-body">
        <p className="code-search-advanced-intro">
          {zh
            ? '搜索循环的执行限额。留空即使用默认值，通常无需调整。'
            : 'Budgets for the search loop. Leave blank for the default; rarely needs changing.'}
        </p>
        <div className="code-search-budget-grid">
          {BUDGET_FIELDS.map((field) => {
            const fallback = zh ? `默认 ${field.fallback}` : `Default ${field.fallback}`;
            const hint = zh ? field.zhHint : field.enHint;
            return (
              <Field
                key={field.key}
                label={zh ? field.zh : field.en}
                description={hint ? `${fallback} · ${hint}` : fallback}
                className="code-search-budget-field"
              >
                <TextInput
                  testId={field.testId}
                  type="number"
                  min={field.min}
                  placeholder={String(field.fallback)}
                  value={drafts[field.key]}
                  onChange={(event) => props.onDraftChange(field.key, event.currentTarget.value)}
                />
              </Field>
            );
          })}
        </div>
        <FieldRow
          label={zh ? '包含代码片段' : 'Include code snippets'}
          description={zh ? '关闭后只返回文件路径与行号范围。' : 'When off, only file paths and line ranges are returned.'}
        >
          <Switch
            checked={props.includeSnippets}
            onCheckedChange={props.onIncludeSnippetsChange}
            aria-label={zh ? '包含代码片段' : 'Include code snippets'}
          />
        </FieldRow>
      </div>
    </details>
  );
}
