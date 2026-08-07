/**
 * Settings → Animations — showcase page for the breathing animation
 * component library. Each animation is rendered in a card with its name
 * and description. All animations use --text so they adapt to the active
 * light/dark theme automatically.
 */
import type { ReactElement } from 'react';
import { ANIMATION_CATALOG, BreathDot, PulseBlock, SolidBars } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';

export function AnimationsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

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
          <div className="animations-sizes-row" style={{ gap: 24, flexWrap: 'wrap' }}>
            <div className="animations-sizes-row"><span className="animations-sizes-label">sm</span><BreathDot size="sm" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">md</span><BreathDot size="md" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">lg</span><BreathDot size="lg" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">sm</span><PulseBlock size="sm" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">md</span><PulseBlock size="md" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">lg</span><PulseBlock size="lg" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">sm</span><SolidBars size="sm" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">md</span><SolidBars size="md" /></div>
            <div className="animations-sizes-row"><span className="animations-sizes-label">lg</span><SolidBars size="lg" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
