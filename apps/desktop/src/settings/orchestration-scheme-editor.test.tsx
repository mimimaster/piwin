// @vitest-environment happy-dom
/**
 * OrchestrationSchemeEditor — member inputs must keep DOM identity while typing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { OrchestrationScheme, OrchestrationSchemeSettings } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import {
  OrchestrationSchemeEditor,
  type OrchestrationSchemeEditorCopy,
} from './orchestration-scheme-editor';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const COPY: OrchestrationSchemeEditorCopy = {
  schemesTitle: 'Schemes',
  schemesDescription: 'Roster',
  schemeClone: 'Clone',
  schemeCloneSaved: 'Cloned',
  schemeClonedSuffix: ' (copy)',
  schemeSourceBuiltin: 'Builtin',
  schemeSourceOverridden: 'Overridden',
  schemeSourceSettings: 'Custom',
  schemeGeneric: 'Generic',
  schemeExpose: 'Expose',
  schemeEdit: 'Edit',
  schemeNew: 'New',
  schemeDelete: 'Delete',
  schemeResetBuiltin: 'Reset',
  schemeSave: 'Save',
  schemeSaved: 'Saved',
  schemeName: 'Name',
  schemeId: 'ID',
  schemeDesc: 'Summary',
  schemeDiscipline: 'Discipline',
  schemeDisciplineHint: 'Hint',
  schemeMembers: 'Members',
  schemeAddMember: 'Add member',
  schemeAddFromTemplate: 'Template',
  schemeRole: 'Role',
  schemeRoleDesc: 'Duty',
  schemeMemberModel: 'Model',
  schemeModelInherit: 'Inherit',
  schemeThinking: 'Thinking',
  schemeThinkingInherit: 'Default',
  schemeIsolation: 'Isolation',
  schemeIsolationReadonly: 'Readonly',
  schemeIsolationWorktree: 'Worktree',
  schemeFallback: 'Fallback',
  schemeFallbackMain: 'Main',
  schemeFallbackNone: 'None',
  schemeDefaultRole: 'Default role',
  schemeMaxConcurrency: 'Concurrency',
  schemeMaxTasks: 'Tasks',
  schemeMaxThinking: 'Max thinking',
  schemeMaxThinkingInherit: 'Inherit thinking',
  schemeRemoveMember: 'Remove',
  schemeCancel: 'Cancel',
  schemeInvalidId: 'Invalid id',
  schemeInvalidRole: 'Invalid role',
  schemeNeedMember: 'Need member',
  schemeIncomplete: 'Incomplete',
  schemeCheapModelHint: 'Cheap',
  schemeAdvanced: 'Advanced',
};

const SCHEME: OrchestrationScheme = {
  id: 'roster',
  name: 'Roster',
  description: 'A small roster',
  systemPreamble: 'Delegate to roster roles when work would pollute this context.',
  exposeSpawnMetadata: false,
  waitPolicy: 'await-all',
  source: 'settings',
  defaultRole: 'scout',
  members: [{ role: 'scout', description: 'Look around', fallback: 'main' }],
};

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveInput(root: ParentNode, testId: string): HTMLInputElement {
  const host = root.querySelector(`[data-testid="${testId}"]`);
  const input = host instanceof HTMLInputElement ? host : host?.querySelector('input');
  if (!input) throw new Error(`missing input ${testId}`);
  return input;
}

describe('OrchestrationSchemeEditor member typing', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderEditor(
    onPersistSchemes: (schemes: OrchestrationSchemeSettings[]) => Promise<boolean> = async () =>
      true,
  ): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <OrchestrationSchemeEditor
            schemes={[SCHEME]}
            schemeDrafts={[SCHEME]}
            modelOptions={[]}
            saving={false}
            copy={COPY}
            notice={null}
            onNotice={vi.fn()}
            onPersistSchemes={onPersistSchemes}
            onCloneScheme={vi.fn(async () => undefined)}
          />
        </PiwinUiProvider>,
      );
    });
  }

  function openEditor(): void {
    const edit = container.querySelector('[data-testid="orchestration-scheme-edit-roster"]');
    if (!(edit instanceof HTMLElement)) throw new Error('missing edit button');
    act(() => {
      edit.click();
    });
  }

  it('reuses the role input node and keeps focus after a keystroke', () => {
    renderEditor();
    openEditor();

    const roleInput = resolveInput(container, 'orchestration-member-role-0');
    act(() => {
      roleInput.focus();
    });
    expect(document.activeElement).toBe(roleInput);

    act(() => {
      setInputValue(roleInput, `${roleInput.value}z`);
    });

    const after = resolveInput(container, 'orchestration-member-role-0');
    expect(after).toBe(roleInput);
    expect(document.activeElement).toBe(roleInput);
    expect(after.value).toBe('scoutz');
  });

  it('keeps trailing spaces in the duty field while typing', () => {
    renderEditor();
    openEditor();

    const descInput = resolveInput(container, 'orchestration-member-desc-0');
    act(() => {
      descInput.focus();
      setInputValue(descInput, 'Look around ');
    });

    const after = resolveInput(container, 'orchestration-member-desc-0');
    expect(after).toBe(descInput);
    expect(document.activeElement).toBe(descInput);
    expect(after.value.endsWith(' ')).toBe(true);
    expect(after.value).toBe('Look around ');
  });

  it('writes trimmed lowercase roles on save', async () => {
    const persist = vi.fn(async () => true);
    renderEditor(persist);
    openEditor();

    const roleInput = resolveInput(container, 'orchestration-member-role-0');
    const descInput = resolveInput(container, 'orchestration-member-desc-0');
    act(() => {
      setInputValue(roleInput, 'ScoutZ');
      setInputValue(descInput, 'Look around ');
    });
    expect(roleInput.value).toBe('ScoutZ');
    expect(descInput.value).toBe('Look around ');

    const save = container.querySelector('[data-testid="orchestration-scheme-save-roster"]');
    if (!(save instanceof HTMLElement)) throw new Error('missing save button');
    await act(async () => {
      save.click();
    });

    expect(persist).toHaveBeenCalledTimes(1);
    const saved = persist.mock.calls[0]?.[0];
    const member = saved?.[0]?.members?.[0];
    expect(member?.role).toBe('scoutz');
    expect(member?.description).toBe('Look around');
    expect(saved?.[0]?.defaultRole).toBe('scoutz');
  });
});
