/**
 * Detail view for one orchestration scheme — the drill-down half of the
 * Settings → orchestration page.
 *
 * Interaction contract: the list is replaced (not pushed down) while editing,
 * every input stays visible, and the save/cancel bar sticks to the bottom of
 * the settings scroller so it is reachable from anywhere in a long roster.
 */
import { useState, type ReactElement } from 'react';
import {
  DEFAULT_ORCHESTRATION_ROLE_TEMPLATES,
  ULTRA_CODE_SCHEME_ID,
  type OrchestrationSchemeSettings,
  type ThinkingLevel,
} from '@piwin/contracts';
import { Button, Notice, Select, Switch, TextArea, TextInput } from '@piwin/ui-kit';
import type { OrchestrationCopy } from './orchestration-copy';
import { OrchestrationMemberCard } from './orchestration-member-card';
import {
  appendMember,
  patchMemberAt,
  removeMemberAt,
  setSchemeDefaultRole,
  THINKING_LEVELS,
  type OrchestrationMemberPatch,
  type SchemeModelOption,
} from './orchestration-scheme-draft';

export type OrchestrationSchemeFormProps = {
  draft: OrchestrationSchemeSettings;
  /** True when this draft has no saved counterpart yet. */
  isNew: boolean;
  /** Source pill shown next to the title (bundled / modified / custom). */
  sourceLabel: string;
  /** Existing ids, used to lock the id field of a scheme already persisted. */
  idLocked: boolean;
  modelOptions: readonly SchemeModelOption[];
  saving: boolean;
  error: string | null;
  copy: OrchestrationCopy;
  onChange: (next: OrchestrationSchemeSettings) => void;
  onCancel: () => void;
  onSave: () => void;
};

export function OrchestrationSchemeForm(props: OrchestrationSchemeFormProps): ReactElement {
  const { draft, copy, saving, modelOptions } = props;
  const [capsOpen, setCapsOpen] = useState(false);
  const members = draft.members ?? [];
  const isBuiltinId = draft.id === ULTRA_CODE_SCHEME_ID;
  const idLocked = saving || isBuiltinId || props.idLocked;

  function patch(next: Partial<OrchestrationSchemeSettings>): void {
    props.onChange({ ...draft, ...next });
  }

  function patchMember(index: number, memberPatch: OrchestrationMemberPatch): void {
    props.onChange(patchMemberAt(draft, index, memberPatch));
  }

  return (
    <section className="orch-detail" data-testid={`orchestration-scheme-editor-${draft.id}`}>
      <div className="orch-detail-bar">
        <button
          type="button"
          className="orch-back"
          disabled={saving}
          data-testid="orchestration-scheme-back"
          onClick={props.onCancel}
        >
          <span aria-hidden="true">‹</span>
          {copy.backToList}
        </button>
      </div>

      <header className="orch-detail-head">
        <h4>{props.isNew ? copy.detailNewTitle : copy.detailEditTitle}</h4>
        <span className="orch-badge">{props.sourceLabel}</span>
        <code className="orch-detail-id">{draft.id}</code>
      </header>

      {props.error ? <Notice tone="error">{props.error}</Notice> : null}
      {isBuiltinId ? <Notice tone="info">{copy.schemeCheapModelHint}</Notice> : null}

      <div className="orch-form-section">
        <h5 className="orch-section-title">{copy.sectionBasics}</h5>
        <div className="orch-basics-grid">
          <label className="orch-field">
            <span className="orch-field-label">{copy.schemeName}</span>
            <TextInput
              value={draft.name}
              disabled={saving}
              testId="orchestration-scheme-name"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="orch-field">
            <span className="orch-field-label">{copy.schemeId}</span>
            <TextInput
              value={draft.id}
              disabled={idLocked}
              spellCheck={false}
              testId="orchestration-scheme-id"
              onChange={(event) => patch({ id: event.target.value })}
            />
            {idLocked ? null : <span className="orch-field-hint">{copy.schemeIdHint}</span>}
          </label>
        </div>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeDesc}</span>
          <TextInput
            value={draft.description}
            disabled={saving}
            testId="orchestration-scheme-desc"
            onChange={(event) => patch({ description: event.target.value })}
          />
          <span className="orch-field-hint">{copy.schemeDescHint}</span>
        </label>

        <label className="orch-field">
          <span className="orch-field-label">{copy.schemeDiscipline}</span>
          <TextArea
            value={draft.systemPreamble}
            disabled={saving}
            rows={5}
            testId={`orchestration-scheme-preamble-${draft.id}`}
            onChange={(nextValue) => patch({ systemPreamble: nextValue })}
          />
          <span className="orch-field-hint">{copy.schemeDisciplineHint}</span>
        </label>
      </div>

      <div className="orch-form-section">
        <div className="orch-section-head">
          <div className="orch-section-copy">
            <h5 className="orch-section-title">
              {copy.sectionRoster}
              <span className="orch-count">{copy.roleCount(members.length)}</span>
            </h5>
            <p className="orch-section-hint">{copy.rosterHint}</p>
          </div>
          <Button
            size="compact"
            variant="secondary"
            disabled={saving}
            data-testid="orchestration-add-member"
            onClick={() => props.onChange(appendMember(draft))}
          >
            {copy.schemeAddMember}
          </Button>
        </div>

        <div className="orch-quick-add">
          <span className="orch-quick-add-label">{copy.schemeAddFromTemplate}</span>
          {DEFAULT_ORCHESTRATION_ROLE_TEMPLATES.map((template) => (
            <button
              key={template.role}
              type="button"
              className="orch-chip-button"
              disabled={saving}
              title={template.description}
              data-testid={`orchestration-add-template-${template.role}`}
              onClick={() => props.onChange(appendMember(draft, template))}
            >
              <span aria-hidden="true">+</span>
              {template.role}
            </button>
          ))}
        </div>

        <div className="orch-member-list">
          {members.map((member, index) => (
            <OrchestrationMemberCard
              key={`member-${index}`}
              member={member}
              index={index}
              copy={copy}
              modelOptions={modelOptions}
              saving={saving}
              isDefault={draft.defaultRole === member.role}
              canRemove={members.length > 1}
              onPatch={patchMember}
              onRemove={(memberIndex) => props.onChange(removeMemberAt(draft, memberIndex))}
              onMakeDefault={(role) => props.onChange(setSchemeDefaultRole(draft, role))}
            />
          ))}
        </div>
      </div>

      <div className="orch-form-section">
        <h5 className="orch-section-title">{copy.sectionDispatch}</h5>

        <div className="orch-toggle-row">
          <div className="orch-toggle-copy">
            <span className="orch-toggle-title">{copy.schemeExposeTitle}</span>
            <p className="orch-section-hint">{copy.schemeExposeHint}</p>
          </div>
          <Switch
            checked={draft.exposeSpawnMetadata === true}
            disabled={saving}
            aria-label={copy.schemeExposeTitle}
            testId="orchestration-scheme-expose"
            onCheckedChange={(checked) => patch({ exposeSpawnMetadata: checked })}
          />
        </div>

        <details
          className="settings-disclosure orch-caps"
          open={capsOpen}
          onToggle={(event) => setCapsOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>{copy.schemeAdvanced}</summary>
          <div className="orch-caps-grid">
            <label className="orch-field">
              <span className="orch-field-label">{copy.schemeMaxConcurrency}</span>
              <TextInput
                type="number"
                min={1}
                value={String(draft.maxConcurrency ?? 4)}
                disabled={saving}
                onChange={(event) =>
                  patch({ maxConcurrency: Math.max(1, Number(event.target.value) || 1) })
                }
              />
            </label>
            <label className="orch-field">
              <span className="orch-field-label">{copy.schemeMaxTasks}</span>
              <TextInput
                type="number"
                min={1}
                value={String(draft.maxTasksPerRun ?? 8)}
                disabled={saving}
                onChange={(event) =>
                  patch({ maxTasksPerRun: Math.max(1, Number(event.target.value) || 1) })
                }
              />
            </label>
            <label className="orch-field">
              <span className="orch-field-label">{copy.schemeMaxThinking}</span>
              <Select
                value={draft.maxSubagentThinkingLevel ?? ''}
                disabled={saving}
                onChange={(event) => {
                  const value = event.target.value;
                  const next: OrchestrationSchemeSettings = { ...draft };
                  if (value) next.maxSubagentThinkingLevel = value as ThinkingLevel;
                  else delete next.maxSubagentThinkingLevel;
                  props.onChange(next);
                }}
              >
                <option value="">{copy.schemeMaxThinkingInherit}</option>
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </details>
      </div>

      <footer className="orch-detail-footer">
        <Button variant="ghost" disabled={saving} onClick={props.onCancel}>
          {copy.schemeCancel}
        </Button>
        <Button
          variant="primary"
          disabled={saving}
          data-testid={`orchestration-scheme-save-${draft.id}`}
          onClick={props.onSave}
        >
          {saving ? '…' : copy.schemeSave}
        </Button>
      </footer>
    </section>
  );
}
