import type {
  OrchestrationSchemeConfigSlice,
  ModelRef,
  PermissionConfig,
  PermissionPreset,
  PromptTemplateSummary,
  SkillSummary,
  ThinkingLevel,
} from '@piwin/contracts';
import {
  listOrchestrationSchemes,
  resolveNewSessionOrchestrationSchemeId,
  resolvePermissionPreset,
} from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  DEFAULT_THINKING_VALUE,
  HOST_PERMISSION_VALUE,
  NO_DELEGATION_VALUE,
  NO_SKILL_VALUE,
  SCHEME_OFF_VALUE,
  activeSchemeName,
  describeScheme,
  schemeItems,
  type SchemeChoice,
  describePermissionPreset,
  describeThinkingLevel,
  nextPermissionPreset,
  parsePermissionPreset,
  parseThinkingLevel,
  permissionPresetItems,
  promptTemplateCommands,
  skillItems,
  thinkingLevelItems,
} from './tui-composer-options.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

type ConfiguredModel = ModelRef & { label?: string; providerName?: string; thinkingLevel?: ThinkingLevel };

export type TuiComposerProfileOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  getSessionId: () => string | undefined;
  /** Backend of the session on screen; absent is Pi. */
  getAgentId: () => string | undefined;
  /** A choice changed what the status line should say. */
  onChanged: () => void;
  onHint: (text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * What the next prompt is sent with: model, thinking level, Run Mode and an
 * optional skill. Model and thinking level are also written to the session's
 * composer profile on the Host, so Desktop's composer shows the same choice.
 */
export class TuiComposerProfile {
  private models: ConfiguredModel[] = [];
  private model: ConfiguredModel | undefined;
  /** Explicit `/thinking` choice; absent means the model's own profile decides. */
  private thinkingLevel: ThinkingLevel | undefined;
  /** Skill for the next turn only; cleared once that turn is sent. */
  private nextSkill: { id: string; name: string } | undefined;
  /** Run Mode override for this shell's prompts; absent means the Host's setting. */
  private permissionPreset: PermissionPreset | undefined;
  /** What the Host falls back to, for display only. */
  private hostPermissionPreset: PermissionPreset | undefined;
  private hostDefaultModelKey: string | undefined;
  private promptTemplates: PromptTemplateSummary[] = [];
  /** Orchestration schemes the Host knows (builtin and user), for the picker. */
  private schemes: SchemeChoice[] = [];
  /** What a new session starts with (Host `subagents.defaultSchemeId`). */
  private defaultSchemeId: string = SCHEME_OFF_VALUE;
  /** Session-sticky orchestration scheme; `off` is freehand. */
  private schemeId: string = SCHEME_OFF_VALUE;
  /** Session-sticky: the model may not delegate to subagents. */
  private delegationDisabled = false;

  public constructor(private readonly options: TuiComposerProfileOptions) {}

  public async loadModels(): Promise<void> {
    const data = hostData<{ models?: ConfiguredModel[] }>(
      await this.options.link.request({ type: 'models/configured' }),
    );
    this.models = data.models ?? [];
    // Resume can arrive before this catalog; recover its label/default profile.
    if (this.model !== undefined) this.adoptSessionModel(this.model);
  }

  /** Best effort: without the list, a template still works when typed by name. */
  public async loadPromptTemplates(): Promise<void> {
    const response = await this.options.link.request({ type: 'prompts/list' });
    if (!response.success) return;
    this.promptTemplates = (response.data as { prompts?: PromptTemplateSummary[] } | undefined)?.prompts ?? [];
  }

  /** Templates as slash commands for completion. */
  public promptCommands(reservedNames: ReadonlySet<string>): Array<{ name: string; description: string }> {
    return promptTemplateCommands(this.promptTemplates, reservedNames);
  }

  /** Pick a template; `onPick` receives its name to place in the composer. */
  public openPromptPicker(reservedNames: ReadonlySet<string>, onPick: (name: string) => void): void {
    const { modals } = this.options;
    const commands = this.promptCommands(reservedNames);
    if (commands.length === 0) {
      this.options.onHint('没有可用的提示词模板');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '提示词模板',
        message: '选中后填入输入框，可以接着写参数再发送。',
        items: commands.map((command) => ({
          value: command.name,
          label: `/${command.name}`,
          description: command.description.replace(/^模板 · /, ''),
        })),
        onSelect: (value) => {
          modals.close();
          onPick(value);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** Best effort: a Host that will not show its config just leaves the default unnamed. */
  public async loadHostPermissionPreset(): Promise<void> {
    const response = await this.options.link.request({ type: 'config/get' });
    if (!response.success) return;
    const config = (
      response.data as
        | {
            config?: {
              permissions?: PermissionConfig;
              defaultProviderId?: string;
              defaultModelId?: string;
              subagents?: OrchestrationSchemeConfigSlice & { defaultSchemeId?: string };
            };
          }
        | undefined
    )?.config;
    this.adoptSchemeConfig(config?.subagents);
    this.hostPermissionPreset = resolvePermissionPreset(config?.permissions);
    this.hostDefaultModelKey =
      config?.defaultProviderId !== undefined && config.defaultModelId !== undefined
        ? modelKey({ providerId: config.defaultProviderId, modelId: config.defaultModelId })
        : undefined;
  }

  /** Scheme list and new-session default from the Host's `subagents` config. */
  public adoptSchemeConfig(subagents: (OrchestrationSchemeConfigSlice & { defaultSchemeId?: string }) | undefined): void {
    const hadDefault = this.schemeId === this.defaultSchemeId && !this.delegationDisabled;
    this.schemes = listOrchestrationSchemes(subagents ?? {}).map((scheme) => ({
      id: scheme.id,
      name: scheme.name,
      ...(scheme.description ? { description: scheme.description } : {}),
    }));
    this.defaultSchemeId = resolveNewSessionOrchestrationSchemeId(subagents);
    // Config can arrive after the first session opened; an untouched choice follows it.
    if (hadDefault) this.schemeId = this.defaultSchemeId;
  }

  /** A new or different session starts from the configured default scheme. */
  public resetSchemeForNewSession(): void {
    this.schemeId = this.defaultSchemeId;
    this.delegationDisabled = false;
  }

  /** Name for the composer badge; undefined when freehand or delegation is off. */
  public activeSchemeName(): string | undefined {
    if (this.delegationDisabled) return undefined;
    return activeSchemeName(this.schemeId, this.schemes);
  }

  /** The model a turn uses when none is chosen: the Host's default, when it names one this Host lists. */
  private hostDefaultModel(): ConfiguredModel | undefined {
    return this.models.find((model) => modelKey(model) === this.hostDefaultModelKey);
  }

  /** The session's own model wins over whatever the previous session used. */
  public adoptSessionModel(ref: ModelRef): void {
    this.model = this.models.find((model) => modelKey(model) === modelKey(ref)) ?? ref;
  }

  public modelRef(): ModelRef | undefined {
    return this.model === undefined ? undefined : toModelRef(this.model);
  }

  /** Model, thinking and Run Mode fields for a `session/prompt` input. */
  public promptFields(): {
    model?: ModelRef;
    thinkingLevel?: ThinkingLevel;
    permissionPreset?: PermissionPreset;
    orchestrationSchemeId?: string;
    delegationMode?: 'auto' | 'disabled';
  } {
    const model = this.modelRef();
    const thinkingLevel = this.thinkingLevel ?? this.model?.thinkingLevel;
    return {
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      ...(this.permissionPreset === undefined ? {} : { permissionPreset: this.permissionPreset }),
      // External agents run their own delegation; piwin's schemes do not apply.
      ...(this.options.getAgentId() === undefined
        ? {
            orchestrationSchemeId: this.delegationDisabled ? SCHEME_OFF_VALUE : this.schemeId,
            delegationMode: this.delegationDisabled ? ('disabled' as const) : ('auto' as const),
          }
        : {}),
    };
  }

  /** The skill chosen for the next turn; taking it clears the choice. */
  public takeSkillId(): string | undefined {
    const skill = this.nextSkill;
    this.nextSkill = undefined;
    return skill?.id;
  }

  /** The model and thinking level the next prompt uses, for reports that spell them out. */
  public describeModelAndThinking(): { model: string; thinking?: string } {
    const thinking = this.thinkingLevel ?? this.model?.thinkingLevel;
    return { model: this.describeModel(), ...(thinking === undefined ? {} : { thinking }) };
  }

  /** An external agent keeps its own models and effort; piwin's lists would only mislead. */
  private refuseForBackend(what: string): boolean {
    const agentId = this.options.getAgentId();
    if (agentId === undefined) return false;
    this.options.onHint(`「${agentId}」会话的${what}由该 agent 自己管理，这里不能改`);
    return true;
  }

  private describeModel(): string {
    if (this.model !== undefined) return this.model.label ?? this.model.modelId;
    const fallback = this.hostDefaultModel();
    return fallback === undefined ? '默认模型' : `${fallback.label ?? fallback.modelId}（默认）`;
  }

  /** Status-line parts, in display order. */
  public describe(): Array<string | undefined> {
    return [
      this.describeModel(),
      describeThinkingLevel(this.thinkingLevel),
      describePermissionPreset(this.permissionPreset, this.hostPermissionPreset),
      this.nextSkill === undefined ? undefined : `技能 ${this.nextSkill.name}`,
      describeScheme(this.activeSchemeName(), this.delegationDisabled),
    ];
  }

  public openModelPicker(): void {
    const { modals } = this.options;
    if (this.refuseForBackend('模型')) return;
    if (this.models.length === 0) {
      this.options.onHint('Host 没有已配置的模型');
      return;
    }
    const current = this.model ?? this.hostDefaultModel();
    modals.show(
      new ChoiceOverlay({
        title: '选择模型',
        items: this.models.map((model) => ({
          value: modelKey(model),
          label: model.label ?? model.modelId,
          ...(model.providerName === undefined ? {} : { description: model.providerName }),
        })),
        ...(current === undefined ? {} : { initialValue: modelKey(current) }),
        onSelect: (value) => {
          modals.close();
          const picked = this.models.find((model) => modelKey(model) === value);
          if (picked === undefined) return;
          this.model = picked;
          this.options.onChanged();
          this.saveToSession({ model: toModelRef(picked) });
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  public openThinkingPicker(): void {
    const { modals } = this.options;
    if (this.refuseForBackend('思考强度')) return;
    modals.show(
      new ChoiceOverlay({
        title: '思考强度',
        items: thinkingLevelItems(),
        initialValue: this.thinkingLevel ?? DEFAULT_THINKING_VALUE,
        onSelect: (value) => {
          modals.close();
          this.thinkingLevel = parseThinkingLevel(value);
          this.options.onChanged();
          if (this.thinkingLevel !== undefined) this.saveToSession({ thinkingLevel: this.thinkingLevel });
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  public openPermissionPicker(): void {
    const { modals } = this.options;
    if (this.refuseForBackend('权限模式')) return;
    modals.show(
      new ChoiceOverlay({
        title: '权限模式',
        message: '对接下来发出的消息生效；Shift+Tab 可直接轮换。',
        items: permissionPresetItems(this.hostPermissionPreset),
        initialValue: this.permissionPreset ?? HOST_PERMISSION_VALUE,
        onSelect: (value) => {
          modals.close();
          this.permissionPreset = parsePermissionPreset(value);
          this.options.onChanged();
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  public openSchemePicker(): void {
    const { modals } = this.options;
    if (this.refuseForBackend('子代理编排')) return;
    modals.show(
      new ChoiceOverlay({
        title: '编排方案',
        message: '对这个会话接下来发出的消息生效。',
        items: schemeItems(this.schemes),
        initialValue: this.delegationDisabled ? NO_DELEGATION_VALUE : this.schemeId,
        onSelect: (value) => {
          modals.close();
          this.delegationDisabled = value === NO_DELEGATION_VALUE;
          this.schemeId = this.delegationDisabled ? SCHEME_OFF_VALUE : value;
          this.options.onChanged();
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  public cyclePermissionPreset(): void {
    if (this.refuseForBackend('权限模式')) return;
    this.permissionPreset = nextPermissionPreset(this.permissionPreset);
    this.options.onChanged();
  }

  public async openSkillPicker(): Promise<void> {
    const { modals } = this.options;
    const { skills = [] } = hostData<{ skills?: SkillSummary[] }>(
      await this.options.link.request({ type: 'skills/list' }),
    );
    const items = skillItems(skills);
    if (items.length === 0) {
      this.options.onHint('没有可用的技能');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '下一条消息使用的技能',
        items,
        initialValue: this.nextSkill?.id ?? NO_SKILL_VALUE,
        onSelect: (value) => {
          modals.close();
          const picked = skills.find((skill) => skill.id === value);
          this.nextSkill = picked === undefined ? undefined : { id: picked.id, name: picked.name };
          this.options.onChanged();
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** A draft has no session yet; its first prompt carries the choice instead. */
  private saveToSession(profile: { model?: ModelRef; thinkingLevel?: ThinkingLevel }): void {
    const sessionId = this.options.getSessionId();
    if (sessionId === undefined) return;
    this.options.link
      .request({ type: 'session/set-composer-profile', sessionId, ...profile })
      .then(hostData, this.options.onError);
  }
}

function modelKey(model: ModelRef): string {
  return `${model.providerId}/${model.modelId}`;
}

function toModelRef(model: ConfiguredModel): ModelRef {
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    ...(model.source === undefined ? {} : { source: model.source }),
    ...(model.protocol === undefined ? {} : { protocol: model.protocol }),
  };
}
