// @vitest-environment happy-dom
/**
 * OrchestrationSchemeEditor — member inputs must keep DOM identity while typing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BUILTIN_AUTO_SCHEME,
  BUILTIN_FUSION_SCHEME,
  listOrchestrationSchemes,
  resolveOrchestrationScheme,
  type OrchestrationScheme,
  type OrchestrationSchemeSettings,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { buildOrchestrationCopy } from './orchestration-copy';
import { OrchestrationSchemeEditor } from './orchestration-scheme-editor';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const COPY = buildOrchestrationCopy(false);

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

type EditableField = HTMLInputElement | HTMLTextAreaElement;

function setInputValue(field: EditableField, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function resolveInput(root: ParentNode, testId: string): EditableField {
  const host = root.querySelector(`[data-testid="${testId}"]`);
  const field =
    host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement
      ? host
      : host?.querySelector('input, textarea');
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error(`missing input ${testId}`);
  }
  return field;
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
    schemes: readonly OrchestrationScheme[] = [SCHEME],
  ): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <OrchestrationSchemeEditor
            schemes={schemes}
            schemeDrafts={schemes.filter((scheme) => scheme.source === 'settings')}
            modelOptions={[]}
            saving={false}
            copy={COPY}
            notice={null}
            onNotice={vi.fn()}
            onPersistSchemes={onPersistSchemes}
            onCloneScheme={vi.fn(async () => undefined)}
            defaultSchemeId={undefined}
            onDefaultSchemeChange={vi.fn(async () => undefined)}
          />
        </PiwinUiProvider>,
      );
    });
  }

  function openEditor(schemeId = 'roster'): void {
    const edit = container.querySelector(`[data-testid="orchestration-scheme-edit-${schemeId}"]`);
    if (!(edit instanceof HTMLElement)) throw new Error('missing edit button');
    act(() => {
      edit.click();
    });
  }

  function sidekickIsolation(): HTMLSelectElement {
    const host = container.querySelector('[data-testid="orchestration-member-isolation-1"]');
    const field = host instanceof HTMLSelectElement ? host : host?.querySelector('select');
    if (!(field instanceof HTMLSelectElement)) throw new Error('missing sidekick isolation');
    return field;
  }

  it('displays Auto inherited worktree and saves without pinning isolation', async () => {
    const persist = vi.fn(async (_schemes: OrchestrationSchemeSettings[]) => true);
    renderEditor(persist, listOrchestrationSchemes({}));
    openEditor('auto');
    const isolation = sidekickIsolation();
    expect(isolation.selectedOptions[0]?.textContent).toContain(COPY.schemeIsolationWorktree);
    expect(isolation.value).toBe('');
    const save = container.querySelector('[data-testid="orchestration-scheme-save-auto"]');
    if (!(save instanceof HTMLElement)) throw new Error('missing save button');
    await act(async () => save.click());
    const saved = persist.mock.calls[0]?.[0]?.find((scheme) => scheme.id === 'auto');
    const member = saved?.members?.find((candidate) => candidate.role === 'sidekick');
    expect(member?.isolation).toBeUndefined();
    expect(member?.inheritFrom).toEqual({ schemeId: 'fusion', role: 'sidekick' });
  });

  it('reflects the source scheme overlay rather than the built-in default', () => {
    const fusion = {
      ...BUILTIN_FUSION_SCHEME,
      members: (BUILTIN_FUSION_SCHEME.members ?? []).map((member) => ({
        ...member,
        isolation: 'readonly' as const,
      })),
    };
    renderEditor(undefined, listOrchestrationSchemes({ schemes: [fusion] }));
    openEditor('auto');
    expect(sidekickIsolation().selectedOptions[0]?.textContent).toContain(COPY.schemeIsolationReadonly);
    expect(sidekickIsolation().value).toBe('');
  });

  it('keeps explicit readonly and lets the user restore inherited worktree', async () => {
    const auto = {
      ...BUILTIN_AUTO_SCHEME,
      members: (BUILTIN_AUTO_SCHEME.members ?? []).map((member) => member.role === 'sidekick'
        ? { ...member, isolation: 'readonly' as const }
        : member),
    };
    const persist = vi.fn(async (_schemes: OrchestrationSchemeSettings[]) => true);
    renderEditor(persist, listOrchestrationSchemes({ schemes: [auto] }));
    openEditor('auto');
    expect(sidekickIsolation().value).toBe('readonly');
    act(() => {
      sidekickIsolation().value = '';
      sidekickIsolation().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(sidekickIsolation().selectedOptions[0]?.textContent).toContain(COPY.schemeIsolationWorktree);
    const save = container.querySelector('[data-testid="orchestration-scheme-save-auto"]');
    if (!(save instanceof HTMLElement)) throw new Error('missing save button');
    await act(async () => save.click());
    const schemes = persist.mock.calls[0]?.[0];
    const member = schemes?.find((scheme) => scheme.id === 'auto')?.members?.[1];
    expect(member?.isolation).toBeUndefined();
    expect(resolveOrchestrationScheme({ schemes: schemes ?? [] }, 'auto')?.members[1]).toMatchObject({
      profileId: 'implementer', isolation: 'worktree',
    });
  });

  it('keeps an invalid inheritance reference editable and reports the error', () => {
    const auto = {
      ...BUILTIN_AUTO_SCHEME,
      members: (BUILTIN_AUTO_SCHEME.members ?? []).map((member) => member.role === 'sidekick'
        ? { ...member, inheritFrom: { schemeId: 'missing-source', role: 'writer' } }
        : member),
    };
    renderEditor(undefined, listOrchestrationSchemes({ schemes: [auto] }));
    expect(() => openEditor('auto')).not.toThrow();
    expect(container.textContent).toContain('missing-source');
    expect(sidekickIsolation().selectedOptions[0]?.textContent).not.toContain(COPY.schemeIsolationReadonly);
    expect(resolveInput(container, 'orchestration-member-role-1').disabled).toBe(false);
  });

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
    const persisted: OrchestrationSchemeSettings[][] = [];
    const persist = vi.fn(async (schemes: OrchestrationSchemeSettings[]) => {
      persisted.push(schemes);
      return true;
    });
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
    const saved = persisted[0];
    const member = saved?.[0]?.members?.[0];
    expect(member?.role).toBe('scoutz');
    expect(member?.description).toBe('Look around');
    expect(saved?.[0]?.defaultRole).toBe('scoutz');
  });
});
