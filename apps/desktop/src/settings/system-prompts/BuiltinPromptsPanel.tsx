/**
 * Compact two-column read-only directory of built-in module prompts.
 * Clicking any card opens the read-only preview modal.
 */
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { IconEye } from '@piwin/ui-kit';
import {
  BUILTIN_SYSTEM_PROMPTS,
  readBuiltinSystemPromptValue,
  type BuiltinSystemPromptDescriptor,
  type BuiltinSystemPromptSlotId,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import type { PromptPreviewPayload } from './PromptPreviewModal';

export function BuiltinPromptsPanel(props: {
  initialSlotId?: BuiltinSystemPromptSlotId | undefined;
  onConsumeInitialSlot?: () => void;
  onOpenPreview: (payload: PromptPreviewPayload) => void;
}): ReactElement {
  const { config } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const openedInitialRef = useRef(false);
  const { initialSlotId, onConsumeInitialSlot, onOpenPreview } = props;

  const openSlotPreview = useCallback(
    (descriptor: BuiltinSystemPromptDescriptor) => {
      const value = readBuiltinSystemPromptValue(config, descriptor.slotId);
      onOpenPreview({
        title: isZh ? descriptor.titleZh : descriptor.titleEn,
        badge: value.isOverridden
          ? isZh
            ? '已自定义'
            : 'Custom'
          : descriptor.slotId,
        badgeTone: value.isOverridden ? 'warning' : 'neutral',
        layers: [
          {
            id: descriptor.slotId,
            label: descriptor.slotId,
            content: value.effectiveContent,
          },
        ],
      });
    },
    [config, isZh, onOpenPreview],
  );

  useEffect(() => {
    if (!initialSlotId || openedInitialRef.current) return;
    const found = BUILTIN_SYSTEM_PROMPTS.find((item) => item.slotId === initialSlotId);
    if (!found) return;
    openedInitialRef.current = true;
    openSlotPreview(found);
    onConsumeInitialSlot?.();
  }, [initialSlotId, onConsumeInitialSlot, openSlotPreview]);

  return (
    <section
      className="settings-section settings-section-card sysprompt-builtins-panel"
      data-testid="system-prompts-builtins-panel"
    >
      <div className="sysprompt-builtin-grid" data-testid="system-prompts-builtin-grid">
        {BUILTIN_SYSTEM_PROMPTS.map((descriptor) => {
          const value = readBuiltinSystemPromptValue(config, descriptor.slotId);
          const title = isZh ? descriptor.titleZh : descriptor.titleEn;
          const desc = isZh ? descriptor.descriptionZh : descriptor.descriptionEn;
          const charCount = value.effectiveContent.length;

          return (
            <button
              key={descriptor.slotId}
              type="button"
              className="sysprompt-builtin-card"
              title={descriptor.slotId}
              onClick={() => openSlotPreview(descriptor)}
              data-testid={`sysprompt-builtin-card-${descriptor.slotId}`}
            >
              <div className="sysprompt-builtin-card-head">
                <span className="sysprompt-builtin-card-title">{title}</span>
                <span className="sysprompt-builtin-card-meta">
                  <span>{isZh ? `${charCount} 字` : `${charCount}`}</span>
                  <span className="sysprompt-builtin-eye" aria-hidden="true">
                    <IconEye size={13} />
                  </span>
                </span>
              </div>
              <p className="sysprompt-builtin-card-desc">{desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
