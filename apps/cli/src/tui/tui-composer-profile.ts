import type { ModelRef, SkillSummary, ThinkingLevel } from '@piwin/contracts';
import { ChoiceOverlay } from './choice-overlay.js';
import {
  DEFAULT_THINKING_VALUE,
  NO_SKILL_VALUE,
  describeThinkingLevel,
  parseThinkingLevel,
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
  /** A choice changed what the status line should say. */
  onChanged: () => void;
  onHint: (text: string) => void;
  onError: (error: unknown) => void;
};

/**
 * What the next prompt is sent with: model, thinking level and an optional
 * skill. Model and thinking level are also written to the session's composer
 * profile on the Host, so Desktop's composer shows the same choice.
 */
export class TuiComposerProfile {
  private models: ConfiguredModel[] = [];
  private model: ConfiguredModel | undefined;
  /** Explicit `/thinking` choice; absent means the model's own profile decides. */
  private thinkingLevel: ThinkingLevel | undefined;
  /** Skill for the next turn only; cleared once that turn is sent. */
  private nextSkill: { id: string; name: string } | undefined;

  public constructor(private readonly options: TuiComposerProfileOptions) {}

  public async loadModels(): Promise<void> {
    const data = hostData<{ models?: ConfiguredModel[] }>(
      await this.options.link.request({ type: 'models/configured' }),
    );
    this.models = data.models ?? [];
  }

  /** The session's own model wins over whatever the previous session used. */
  public adoptSessionModel(ref: ModelRef): void {
    this.model = this.models.find((model) => modelKey(model) === modelKey(ref)) ?? ref;
  }

  public modelRef(): ModelRef | undefined {
    return this.model === undefined ? undefined : toModelRef(this.model);
  }

  /** Model and thinking fields for a `session/prompt` input. */
  public promptFields(): { model?: ModelRef; thinkingLevel?: ThinkingLevel } {
    const model = this.modelRef();
    const thinkingLevel = this.thinkingLevel ?? this.model?.thinkingLevel;
    return {
      ...(model === undefined ? {} : { model }),
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    };
  }

  /** The skill chosen for the next turn; taking it clears the choice. */
  public takeSkillId(): string | undefined {
    const skill = this.nextSkill;
    this.nextSkill = undefined;
    return skill?.id;
  }

  /** Status-line parts, in display order. */
  public describe(): Array<string | undefined> {
    return [
      this.model === undefined ? '默认模型' : (this.model.label ?? this.model.modelId),
      describeThinkingLevel(this.thinkingLevel),
      this.nextSkill === undefined ? undefined : `技能 ${this.nextSkill.name}`,
    ];
  }

  public openModelPicker(): void {
    const { modals } = this.options;
    if (this.models.length === 0) {
      this.options.onHint('Host 没有已配置的模型');
      return;
    }
    modals.show(
      new ChoiceOverlay({
        title: '选择模型',
        items: this.models.map((model) => ({
          value: modelKey(model),
          label: model.label ?? model.modelId,
          ...(model.providerName === undefined ? {} : { description: model.providerName }),
        })),
        ...(this.model === undefined ? {} : { initialValue: modelKey(this.model) }),
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
