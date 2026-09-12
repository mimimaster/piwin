/**
 * Settings → 子代理编排 / Orchestration.
 *
 * Product model (simple):
 * - A scheme is a roster of roles the main agent may call.
 * - User edits role + duty (+ optional model). Main agent schedules.
 * - No profile factory UI. Global limits live under Advanced only.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BUILTIN_ULTRA_CODE_SCHEME,
  createDefaultSubagentConfig,
  listOrchestrationSchemes,
  migrateSchemeMembers,
  type OrchestrationSchemeSettings,
  toModelRef,
  type ModelRef,
  type SubagentConfig,
} from '@piwin/contracts';
import { Button, Notice, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import {
  buildEnabledModelOptions,
  modelOptionsFromConfiguredModels,
  readConfiguredChatModelsData,
} from '../../model-options';
import { FieldRow } from '../field-row';
import { useSettings } from '../settings-context';
import { buildOrchestrationCopy } from '../orchestration-copy';
import { OrchestrationSchemeEditor } from '../orchestration-scheme-editor';

export function SubagentProfilesPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, saving, saveConfig, setError, setInfo, request } = useSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [configuredPickerOptions, setConfiguredPickerOptions] = useState<
    Array<{ value: string; label: string; ref: ModelRef }>
  >([]);

  const copy = useMemo(() => buildOrchestrationCopy(isChinese), [isChinese]);

  const subagents: SubagentConfig = config?.subagents ?? createDefaultSubagentConfig();

  const [schemeDrafts, setSchemeDrafts] = useState<OrchestrationSchemeSettings[]>(
    () => subagents.schemes ?? [],
  );
  const [schemeNotice, setSchemeNotice] = useState<string | null>(null);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(subagents.maxConcurrency);
  const [maxTasksPerRun, setMaxTasksPerRun] = useState<number>(subagents.maxTasksPerRun);

  useEffect(() => {
    setSchemeDrafts(subagents.schemes ?? []);
    setMaxConcurrency(subagents.maxConcurrency);
    setMaxTasksPerRun(subagents.maxTasksPerRun);
    setSchemeNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const orchestrationSchemes = useMemo(
    () =>
      listOrchestrationSchemes({
        schemes: schemeDrafts,
        maxConcurrency: subagents.maxConcurrency,
        maxTasksPerRun: subagents.maxTasksPerRun,
      }),
    [schemeDrafts, subagents.maxConcurrency, subagents.maxTasksPerRun],
  );

  const modelOptions = useMemo(() => {
    if (!config) return [];
    return buildEnabledModelOptions(config.providers).map((option) => {
      const ref: ModelRef = toModelRef({
        providerId: option.providerId,
        modelId: option.modelId,
        ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
      });
      return { value: JSON.stringify(ref), label: option.label, ref };
    });
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await request({ type: 'models/configured' });
      if (cancelled || !response.success) return;
      const models = readConfiguredChatModelsData(response.data).models;
      if (cancelled) return;
      setConfiguredPickerOptions(
        modelOptionsFromConfiguredModels(models).map((option) => {
          const ref: ModelRef = toModelRef({
            providerId: option.providerId,
            modelId: option.modelId,
            ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
            ...(option.source !== undefined ? { source: option.source } : {}),
          });
          return { value: JSON.stringify(ref), label: option.label, ref };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const pickerModelOptions =
    configuredPickerOptions.length > 0 ? configuredPickerOptions : modelOptions;

  function buildUniqueSchemeCloneId(baseId: string, existingIds: ReadonlySet<string>): string {
    const sanitizedBase =
      baseId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'scheme';
    let candidate = `${sanitizedBase}-copy`;
    let suffix = 2;
    while (existingIds.has(candidate)) {
      candidate = `${sanitizedBase}-copy-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  function baseSubagentPayload(schemes: OrchestrationSchemeSettings[] | undefined): SubagentConfig {
    const payload: SubagentConfig = {
      profiles: subagents.profiles ?? [],
      maxConcurrency,
      maxTasksPerRun,
      processIsolation: subagents.processIsolation,
      parallelWritePolicy: subagents.parallelWritePolicy,
      dirtyBasePolicy: subagents.dirtyBasePolicy,
    };
    if (subagents.defaultProfileId) {
      payload.defaultProfileId = subagents.defaultProfileId;
    }
    if (schemes && schemes.length > 0) {
      payload.schemes = schemes;
    }
    return payload;
  }

  async function handleCloneScheme(schemeId: string): Promise<void> {
    if (!config) return;
    const source =
      orchestrationSchemes.find((scheme) => scheme.id === schemeId) ??
      (schemeId === BUILTIN_ULTRA_CODE_SCHEME.id ? BUILTIN_ULTRA_CODE_SCHEME : undefined);
    if (!source) return;

    const existingIds = new Set([
      ...schemeDrafts.map((scheme) => scheme.id),
      ...orchestrationSchemes.map((scheme) => scheme.id),
    ]);
    const clonedId = buildUniqueSchemeCloneId(source.id, existingIds);
    const cloned: OrchestrationSchemeSettings = {
      id: clonedId,
      name: `${source.name}${copy.schemeClonedSuffix}`,
      description: source.description,
      exposeSpawnMetadata: source.exposeSpawnMetadata,
      waitPolicy: 'await-all',
      systemPreamble: source.systemPreamble,
      ...(source.defaultProfileId ? { defaultProfileId: source.defaultProfileId } : {}),
      ...(source.defaultRole ? { defaultRole: source.defaultRole } : {}),
      members: migrateSchemeMembers(source).map((member) => ({
        role: member.role,
        description: member.description,
        ...(member.profileId ? { profileId: member.profileId } : {}),
        ...(member.model ? { model: member.model } : {}),
        ...(member.thinkingLevel ? { thinkingLevel: member.thinkingLevel } : {}),
        ...(member.isolation ? { isolation: member.isolation } : {}),
        ...(member.fallback ? { fallback: member.fallback } : { fallback: 'main' as const }),
      })),
      ...(source.maxConcurrency !== undefined ? { maxConcurrency: source.maxConcurrency } : {}),
      ...(source.maxTasksPerRun !== undefined ? { maxTasksPerRun: source.maxTasksPerRun } : {}),
      ...(source.maxSubagentThinkingLevel
        ? { maxSubagentThinkingLevel: source.maxSubagentThinkingLevel }
        : {}),
    };

    const nextSchemes = [...schemeDrafts, cloned];
    setSchemeDrafts(nextSchemes);
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(nextSchemes),
    });
    if (!ok) {
      setError(copy.cloneFailed);
      return;
    }
    setSchemeNotice(copy.schemeCloneSaved);
  }

  async function persistSchemes(nextSchemes: OrchestrationSchemeSettings[]): Promise<boolean> {
    if (!config) return false;
    setSchemeDrafts(nextSchemes);
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(nextSchemes.length > 0 ? nextSchemes : undefined),
    });
    if (!ok) {
      setError(copy.saveFailed);
      return false;
    }
    return true;
  }

  async function saveAdvancedLimits(): Promise<void> {
    if (!config) return;
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(schemeDrafts.length > 0 ? schemeDrafts : undefined),
    });
    if (!ok) {
      setError(copy.saveFailed);
      return;
    }
    setInfo(copy.saved);
  }

  if (!config) {
    return (
      <p className="muted" data-testid="settings-subagents-loading">
        {copy.loading}
      </p>
    );
  }

  return (
    <div className="settings-card" data-testid="settings-subagents">
      {pickerModelOptions.length === 0 ? (
        <div className="orch-notice-slot">
          <Notice tone="warning">{copy.noModels}</Notice>
        </div>
      ) : null}

      <OrchestrationSchemeEditor
        schemes={orchestrationSchemes}
        schemeDrafts={schemeDrafts}
        modelOptions={pickerModelOptions}
        saving={saving}
        notice={schemeNotice}
        onNotice={setSchemeNotice}
        copy={copy}
        onPersistSchemes={persistSchemes}
        onCloneScheme={handleCloneScheme}
        listIntro={
          /* The settings shell already renders the section name as the page
             <h1>; a second heading here would say the same word twice. */
          <p className="orch-page-intro">{copy.pageDescription}</p>
        }
        listFooter={
          <details
            className="settings-disclosure orch-global-limits"
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
            data-testid="subagents-advanced-limits"
          >
            <summary>{copy.advancedTitle}</summary>
            <p className="orch-section-hint">{copy.advancedHint}</p>
            <FieldRow
              label={copy.maxConcurrency}
              description={copy.maxConcurrencyHint}
              testId="subagents-max-concurrency-row"
            >
              <TextInput
                type="number"
                min={1}
                value={String(maxConcurrency)}
                onChange={(event) =>
                  setMaxConcurrency(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </FieldRow>
            <FieldRow label={copy.maxTasksPerRun} testId="subagents-max-tasks-row">
              <TextInput
                type="number"
                min={1}
                value={String(maxTasksPerRun)}
                onChange={(event) =>
                  setMaxTasksPerRun(Math.max(1, Number(event.target.value) || 1))
                }
              />
            </FieldRow>
            <div className="orch-limits-actions">
              <Button variant="primary" disabled={saving} onClick={() => void saveAdvancedLimits()}>
                {saving ? '…' : copy.saveAdvanced}
              </Button>
            </div>
          </details>
        }
      />
    </div>
  );
}
