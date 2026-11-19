/**
 * Settings → Agent → System Prompts page.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Skeleton } from '@piwin/ui-kit';
import type { BuiltinSystemPromptSlotId } from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { BuiltinPromptsPanel } from '../system-prompts/BuiltinPromptsPanel';
import { CustomPresetsPanel } from '../system-prompts/CustomPresetsPanel';
import {
  PromptPreviewModal,
  type PromptPreviewPayload,
} from '../system-prompts/PromptPreviewModal';
import { SystemPromptsScopeCard } from '../system-prompts/SystemPromptsScopeCard';
import {
  consumeSystemPromptFocus,
  type SystemPromptsTab,
} from '../system-prompts/system-prompts-focus';

export function SystemPromptsPage(): ReactElement {
  const { config, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [tab, setTab] = useState<SystemPromptsTab>('presets');
  const [focusedSlotId, setFocusedSlotId] = useState<BuiltinSystemPromptSlotId | undefined>(
    undefined,
  );
  const [previewPayload, setPreviewPayload] = useState<PromptPreviewPayload | null>(null);

  useEffect(() => {
    const focus = consumeSystemPromptFocus();
    if (!focus) return;
    setTab(focus.tab);
    if (focus.slotId) {
      setFocusedSlotId(focus.slotId);
    }
  }, []);

  if (!config) {
    return (
      <Skeleton
        label={isZh ? '正在加载系统提示词…' : 'Loading system prompts…'}
        rows={[48, 120, 140]}
      />
    );
  }

  return (
    <div className="settings-card sysprompt-page" data-testid="settings-system-prompts">
      <SystemPromptsScopeCard
        tab={tab}
        onTabChange={setTab}
        onOpenPreview={setPreviewPayload}
      />

      {tab === 'presets' ? (
        <CustomPresetsPanel onOpenPreview={setPreviewPayload} />
      ) : (
        <BuiltinPromptsPanel
          initialSlotId={focusedSlotId}
          onConsumeInitialSlot={() => setFocusedSlotId(undefined)}
          onOpenPreview={setPreviewPayload}
        />
      )}

      <PromptPreviewModal
        payload={previewPayload}
        onClose={() => setPreviewPayload(null)}
        onNotice={(message, tone) => setInfo(message, tone)}
        onError={(message) => setError(message)}
      />
    </div>
  );
}
