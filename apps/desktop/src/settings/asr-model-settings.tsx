import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type ModelConfigEntry,
  type ModelProviderConfig,
  type PiwinConfig,
} from '@piwin/contracts';
import { Button, Dialog, Field, Notice, Select, TextInput } from '@piwin/ui-kit';
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
    <div
      className="settings-section settings-section-card settings-asr-card"
      data-testid="settings-asr-card"
    >
      <PageTitle
        title={isChinese ? '语音输入（ASR）' : 'Voice input (ASR)'}
        description={
          isChinese
            ? '桌面端录音只在内存中转换为文本，不保存音频。选择一个已标记为 ASR 的模型即可启用输入框麦克风。'
            : 'Desktop recordings are transcribed in memory and never saved. Choose a model tagged for ASR to enable the composer microphone.'
        }
        trailing={
          configuredOption ? (
            <span className="pill" data-testid="settings-asr-ready">
              {isChinese ? '已配置' : 'Configured'}
            </span>
          ) : null
        }
      />

      {configuredOption ? (
        <div className="settings-section-row" data-testid="settings-asr-configured">
          <div>
            <strong>{configuredOption.model.label ?? configuredOption.model.id}</strong>
            <p className="muted">
              {configuredOption.provider.name} · {configuredOption.model.id}
              {props.config.speech?.asr?.language ? ` · ${props.config.speech.asr.language}` : ''}
            </p>
          </div>
          <div className="settings-section-actions">
            <Button size="compact" onClick={openDialog} disabled={props.saving}>
              {isChinese ? '更换模型' : 'Change model'}
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
            <Button size="compact" variant="primary" onClick={openDialog} disabled={props.saving}>
              {isChinese ? '配置 ASR' : 'Configure ASR'}
            </Button>
          }
        >
          {hasInvalidConfiguredModel
            ? isChinese
              ? '当前 ASR 模型不可用，请重新选择已启用且带 ASR 能力标记的模型。'
              : 'The configured ASR model is unavailable. Choose an enabled model tagged for ASR.'
            : isChinese
              ? '尚未配置桌面语音输入。'
              : 'Desktop voice input is not configured yet.'}
        </Notice>
      )}

      <div className="settings-section-row" data-testid="settings-tts-reserved">
        <div>
          <strong>{isChinese ? '语音合成（TTS）' : 'Speech synthesis (TTS)'}</strong>
          <p className="muted">
            {isChinese
              ? '模型能力标签已经支持；播放与默认语音配置留待后续阶段。'
              : 'Model capability tagging is ready; playback and voice defaults are reserved for a later phase.'}
          </p>
        </div>
        <span className="pill">{isChinese ? '后续' : 'Later'}</span>
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
    </div>
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
            ? '暂无 ASR 模型。请先在下方模型目录中编辑一个模型并勾选“语音识别（ASR）”。'
            : 'No ASR models are available. Edit a model in the directory below and enable speech recognition (ASR).'}
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
