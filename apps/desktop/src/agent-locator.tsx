import type { ReactElement } from 'react';
import {
  AsteriskBreath,
  BreathDot,
  BreathMatrix,
  RadialBellow,
} from '@piwin/ui-kit';
import type { SkillActivityView } from './chat-reducer.js';
import type { AgentLocatorAnimation } from './ui-preferences.js';
import { getBehaviorActivitySpec, resolveRunBehaviorId } from './behavior-activity.js';
import { useRunActivityPhrases } from './run-activity-hooks.js';
import type { RunActivityInput } from './run-activity-types.js';

export type AgentLocatorProps = {
  input: RunActivityInput;
  animation?: AgentLocatorAnimation;
};

export type SkillActivityChipProps = {
  skill: SkillActivityView;
  loading?: boolean;
  locale?: 'zh-CN' | 'en';
};

function renderLocatorAnimation(
  animation: AgentLocatorAnimation,
  locale: 'zh-CN' | 'en',
): ReactElement | null {
  const label = locale === 'zh-CN' ? '代理运行中' : 'Agent is working';
  switch (animation) {
    case 'asterisk-breath':
      return <AsteriskBreath size="sm" label={label} testId="agent-locator-asterisk" />;
    case 'breath-dot':
      return <BreathDot size="sm" label={label} testId="agent-locator-dot" />;
    case 'none':
      return null;
    case 'radial-bellow':
    default:
      return <RadialBellow size="sm" label={label} testId="agent-locator-radial-bellow" />;
  }
}

/**
 * The only live run chrome: a compact, text-first locator. All run phases
 * share this surface; the phase-specific meaning comes from `input.kind` and
 * the phrase mapper, not from a second animated panel.
 */
export function AgentLocator(props: AgentLocatorProps): ReactElement {
  const locale = props.input.locale;
  const { currentPhrase } = useRunActivityPhrases(props.input);
  const animation = props.animation ?? 'radial-bellow';
  const activityId = resolveRunBehaviorId(props.input.kind);

  return (
    <div
      className="agent-locator"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="agent-locator"
      data-kind={props.input.kind}
      data-activity-id={activityId}
      data-activity-animation={getBehaviorActivitySpec(activityId).animation}
      data-animation={animation}
    >
      {animation !== 'none' ? (
        <span className="agent-locator-visual" aria-hidden="true">
          {renderLocatorAnimation(animation, locale)}
        </span>
      ) : null}
      <span className="agent-locator-copy">{currentPhrase}</span>
    </div>
  );
}

/** Compact provenance chip for an explicitly selected slash Skill. */
export function SkillActivityChip(props: SkillActivityChipProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const loading = props.loading === true;
  return (
    <span
      className={`skill-activity-chip${loading ? ' is-loading' : ''}`}
      data-testid="skill-activity-chip"
      data-activity-id={loading ? 'skill.load' : 'skill.use'}
      data-activity-animation={
        getBehaviorActivitySpec(loading ? 'skill.load' : 'skill.use').animation
      }
      role="status"
      aria-live="polite"
    >
      {loading ? (
        <span className="skill-activity-chip-visual" aria-hidden="true">
          <BreathMatrix
            size="sm"
            label={locale === 'zh-CN' ? '加载技能' : 'Loading skill'}
            testId="skill-activity-matrix"
          />
        </span>
      ) : null}
      <span>
        {loading
          ? locale === 'zh-CN'
            ? '加载技能：'
            : 'Loading skill: '
          : locale === 'zh-CN'
            ? '使用技能：'
            : 'Using skill: '}
        <strong>{props.skill.name}</strong>
      </span>
    </span>
  );
}
