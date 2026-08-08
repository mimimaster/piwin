/**
 * Settings → Animations — showcase page for the breathing animation
 * component library. Each animation is rendered in a card with its name
 * and description. All animations use --text so they adapt to the active
 * light/dark theme automatically.
 */
import type { ReactElement } from 'react';
import {
  ANIMATION_CATALOG,
  BreathDot,
  PulseBlock,
  SolidBars,
  OrganicBlob,
  BreathMatrix,
  RadialBellow,
  CascadeRipple,
  AsteriskBreath,
  type AnimationSize,
} from '@piwin/ui-kit';
import { SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { AgentLocator } from '../../agent-locator.js';
import type { AgentLocatorAnimation } from '../../ui-preferences.js';

const SIZE_VARIANT_GROUPS: ReadonlyArray<{
  label: string;
  render: (size: AnimationSize) => ReactElement;
}> = [
  { label: '圆点呼吸', render: (s) => <BreathDot size={s} /> },
  { label: '方块脉冲', render: (s) => <PulseBlock size={s} /> },
  { label: '条形呼吸', render: (s) => <SolidBars size={s} /> },
  { label: '变形有机体', render: (s) => <OrganicBlob size={s} /> },
  { label: '呼吸矩阵', render: (s) => <BreathMatrix size={s} /> },
  { label: '辐射风箱', render: (s) => <RadialBellow size={s} /> },
  { label: '级联涟漪', render: (s) => <CascadeRipple size={s} /> },
  { label: '星芒呼吸', render: (s) => <AsteriskBreath size={s} /> },
];

const SIZES: readonly AnimationSize[] = ['sm', 'md', 'lg'] as const;

export function AnimationsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { preferences, onPreferencesChange } = useSettings();
  const isChinese = locale === 'zh-CN';
  const locatorAnimation = preferences.agentLocatorAnimation ?? 'radial-bellow';

  return (
    <div className="settings-card" data-testid="settings-animations">
      <div className="settings-section settings-section-card animations-page">
        <PageTitle
          title={isChinese ? '动效组件库' : 'Animation Library'}
          description={
            isChinese
              ? '纯 CSS 呼吸动效，自动适配明暗主题。所有动效使用当前文字色，随主题切换而变化。'
              : 'Pure-CSS breathing animations that adapt to light/dark themes automatically. All animations use the current text color.'
          }
        />

        <div className="animations-grid">
          {ANIMATION_CATALOG.map((entry) => (
            <div
              key={entry.id}
              className="animations-card"
              data-testid={`animation-card-${entry.id}`}
            >
              <div className="animations-card-stage">{entry.component}</div>
              <div className="animations-card-name">
                {isChinese ? entry.nameZh : entry.nameEn}
              </div>
              <div className="animations-card-desc">
                {isChinese ? entry.descZh : entry.descEn}
              </div>
            </div>
          ))}
        </div>

        <div className="settings-section-card animation-locator-config">
          <PageTitle
            title={isChinese ? 'Agent 定位动效' : 'Agent locator animation'}
            description={
              isChinese
                ? '运行中只显示一个轻量定位标记和动态文字；它会出现在对话区域底部或当前工作行。'
                : 'While a run is active, show one lightweight marker and changing text in the transcript locator.'
            }
          />
          <div className="animation-locator-config-row">
            <SegmentedControl
              value={locatorAnimation}
              onChange={(value) => {
                if (
                  value === 'radial-bellow' ||
                  value === 'asterisk-breath' ||
                  value === 'breath-dot' ||
                  value === 'none'
                ) {
                  const nextAnimation: AgentLocatorAnimation = value;
                  onPreferencesChange({
                    ...preferences,
                    agentLocatorAnimation: nextAnimation,
                  });
                }
              }}
              aria-label={isChinese ? 'Agent 定位动效' : 'Agent locator animation'}
              data={[
                { value: 'radial-bellow', label: isChinese ? '辐射风箱' : 'Radial bellow' },
                { value: 'asterisk-breath', label: isChinese ? '星芒呼吸' : 'Asterisk' },
                { value: 'breath-dot', label: isChinese ? '圆点呼吸' : 'Breath dot' },
                { value: 'none', label: isChinese ? '仅文字' : 'Text only' },
              ]}
              testId="agent-locator-animation-control"
            />
            <div className="animation-locator-preview" data-testid="agent-locator-preview">
              <AgentLocator
                input={{ kind: 'waiting-first-token', locale }}
                animation={locatorAnimation}
              />
            </div>
          </div>
        </div>

        {/* Size variants preview */}
        <div className="settings-section-card" style={{ marginTop: 16, padding: '18px 20px' }}>
          <PageTitle
            title={isChinese ? '尺寸变体' : 'Size Variants'}
            description={
              isChinese
                ? '每个动效支持 sm / md / lg 三种尺寸。'
                : 'Each animation supports sm / md / lg sizes.'
            }
          />
          <div className="animations-sizes-table">
            {SIZE_VARIANT_GROUPS.map((group) => (
              <div key={group.label} className="animations-sizes-row">
                <span className="animations-sizes-label">{group.label}</span>
                <div className="animations-sizes-cells">
                  {SIZES.map((size) => (
                    <div key={size} className="animations-sizes-cell">
                      {group.render(size)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
