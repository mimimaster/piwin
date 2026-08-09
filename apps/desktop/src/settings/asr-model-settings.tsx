import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type ModelConfigEntry,
  type ModelProviderConfig,
  type PiwinConfig,
} from '@piwin/contracts';
import { Button, Dialog, Field, Notice, Select, StatusBadge, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { PageTitle } from './page-title.js';

type AsrModelOption = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

type AsrDraft = {
  modelKey: string;
  language: string;
  routePath: string;
  timeoutSeconds: string;
};

export type AsrModelSettingsProps = {
  config: PiwinConfig;
  saving: boolean;
  onSave: (next: PiwinConfig) => Promise<boolean>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
};

export function AsrModelSettings(props: AsrModelSettingsProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const options = useMemo(() => collectAsrModels(props.config), [props.config]);
  const configured = resolveConfiguredAsr(props.config);
  const configuredOption = configured
    ? options.find(
        (option) =>
          option.provider.id === configured.providerId && option.model.id === configured.modelId,
      )
    : undefined;
  const hasInvalidConfiguredModel = configured !== undefined && configuredOption === undefined;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<AsrDraft>(() => createAsrDraft(props.config, options));

  useEffect(() => {
    if (!dialogOpen) {
      setDraft(createAsrDraft(props.config, options));
    }
  }, [dialogOpen, options, props.config]);

  function openDialog(): void {
    setDraft(createAsrDraft(props.config, options));
    setDialogOpen(true);
  }

  async function saveAsr(): Promise<void> {
    const selected = options.find((option) => modelKey(option) === draft.modelKey);
    if (!selected) {
      props.onError(
        isChinese
          ? '请先在模型编辑器中勾选“语音识别（ASR）”。'
          : 'Choose a model tagged for ASR first.',
      );
      return;
    }

    const timeoutMs = parseTimeout(draft.timeoutSeconds);
    if (draft.timeoutSeconds.trim() && timeoutMs === undefined) {
      props.onError(
        isChinese
          ? 'ASR 超时必须是正整数秒数。'
          : 'ASR timeout must be a positive number of seconds.',
      );
      return;
    }
    if (
      draft.routePath.trim() &&
      (!draft.routePath.trim().startsWith('/') || draft.routePath.includes('://'))
    ) {
      props.onError(
        isChinese
          ? 'ASR 接口路径必须是相对路径，例如 /audio/transcriptions。'
          : 'ASR route must be a relative path, for example /audio/transcriptions.',
      );
      return;
    }

    const nextProviders = props.config.providers.map((provider) => {
      if (provider.id !== selected.provider.id) return provider;
      const nextModels = provider.models.map((model) => {
        if (model.id !== selected.model.id) return model;
        const existingRoute = model.routes?.['speech-to-text'];
        const nextRoute = existingRoute ? { ...existingRoute } : {};
        if (draft.routePath.trim()) nextRoute.path = draft.routePath.trim();
        else delete nextRoute.path;
        if (timeoutMs !== undefined) nextRoute.timeoutMs = timeoutMs;
        else delete nextRoute.timeoutMs;
        const nextModel = {
          ...model,
          capabilities: addCapability(model.capabilities, 'speech-to-text'),
        };
        const nextRoutes = { ...model.routes };
        if (Object.keys(nextRoute).length > 0) {
          nextRoutes['speech-to-text'] = nextRoute;
        } else {
          delete nextRoutes['speech-to-text'];
        }
        if (Object.keys(nextRoutes).length > 0) {
          nextModel.routes = nextRoutes;
        } else {
          delete nextModel.routes;
        }
        return nextModel;
      });
      return { ...provider, models: nextModels };
    });

    const next: PiwinConfig = {
      ...props.config,
      providers: nextProviders,
      speech: {
        ...props.config.speech,
        asr: {
          ...props.config.speech?.asr,
          defaultModel: {
            protocol: selected.provider.protocol,
            providerId: selected.provider.id,
            modelId: selected.model.id,
          },
          ...(draft.language.trim() ? { language: draft.language.trim() } : {}),
        },
      },
    };

    if (await props.onSave(next)) {
      props.onInfo(isChinese ? '已保存 ASR 配置。' : 'ASR configuration saved.');
      setDialogOpen(false);
    }
  }

  async function clearAsr(): Promise<void> {
    const nextSpeech = props.config.speech ? { ...props.config.speech } : undefined;
    if (nextSpeech) {
      delete nextSpeech.asr;
    }
    const next: PiwinConfig = { ...props.config };
    if (nextSpeech && (nextSpeech.tts?.defaultModel || nextSpeech.tts?.voice)) {
      next.speech = nextSpeech;
    } else {
      delete next.speech;
    }
    if (await props.onSave(next)) {
      props.onInfo(isChinese ? '已停用桌面语音输入。' : 'Desktop voice input disabled.');
    }
  }

  return (
    <section className="settings-section speech-defaults" data-testid="settings-speech-defaults">
      <PageTitle
        title={isChinese ? '能力默认值' : 'Capability defaults'}
        description={
          isChinese
            ? '为桌面语音输入设置默认模型；TTS 先保留能力标记，播放链路接入后再启用。'
            : 'Set the default model for desktop voice input. TTS stays capability-only until playback is wired.'
        }
      />

      <div className="speech-defaults-grid">
        <article className="speech-default-card" data-testid="settings-asr-card">
          <div className="speech-default-card-heading">
            <span className="speech-default-icon speech-default-icon--input" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="9" y="2.5" width="6" height="12" rx="3" />
                <path d="M5.5 10.5v1.5a6.5 6.5 0 0 0 13 0v-1.5M12 18.5V22M8.5 22h7" />
              </svg>
            </span>
            <div className="speech-default-card-heading-copy">
              <span className="speech-default-card-kicker">ASR</span>
              <h3>{isChinese ? '语音输入' : 'Voice input'}</h3>
              <p>
                {isChinese
                  ? '录音只在本次请求中使用，不会保存音频。'
                  : 'Recordings are used for this request only and are never saved.'}
              </p>
            </div>
            {configuredOption ? (
              <StatusBadge
                tone="success"
                label={isChinese ? '已就绪' : 'Ready'}
                testId="settings-asr-ready"
              />
            ) : null}
          </div>

          <div className="speech-default-card-body">
            {configuredOption ? (
              <div className="speech-default-configured" data-testid="settings-asr-configured">
                <div className="speech-default-model">
                  <strong>{configuredOption.model.label ?? configuredOption.model.id}</strong>
                  <span>
                    {configuredOption.provider.name} · {configuredOption.model.id}
                    {props.config.speech?.asr?.language
                      ? ` · ${props.config.speech.asr.language}`
                      : ''}
                  </span>
                </div>
                <div className="settings-section-actions">
                  <Button size="compact" onClick={openDialog} disabled={props.saving}>
                    {isChinese ? '更换' : 'Change'}
                  </Button>
                  <Button
                    size="compact"
                    variant="ghost"
                    onClick={() => void clearAsr()}
                    disabled={props.saving}
                    data-testid="settings-asr-clear"
                  >
                    {isChinese ? '停用' : 'Disable'}
                  </Button>
                </div>
              </div>
            ) : (
              <Notice
                tone={hasInvalidConfiguredModel ? 'warning' : 'info'}
                testId="settings-asr-unconfigured"
                action={
                  <Button
                    size="compact"
                    variant="primary"
                    onClick={openDialog}
                    disabled={props.saving}
                  >
                    {isChinese ? '配置 ASR' : 'Configure ASR'}
                  </Button>
                }
              >
                {hasInvalidConfiguredModel
                  ? isChinese
                    ? '当前模型不可用，请选择已启用且带 ASR 能力标记的模型。'
                    : 'The current model is unavailable. Choose an enabled model tagged for ASR.'
                  : isChinese
                    ? '尚未配置桌面语音输入。'
                    : 'Desktop voice input is not configured yet.'}
              </Notice>
            )}
          </div>
        </article>

        <article
          className="speech-default-card speech-default-card--reserved"
          data-testid="settings-tts-reserved"
        >
          <div className="speech-default-card-heading">
            <span className="speech-default-icon speech-default-icon--output" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 9.5v5h3.5l4 3.5v-12l-4 3.5H4Z" />
                <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
              </svg>
            </span>
            <div className="speech-default-card-heading-copy">
              <span className="speech-default-card-kicker">TTS</span>
              <h3>{isChinese ? '语音输出' : 'Voice output'}</h3>
              <p>
                {isChinese
                  ? '模型能力标签已支持，播放和音色配置将在后续接入。'
                  : 'Model capability tagging is ready; playback and voice settings come later.'}
              </p>
            </div>
            <StatusBadge
              tone="neutral"
              label={isChinese ? '预留' : 'Reserved'}
              testId="settings-tts-status"
            />
          </div>
          <div className="speech-default-card-body speech-default-card-body--reserved">
            <span className="speech-default-reserved-label">
              {isChinese
                ? '当前只需在模型编辑器中开启 TTS 能力。'
                : 'For now, enable TTS on a model in the model editor.'}
            </span>
          </div>
        </article>
      </div>

      <AsrConfigDialog
        open={dialogOpen}
        draft={draft}
        options={options}
        saving={props.saving}
        isChinese={isChinese}
        onOpenChange={setDialogOpen}
        onDraftChange={setDraft}
        onSave={() => void saveAsr()}
      />
    </section>
  );
}

type AsrConfigDialogProps = {
  open: boolean;
  draft: AsrDraft;
  options: AsrModelOption[];
  saving: boolean;
  isChinese: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: AsrDraft) => void;
  onSave: () => void;
};

function AsrConfigDialog(props: AsrConfigDialogProps): ReactElement {
  const optionItems = props.options.map((option) => ({
    value: modelKey(option),
    label: `${option.provider.name} · ${option.model.label ?? option.model.id}`,
  }));
  return (
    <Dialog
      label={props.isChinese ? '配置 ASR 模型' : 'Configure ASR model'}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="settings-asr-dialog"
      contentClassName="settings-asr-dialog"
    >
      <div className="settings-card-heading">
        <div className="settings-card-heading-body">
          <h4>{props.isChinese ? '桌面语音输入' : 'Desktop voice input'}</h4>
          <p>
            {props.isChinese
              ? '选择转写模型；音频只作为本次请求的临时数据。'
              : 'Choose a transcription model. Audio is transient request data only.'}
          </p>
        </div>
      </div>
      {props.options.length > 0 ? (
        <Field
          label={props.isChinese ? 'ASR 模型' : 'ASR model'}
          description={
            props.isChinese
              ? '模型需要在模型编辑器中勾选“语音识别（ASR）”。'
              : 'The model must be tagged with speech recognition (ASR) in the model editor.'
          }
          testId="settings-asr-model-field"
        >
          <Select
            value={props.draft.modelKey}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, modelKey: event.currentTarget.value })
            }
            data={optionItems}
            testId="settings-asr-model-select"
          />
        </Field>
      ) : (
        <Notice tone="warning" testId="settings-asr-no-models">
          {props.isChinese
            ? '暂无 ASR 模型。请先在上方模型目录中编辑一个模型并勾选“语音识别（ASR）”。'
            : 'No ASR models are available. Edit a model in the directory above and enable speech recognition (ASR).'}
        </Notice>
      )}
      <div className="settings-form-grid">
        <Field
          label={props.isChinese ? '语言（可选）' : 'Language (optional)'}
          description={
            props.isChinese
              ? '例如 zh 或 en。留空由服务商自动检测。'
              : 'For example zh or en. Leave blank for provider detection.'
          }
          testId="settings-asr-language-field"
        >
          <TextInput
            value={props.draft.language}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, language: event.currentTarget.value })
            }
            placeholder="zh"
            testId="settings-asr-language-input"
          />
        </Field>
        <Field
          label={props.isChinese ? '接口路径（可选）' : 'Route path (optional)'}
          description={
            props.isChinese ? '默认 /audio/transcriptions。' : 'Defaults to /audio/transcriptions.'
          }
          testId="settings-asr-route-field"
        >
          <TextInput
            value={props.draft.routePath}
            onChange={(event) =>
              props.onDraftChange({ ...props.draft, routePath: event.currentTarget.value })
            }
            placeholder="/audio/transcriptions"
            testId="settings-asr-route-input"
          />
        </Field>
      </div>
      <Field
        label={props.isChinese ? '超时（秒，可选）' : 'Timeout (seconds, optional)'}
        description={props.isChinese ? '默认 120 秒。' : 'Defaults to 120 seconds.'}
        testId="settings-asr-timeout-field"
      >
        <TextInput
          value={props.draft.timeoutSeconds}
          onChange={(event) =>
            props.onDraftChange({ ...props.draft, timeoutSeconds: event.currentTarget.value })
          }
          placeholder="120"
          inputMode="numeric"
          testId="settings-asr-timeout-input"
        />
      </Field>
      <div className="settings-section-actions">
        <Button onClick={() => props.onOpenChange(false)}>
          {props.isChinese ? '取消' : 'Cancel'}
        </Button>
        <Button
          variant="primary"
          onClick={props.onSave}
          disabled={props.saving || props.options.length === 0}
          data-testid="settings-asr-save"
        >
          {props.isChinese ? '保存配置' : 'Save configuration'}
        </Button>
      </div>
    </Dialog>
  );
}

function collectAsrModels(config: PiwinConfig): AsrModelOption[] {
  const options: AsrModelOption[] = [];
  for (const provider of config.providers) {
    if (!isProviderEnabled(provider)) continue;
    for (const model of provider.models) {
      if (!isModelEnabled(model) || !modelSupportsCapability(model, 'speech-to-text')) continue;
      options.push({ provider, model });
    }
  }
  return options;
}

function resolveConfiguredAsr(
  config: PiwinConfig,
): { providerId: string; modelId: string } | undefined {
  const modelRef = config.speech?.asr?.defaultModel;
  return modelRef;
}

function modelKey(option: AsrModelOption): string {
  return `${option.provider.id}::${option.model.id}`;
}

function createAsrDraft(config: PiwinConfig, options: AsrModelOption[]): AsrDraft {
  const configured = config.speech?.asr?.defaultModel;
  const configuredKey = configured ? `${configured.providerId}::${configured.modelId}` : '';
  const selected = options.find((option) => modelKey(option) === configuredKey) ?? options[0];
  const route = selected?.model.routes?.['speech-to-text'];
  return {
    modelKey: selected ? modelKey(selected) : '',
    language: config.speech?.asr?.language ?? '',
    routePath: route?.path ?? '',
    timeoutSeconds: route?.timeoutMs ? String(Math.round(route.timeoutMs / 1000)) : '',
  };
}

function parseTimeout(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.round(seconds * 1000);
}

function addCapability(
  capabilities: ModelConfigEntry['capabilities'],
  capability: 'speech-to-text',
): NonNullable<ModelConfigEntry['capabilities']> {
  const next = new Set(capabilities ?? []);
  next.add(capability);
  return [...next];
}
