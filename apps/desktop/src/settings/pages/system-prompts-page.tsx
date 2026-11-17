/**
 * Settings → Agent → System Prompts page.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { SegmentedControl, Skeleton } from '@piwin/ui-kit';
import type { BuiltinSystemPromptSlotId } from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { BuiltinPromptsPanel } from '../system-prompts/BuiltinPromptsPanel';
import { CustomPresetsPanel, type PresetDraftSeed } from '../system-prompts/CustomPresetsPanel';
import { SystemPromptsScopeCard } from '../system-prompts/SystemPromptsScopeCard';
import {
  consumeSystemPromptFocus,
  type SystemPromptsTab,
} from '../system-prompts/system-prompts-focus';

export function SystemPromptsPage(): ReactElement {
  const { config } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [tab, setTab] = useState<SystemPromptsTab>('presets');
  const [focusedSlotId, setFocusedSlotId] = useState<BuiltinSystemPromptSlotId | undefined>(
    undefined,
  );
  const [presetSeed, setPresetSeed] = useState<PresetDraftSeed | null>(null);

  useEffect(() => {
    const focus = consumeSystemPromptFocus();
    if (!focus) return;
    setTab(focus.tab);
    if (focus.slotId) {
      setFocusedSlotId(focus.slotId);
    }
  }, []);

  if (!config) {
    return <Skeleton label={isZh ? '正在加载系统提示词…' : 'Loading system prompts…'} rows={[48, 120, 140]} />;
  }

  return (
    <div className="settings-card" data-testid="settings-system-prompts">
      <SystemPromptsScopeCard />

      <div style={{ margin: '12px 0' }}>
        <SegmentedControl
          value={tab}
          testId="system-prompts-tab-control"
          onChange={(nextTab) => setTab(nextTab === 'builtins' ? 'builtins' : 'presets')}
          data={[
            { value: 'presets', label: isZh ? '自定义预设' : 'Custom Presets' },
            { value: 'builtins', label: isZh ? '系统内置提示词' : 'Built-in Prompts' },
          ]}
        />
      </div>

      {tab === 'presets' ? (
        <CustomPresetsPanel
          draftSeed={presetSeed}
          onConsumeSeed={() => setPresetSeed(null)}
        />
      ) : (
        <BuiltinPromptsPanel
          initialSlotId={focusedSlotId}
          onSaveAsPreset={(seed) => {
            setPresetSeed(seed);
            setTab('presets');
          }}
        />
      )}
    </div>
  );
}
