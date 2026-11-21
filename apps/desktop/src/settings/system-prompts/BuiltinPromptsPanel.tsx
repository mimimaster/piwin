/**
 * Master-detail workbench for built-in module system prompts.
 * Users can inspect the built-in default, stack `.md`/`.txt` files on top,
 * or remove/restore the built-in default layer — without inline text editing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Button, IconClose, IconEye, IconPlus, IconRefresh } from '@piwin/ui-kit';
import {
  applyBuiltinSystemPromptStack,
  BUILTIN_SYSTEM_PROMPTS,
  findBuiltinSystemPromptDescriptor,
  isBuiltinSystemPromptStackCustomized,
  readBuiltinSystemPromptStack,
  readBuiltinSystemPromptValue,
  type BuiltinSystemPromptDescriptor,
  type BuiltinSystemPromptSlotId,
  type BuiltinSystemPromptStackConfig,
  type SystemPromptFileCandidate,
  type SystemPromptFileReadItem,
  type SystemPromptFilesListData,
  type SystemPromptFilesReadData,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { useSettings } from '../settings-context';
import { PromptFileStackEditor } from './PromptFileStackEditor';
import type { PromptPreviewPayload } from './PromptPreviewModal';
import {
  buildBuiltinPreviewPayload,
  describeBuiltinSlotStatus,
} from './builtin-prompt-stack-helpers';

export function BuiltinPromptsPanel(props: {
  selectedProjectPath: string | null;
  initialSlotId?: BuiltinSystemPromptSlotId | undefined;
  onConsumeInitialSlot?: () => void;
  onOpenPreview: (payload: PromptPreviewPayload) => void;
}): ReactElement {
  const { config, projectPath, hostClient, saveConfig, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { initialSlotId, onConsumeInitialSlot, onOpenPreview } = props;

  const [selectedSlotId, setSelectedSlotId] = useState<BuiltinSystemPromptSlotId>(
    initialSlotId ?? 'agent.default',
  );
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<SystemPromptFileCandidate[]>([]);
  const [systemPromptsDir, setSystemPromptsDir] = useState<string | undefined>(undefined);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [readItemsByPath, setReadItemsByPath] = useState<ReadonlyMap<string, SystemPromptFileReadItem>>(
    () => new Map(),
  );
  const readItemsRef = useRef(readItemsByPath);
  readItemsRef.current = readItemsByPath;
  const consumedInitialRef = useRef<BuiltinSystemPromptSlotId | undefined>(undefined);

  const isRemote = hostClient?.getTransport?.() === 'remote';
  const hostRequest = hostClient?.request;
  const effectiveProjectPath = props.selectedProjectPath ?? projectPath;

  useEffect(() => {
    if (!initialSlotId || consumedInitialRef.current === initialSlotId) return;
    if (!BUILTIN_SYSTEM_PROMPTS.some((item) => item.slotId === initialSlotId)) return;
    consumedInitialRef.current = initialSlotId;
    setSelectedSlotId(initialSlotId);
    onConsumeInitialSlot?.();
  }, [initialSlotId, onConsumeInitialSlot]);

  const activeDescriptor: BuiltinSystemPromptDescriptor = useMemo(
    () => findBuiltinSystemPromptDescriptor(selectedSlotId),
    [selectedSlotId],
  );
  const activeValue = readBuiltinSystemPromptValue(config, activeDescriptor.slotId);
  const activeStack = readBuiltinSystemPromptStack(config, activeDescriptor.slotId);
  const activeFilePathsKey = activeStack.filePaths.join('\0');
  const isStackCustomized = isBuiltinSystemPromptStackCustomized(activeStack);
  const activeStatus = describeBuiltinSlotStatus({
    includeBuiltin: activeStack.includeBuiltin,
    fileCount: activeStack.filePaths.length,
    legacyOverridden: activeValue.isOverridden,
    isZh,
  });

  const refreshCandidates = useCallback(async () => {
    if (!hostRequest) return;
    setLoadingCandidates(true);
    try {
      const response = await hostRequest({
        type: 'system-prompts/list-files',
        ...(!isRemote && effectiveProjectPath ? { projectPath: effectiveProjectPath } : {}),
      });
      if (!response.success) return;
      const data = response.data as SystemPromptFilesListData | undefined;
      if (data) {
        setSystemPromptsDir(data.systemPromptsDir);
        setCandidates(data.files ?? []);
      }
    } catch {
      // Best-effort discovery.
    } finally {
      setLoadingCandidates(false);
    }
  }, [effectiveProjectPath, hostRequest, isRemote]);

  useEffect(() => {
    void refreshCandidates();
  }, [refreshCandidates]);

  const refreshStackContents = useCallback(
    async (paths: readonly string[]): Promise<ReadonlyMap<string, SystemPromptFileReadItem>> => {
      if (!hostRequest || paths.length === 0) {
        setReadItemsByPath((prev) => (prev.size === 0 ? prev : new Map()));
        return new Map<string, SystemPromptFileReadItem>();
      }
      try {
        const response = await hostRequest({
          type: 'system-prompts/read-files',
          paths: [...paths],
          ...(!isRemote && effectiveProjectPath ? { projectPath: effectiveProjectPath } : {}),
        });
        if (!response.success) return readItemsRef.current;
        const data = response.data as SystemPromptFilesReadData | undefined;
        const map = new Map<string, SystemPromptFileReadItem>();
        for (const item of data?.files ?? []) {
          map.set(item.path, item);
        }
        setReadItemsByPath(map);
        return map;
      } catch {
        return readItemsRef.current;
      }
    },
    [effectiveProjectPath, hostRequest, isRemote],
  );

  useEffect(() => {
    void refreshStackContents(activeStack.filePaths);
    // Re-read whenever the selected slot or its stacked file list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDescriptor.slotId, activeFilePathsKey, refreshStackContents]);

  async function saveSlotStack(
    nextStack: BuiltinSystemPromptStackConfig,
    noticeText: string,
  ): Promise<void> {
    if (!config) return;
    setSaving(true);
    try {
      const nextConfig = applyBuiltinSystemPromptStack(config, activeDescriptor.slotId, nextStack);
      const ok = await saveConfig(nextConfig, { quiet: true });
      if (ok) {
        setInfo(noticeText, 'success');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleOpenBasePreview(): void {
    const title = isZh ? activeDescriptor.titleZh : activeDescriptor.titleEn;
    onOpenPreview({
      title: `${title} · ${isZh ? '内置默认' : 'Built-in'}`,
      badge: activeValue.isOverridden ? (isZh ? '自定义基底' : 'Custom base') : activeDescriptor.slotId,
      badgeTone: activeValue.isOverridden ? 'warning' : 'neutral',
      layers: [
        {
          id: 'builtin-base-only',
          label: isZh ? '内置默认' : 'Built-in default',
          content: activeValue.effectiveContent,
        },
      ],
    });
  }

  async function handleOpenCompiledPreview(): Promise<void> {
    const latestMap =
      activeStack.filePaths.length > 0
        ? await refreshStackContents(activeStack.filePaths)
        : readItemsByPath;
    onOpenPreview(
      buildBuiltinPreviewPayload({
        descriptor: activeDescriptor,
        baseContent: activeValue.effectiveContent,
        legacyOverridden: activeValue.isOverridden,
        stack: activeStack,
        readByPath: latestMap,
        isZh,
      }),
    );
  }

  async function handleOpenSingleFilePreview(filePath: string): Promise<void> {
    const latestMap = await refreshStackContents([filePath]);
    const item = latestMap.get(filePath);
    const fileName = item?.fileName ?? filePath.split(/[\\/]/).pop() ?? filePath;
    onOpenPreview({
      title: `@${fileName}`,
      badge: fileName.toLowerCase().endsWith('.txt') ? 'TXT' : 'MD',
      badgeTone: item && !item.exists ? 'warning' : 'neutral',
      layers: [
        {
          id: 'file',
          label: `@${fileName}`,
          filePath: item?.resolvedPath ?? filePath,
          content: item?.content ?? '',
          missing: item ? !item.exists : false,
          ...(item?.error ? { error: item.error } : {}),
          ...(item?.sizeBytes !== undefined ? { sizeBytes: item.sizeBytes } : {}),
        },
      ],
    });
  }

  const slotTitle = isZh ? activeDescriptor.titleZh : activeDescriptor.titleEn;
  const slotDesc = isZh ? activeDescriptor.descriptionZh : activeDescriptor.descriptionEn;
  const layerCount = (activeStack.includeBuiltin ? 1 : 0) + activeStack.filePaths.length;
  const emptyBuiltin = !activeStack.includeBuiltin && activeStack.filePaths.length === 0;
  const baseCharCount = activeValue.effectiveContent.length;

  const leadingBuiltinRow = activeStack.includeBuiltin ? (
    <li
      className="sysprompt-stack-card is-builtin"
      data-testid="sysprompt-builtin-base-row"
    >
      <button
        type="button"
        className="sysprompt-stack-card-main"
        onClick={handleOpenBasePreview}
        title={isZh ? '查看内置默认内容' : 'Preview built-in default'}
        data-testid="sysprompt-builtin-base-preview"
      >
        <span className="sysprompt-stack-order" aria-hidden="true">
          01
        </span>
        <span className="sysprompt-format-badge is-builtin">
          {isZh ? '内置' : 'BASE'}
        </span>
        <span className="sysprompt-stack-filename">
          {activeValue.isOverridden
            ? isZh
              ? '自定义基底文本'
              : 'Custom base text'
            : isZh
              ? '系统内置默认'
              : 'System built-in default'}
        </span>
        <span className="sysprompt-stack-bytes">
          {isZh ? `${baseCharCount} 字` : `${baseCharCount} chars`}
        </span>
        <span className="sysprompt-stack-preview-eye" aria-hidden="true">
          <IconEye size={13} />
        </span>
      </button>

      <div className="sysprompt-stack-card-actions">
        <button
          type="button"
          className="sysprompt-icon-action is-danger"
          disabled={saving}
          onClick={() =>
            void saveSlotStack(
              { includeBuiltin: false, filePaths: activeStack.filePaths },
              isZh
                ? `已从「${slotTitle}」移除系统内置默认。`
                : `Removed built-in default from "${slotTitle}".`,
            )
          }
          title={isZh ? '移除系统内置默认' : 'Remove built-in default'}
          aria-label={isZh ? '移除系统内置默认' : 'Remove built-in default'}
          data-testid="sysprompt-builtin-remove-base"
        >
          <IconClose size={13} />
        </button>
      </div>
    </li>
  ) : null;

  return (
    <section
      className="settings-section sysprompt-builtins-panel"
      data-testid="system-prompts-builtins-panel"
    >
      <div className="sysprompt-builtin-layout">
        <div
          className="sysprompt-builtin-rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label={isZh ? '内置模块列表' : 'Built-in prompt modules'}
          data-testid="system-prompts-builtin-grid"
        >
          {BUILTIN_SYSTEM_PROMPTS.map((descriptor) => {
            const selected = descriptor.slotId === activeDescriptor.slotId;
            const value = readBuiltinSystemPromptValue(config, descriptor.slotId);
            const stack = readBuiltinSystemPromptStack(config, descriptor.slotId);
            const status = describeBuiltinSlotStatus({
              includeBuiltin: stack.includeBuiltin,
              fileCount: stack.filePaths.length,
              legacyOverridden: value.isOverridden,
              isZh,
            });
            const title = isZh ? descriptor.titleZh : descriptor.titleEn;

            return (
              <button
                key={descriptor.slotId}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`sysprompt-builtin-rail-item${selected ? ' is-selected' : ''}`}
                title={descriptor.slotId}
                onClick={() => setSelectedSlotId(descriptor.slotId)}
                data-testid={`sysprompt-builtin-card-${descriptor.slotId}`}
              >
                <span className={`sysprompt-status-dot is-${status.tone}`} aria-hidden="true" />
                <span className="sysprompt-builtin-rail-title">{title}</span>
                <span className={`sysprompt-builtin-rail-pill is-${status.tone}`}>
                  {status.label}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className="sysprompt-section-block sysprompt-builtin-detail"
          role="tabpanel"
          data-testid={`sysprompt-builtin-detail-${activeDescriptor.slotId}`}
        >
          <div className="sysprompt-builtin-detail-head">
            <div className="sysprompt-builtin-detail-info">
              <div className="sysprompt-builtin-detail-title-row">
                <h3 className="sysprompt-builtin-detail-title">{slotTitle}</h3>
                <code className="sysprompt-builtin-slot-code">{activeDescriptor.slotId}</code>
                <span className={`sysprompt-builtin-rail-pill is-${activeStatus.tone}`}>
                  {activeStatus.label}
                </span>
              </div>
              <p className="sysprompt-builtin-detail-desc">{slotDesc}</p>
            </div>

            <div className="sysprompt-builtin-detail-actions">
              {isStackCustomized ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={saving}
                  onClick={() =>
                    void saveSlotStack(
                      { includeBuiltin: true, filePaths: [] },
                      isZh ? `已将「${slotTitle}」恢复默认。` : `Reset "${slotTitle}" to built-in.`,
                    )
                  }
                  data-testid="sysprompt-builtin-reset"
                >
                  <IconRefresh size={13} />
                  <span>{isZh ? '恢复默认' : 'Reset'}</span>
                </Button>
              ) : null}
              <Button
                size="compact"
                variant="secondary"
                disabled={emptyBuiltin}
                onClick={() => void handleOpenCompiledPreview()}
                data-testid="sysprompt-builtin-preview"
              >
                <IconEye size={13} />
                <span>{isZh ? '预览' : 'Preview'}</span>
              </Button>
            </div>
          </div>

          <div className="sysprompt-builtin-stack-section">
            <div className="sysprompt-section-head">
              <div className="sysprompt-section-heading">
                <span className="sysprompt-section-title">
                  {isZh ? '提示词堆叠' : 'Prompt stack'}
                </span>
                <span className="sysprompt-section-hint">
                  {isZh
                    ? '按从上到下顺序拼接；可添加 .md / .txt 文件，也可移除系统内置默认'
                    : 'Combined top to bottom; add .md / .txt files or remove built-in default'}
                </span>
              </div>
              <span className="sysprompt-preset-count">
                {emptyBuiltin
                  ? isZh
                    ? '已清空'
                    : 'Empty'
                  : isZh
                    ? `共 ${layerCount} 层`
                    : `${layerCount} layers`}
              </span>
            </div>

            {!activeStack.includeBuiltin ? (
              <div
                className="sysprompt-builtin-removed-bar"
                data-testid="sysprompt-builtin-removed-bar"
              >
                <span className="sysprompt-builtin-removed-text">
                  {activeStack.filePaths.length === 0
                    ? isZh
                      ? '已移除系统内置默认，当前不注入此模块默认提示词'
                      : 'Built-in default removed; nothing will be injected for this module'
                    : isZh
                      ? '已移除系统内置默认，仅使用下方堆叠文件'
                      : 'Built-in default removed; using only the stacked files below'}
                </span>
                <button
                  type="button"
                  className="sysprompt-bar-action"
                  disabled={saving}
                  onClick={() =>
                    void saveSlotStack(
                      { includeBuiltin: true, filePaths: activeStack.filePaths },
                      isZh
                        ? `已为「${slotTitle}」恢复系统内置默认。`
                        : `Restored built-in default for "${slotTitle}".`,
                    )
                  }
                  data-testid="sysprompt-builtin-restore-base"
                >
                  <IconPlus size={12} />
                  <span>{isZh ? '恢复内置' : 'Restore built-in'}</span>
                </button>
              </div>
            ) : null}

            <PromptFileStackEditor
              filePaths={activeStack.filePaths}
              candidates={candidates}
              {...(systemPromptsDir ? { systemPromptsDir } : {})}
              projectPath={effectiveProjectPath}
              readItemsByPath={readItemsByPath}
              loadingCandidates={loadingCandidates}
              disabled={saving}
              leadingSlot={leadingBuiltinRow}
              orderOffset={activeStack.includeBuiltin ? 1 : 0}
              emptySlotHint={
                isZh
                  ? '点击或输入 @ 添加 .md / .txt 文件替换内置默认（留空则不注入）'
                  : 'Click or type @ to stack .md / .txt files (leave empty to disable)'
              }
              onChangeFilePaths={(nextPaths) =>
                void saveSlotStack(
                  { includeBuiltin: activeStack.includeBuiltin, filePaths: nextPaths },
                  isZh ? `已更新「${slotTitle}」堆叠文件。` : `Updated "${slotTitle}" file stack.`,
                )
              }
              onPreviewFile={(filePath) => void handleOpenSingleFilePreview(filePath)}
              onRefreshCandidates={() => void refreshCandidates()}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
