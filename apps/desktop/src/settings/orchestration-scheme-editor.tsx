/**
 * Orchestration scheme editor — roster of roles the main agent may call.
 *
 * This module owns navigation only: a list of schemes, and a drill-down into
 * one of them. Draft rules live in `orchestration-scheme-draft`, the detail
 * form in `orchestration-scheme-form`.
 */
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  BUILTIN_FUSION_SCHEME,
  BUILTIN_REVIEWED_DELIVERY_SCHEME,
  BUILTIN_ULTRA_CODE_SCHEME,
  FUSION_SCHEME_ID,
  REVIEWED_DELIVERY_SCHEME_ID,
  ULTRA_CODE_SCHEME_ID,
  migrateSchemeMembers,
  type OrchestrationScheme,
  type OrchestrationSchemeSettings,
} from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { useConfirmDialog } from '../use-confirm-dialog';
import type { OrchestrationCopy } from './orchestration-copy';
import { OrchestrationSchemeForm } from './orchestration-scheme-form';
import {
  cleanSchemeDraft,
  createEmptyUserScheme,
  healSchemeDefaultRole,
  schemeToEditableDraft,
  validateSchemeDraft,
  type SchemeModelOption,
} from './orchestration-scheme-draft';

const BUILTIN_SCHEME_BY_ID: Readonly<Record<string, OrchestrationScheme>> = {
  [ULTRA_CODE_SCHEME_ID]: BUILTIN_ULTRA_CODE_SCHEME,
  [REVIEWED_DELIVERY_SCHEME_ID]: BUILTIN_REVIEWED_DELIVERY_SCHEME,
  [FUSION_SCHEME_ID]: BUILTIN_FUSION_SCHEME,
};

function isBuiltinSchemeId(schemeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_SCHEME_BY_ID, schemeId);
}

function sourceLabel(
  scheme: OrchestrationScheme,
  hasOverlay: boolean,
  copy: OrchestrationCopy,
): string {
  const isBuiltinBase = isBuiltinSchemeId(scheme.id);
  if (isBuiltinBase && hasOverlay) return copy.schemeSourceOverridden;
  if (scheme.source === 'builtin' && !hasOverlay) return copy.schemeSourceBuiltin;
  return copy.schemeSourceSettings;
}

export type OrchestrationSchemeEditorProps = {
  schemes: readonly OrchestrationScheme[];
  schemeDrafts: OrchestrationSchemeSettings[];
  modelOptions: readonly SchemeModelOption[];
  saving: boolean;
  copy: OrchestrationCopy;
  notice: string | null;
  onNotice: (message: string | null) => void;
  onPersistSchemes: (schemes: OrchestrationSchemeSettings[]) => Promise<boolean>;
  onCloneScheme: (schemeId: string) => Promise<void>;
  /** Page copy shown above the list; hidden while a scheme is open. */
  listIntro?: ReactNode;
  /** Page-level controls shown under the list; hidden while a scheme is open. */
  listFooter?: ReactNode;
};

export function OrchestrationSchemeEditor(props: OrchestrationSchemeEditorProps): ReactElement {
  const { schemes, schemeDrafts, modelOptions, saving, copy, notice, onNotice } = props;

  const [editing, setEditing] = useState<OrchestrationSchemeSettings | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  const overlayIds = useMemo(
    () => new Set(schemeDrafts.map((scheme) => scheme.id)),
    [schemeDrafts],
  );

  function startEdit(scheme: OrchestrationScheme): void {
    setEditing(schemeToEditableDraft(scheme));
    setEditError(null);
    onNotice(null);
  }

  function startCreate(): void {
    const existing = new Set(schemes.map((scheme) => scheme.id));
    setEditing(createEmptyUserScheme(existing));
    setEditError(null);
    onNotice(null);
  }

  function cancelEdit(): void {
    setEditing(null);
    setEditError(null);
  }

  async function saveEditing(): Promise<void> {
    if (!editing) return;
    const draft = healSchemeDefaultRole(cleanSchemeDraft(editing));
    const code = validateSchemeDraft(draft);
    if (code === 'invalid-id') {
      setEditError(copy.schemeInvalidId);
      return;
    }
    if (code === 'invalid-role' || code === 'duplicate-role') {
      setEditError(copy.schemeInvalidRole);
      return;
    }
    if (code === 'incomplete') {
      setEditError(copy.schemeIncomplete);
      return;
    }
    if (code) {
      setEditError(copy.schemeNeedMember);
      return;
    }

    const withoutSame = schemeDrafts.filter((scheme) => scheme.id !== draft.id);
    const ok = await props.onPersistSchemes([...withoutSame, draft]);
    if (!ok) return;
    setEditing(null);
    setEditError(null);
    onNotice(copy.schemeSaved);
  }

  async function resetBuiltin(schemeId: string): Promise<void> {
    const builtin = BUILTIN_SCHEME_BY_ID[schemeId];
    if (!builtin) return;
    const confirmed = await confirmDialog.confirm({
      title: copy.resetConfirmTitle,
      description: copy.resetConfirmBody,
      affectedObject: schemeId,
      confirmLabel: copy.schemeResetBuiltin,
      cancelLabel: copy.confirmCancel,
    });
    if (!confirmed) return;
    const next = schemeDrafts.filter((scheme) => scheme.id !== schemeId);
    const ok = await props.onPersistSchemes(next);
    if (!ok) return;
    if (editing?.id === schemeId) {
      setEditing(schemeToEditableDraft(builtin));
    }
    onNotice(copy.schemeSaved);
  }

  async function deleteUserScheme(schemeId: string): Promise<void> {
    if (isBuiltinSchemeId(schemeId)) return;
    const confirmed = await confirmDialog.confirm({
      title: copy.deleteConfirmTitle,
      description: copy.deleteConfirmBody,
      affectedObject: schemeId,
      confirmLabel: copy.schemeDelete,
      cancelLabel: copy.confirmCancel,
      tone: 'danger',
    });
    if (!confirmed) return;
    const next = schemeDrafts.filter((scheme) => scheme.id !== schemeId);
    const ok = await props.onPersistSchemes(next);
    if (!ok) return;
    if (editing?.id === schemeId) cancelEdit();
    onNotice(copy.schemeSaved);
  }

  if (editing) {
    const saved = schemes.find((scheme) => scheme.id === editing.id);
    return (
      <div className="orch-root" data-testid="orchestration-schemes-section">
        <OrchestrationSchemeForm
          draft={editing}
          isNew={saved === undefined}
          idLocked={overlayIds.has(editing.id) && saved !== undefined}
          sourceLabel={
            saved ? sourceLabel(saved, overlayIds.has(saved.id), copy) : copy.schemeSourceSettings
          }
          modelOptions={modelOptions}
          saving={saving}
          error={editError}
          copy={copy}
          onChange={setEditing}
          onCancel={cancelEdit}
          onSave={() => void saveEditing()}
        />
        {confirmDialog.dialog}
      </div>
    );
  }

  return (
    <div className="orch-root" data-testid="orchestration-schemes-section">
      {props.listIntro}

      <div className="orch-list-bar">
        <span className="orch-count">{copy.schemeCount(schemes.length)}</span>
        <Button
          variant="secondary"
          disabled={saving}
          data-testid="orchestration-scheme-new"
          onClick={startCreate}
        >
          {copy.schemeNew}
        </Button>
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}

      <ul className="orch-scheme-list">
        {schemes.map((scheme) => {
          const hasOverlay = overlayIds.has(scheme.id);
          const isBuiltinBase = isBuiltinSchemeId(scheme.id);
          const members = migrateSchemeMembers(scheme);

          return (
            <li
              key={scheme.id}
              className="orch-scheme-card"
              data-testid={`orchestration-scheme-row-${scheme.id}`}
            >
              <button
                type="button"
                className="orch-scheme-open"
                title={copy.schemeOpenHint}
                disabled={saving}
                data-testid={`orchestration-scheme-edit-${scheme.id}`}
                onClick={() => startEdit(scheme)}
              >
                <span className="orch-scheme-head">
                  <span className="orch-scheme-name">{scheme.name}</span>
                  <span className="orch-badge">{sourceLabel(scheme, hasOverlay, copy)}</span>
                  <code className="orch-scheme-id">{scheme.id}</code>
                </span>
                <span className="orch-scheme-desc">{scheme.description}</span>
                <span
                  className="orch-scheme-roles"
                  data-testid={`orchestration-scheme-roles-${scheme.id}`}
                >
                  {members.map((member) => (
                    <span key={member.role} className="orch-role-chip" title={member.description}>
                      {member.role}
                    </span>
                  ))}
                  <span className="orch-count">{copy.roleCount(members.length)}</span>
                </span>
              </button>

              <div className="orch-scheme-actions">
                <Button
                  size="compact"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => startEdit(scheme)}
                >
                  {copy.schemeEdit}
                </Button>
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={saving}
                  data-testid={`orchestration-scheme-clone-${scheme.id}`}
                  onClick={() => void props.onCloneScheme(scheme.id)}
                >
                  {copy.schemeClone}
                </Button>
                {isBuiltinBase && hasOverlay ? (
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={saving}
                    data-testid={`orchestration-scheme-reset-${scheme.id}`}
                    onClick={() => void resetBuiltin(scheme.id)}
                  >
                    {copy.schemeResetBuiltin}
                  </Button>
                ) : null}
                {!isBuiltinBase ? (
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={saving}
                    data-testid={`orchestration-scheme-delete-${scheme.id}`}
                    onClick={() => void deleteUserScheme(scheme.id)}
                  >
                    {copy.schemeDelete}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {props.listFooter}

      {confirmDialog.dialog}
    </div>
  );
}
