/**
 * Compact `@` file-mention input and single-line ordered `.md` / `.txt` file stack.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  Dialog,
  IconArrowDown,
  IconArrowUp,
  IconClose,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconFolder,
  IconFolderOpen,
  Notice,
  StatusBadge,
} from '@piwin/ui-kit';
import {
  isSupportedSystemPromptFilePath,
  MAX_SYSTEM_PROMPT_STACK_FILES,
  type HostListDirData,
  type SystemPromptFileCandidate,
  type SystemPromptFileReadItem,
} from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { requestHostPickerEntry } from '../../host/host-picker-create-entry.js';
import { HostWorkspacePicker } from '../../host/host-workspace-picker';
import { useSettings } from '../settings-context';
import {
  describePromptFileSource,
  formatPromptByteSize,
  openPromptFileForEditing,
  promptFileDisplayName,
  promptFileExtensionLabel,
  revealPromptFileInFolder,
} from './prompt-file-actions';

function extractAtQuery(raw: string): { active: boolean; query: string } {
  const atIndex = raw.lastIndexOf('@');
  if (atIndex === -1) {
    return { active: false, query: '' };
  }
  return { active: true, query: raw.slice(atIndex + 1).trim().toLowerCase() };
}

export function PromptFileStackEditor(props: {
  filePaths: readonly string[];
  candidates: readonly SystemPromptFileCandidate[];
  systemPromptsDir?: string;
  projectPath: string | null;
  readItemsByPath: ReadonlyMap<string, SystemPromptFileReadItem>;
  loadingCandidates?: boolean;
  disabled?: boolean;
  leadingSlot?: ReactElement | null;
  orderOffset?: number;
  emptySlotHint?: string;
  onChangeFilePaths: (nextPaths: string[]) => void;
  onPreviewFile: (filePath: string) => void;
  onRefreshCandidates: () => void;
}): ReactElement {
  const { hostClient, setError, setInfo } = useSettings();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const [inputValue, setInputValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputNotice, setInputNotice] = useState<string | null>(null);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerPath, setFilePickerPath] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const comboboxRef = useRef<HTMLDivElement | null>(null);

  const atState = useMemo(() => extractAtQuery(inputValue), [inputValue]);
  const existingSet = useMemo(() => new Set(props.filePaths), [props.filePaths]);

  const filteredCandidates = useMemo(() => {
    const q = atState.query;
    const matched = props.candidates.filter((item) => {
      if (!q) return true;
      return (
        item.fileName.toLowerCase().includes(q) ||
        item.displayPath.toLowerCase().includes(q) ||
        item.path.toLowerCase().includes(q)
      );
    });
    return matched.slice(0, 40);
  }, [atState.query, props.candidates]);

  const groupedCandidates = useMemo(() => {
    const globalItems: Array<{ item: SystemPromptFileCandidate; flatIndex: number }> = [];
    const projectItems: Array<{ item: SystemPromptFileCandidate; flatIndex: number }> = [];
    filteredCandidates.forEach((item, index) => {
      if (item.source === 'global') {
        globalItems.push({ item, flatIndex: index });
      } else {
        projectItems.push({ item, flatIndex: index });
      }
    });
    return { globalItems, projectItems };
  }, [filteredCandidates]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [atState.query, filteredCandidates.length]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutsideClick(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (comboboxRef.current && target && !comboboxRef.current.contains(target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [menuOpen]);

  function addFilePath(rawPath: string): boolean {
    const cleaned = rawPath.trim().replace(/^@+/, '').trim();
    if (!cleaned) return false;
    if (!isSupportedSystemPromptFilePath(cleaned)) {
      setInputNotice(isZh ? '仅支持 .md 或 .txt 文件' : 'Only .md and .txt files are supported.');
      return false;
    }
    if (existingSet.has(cleaned)) {
      setInputNotice(isZh ? '该文件已在列表中' : 'Already in stack.');
      return false;
    }
    if (props.filePaths.length >= MAX_SYSTEM_PROMPT_STACK_FILES) {
      setInputNotice(
        isZh
          ? `最多堆叠 ${MAX_SYSTEM_PROMPT_STACK_FILES} 个文件`
          : `Max ${MAX_SYSTEM_PROMPT_STACK_FILES} files.`,
      );
      return false;
    }
    setInputNotice(null);
    props.onChangeFilePaths([...props.filePaths, cleaned]);
    setInputValue('');
    setMenuOpen(false);
    return true;
  }

  function moveItem(from: number, to: number): void {
    if (from === to || from < 0 || to < 0) return;
    if (from >= props.filePaths.length || to >= props.filePaths.length) return;
    const next = [...props.filePaths];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    props.onChangeFilePaths(next);
  }

  function removeItem(index: number): void {
    props.onChangeFilePaths(props.filePaths.filter((_, idx) => idx !== index));
  }

  function handleInputChange(nextValue: string): void {
    setInputValue(nextValue);
    setInputNotice(null);
    setMenuOpen(nextValue.includes('@'));
  }

  function triggerAtPicker(): void {
    const next = inputValue.includes('@') ? inputValue : `${inputValue}@`;
    setInputValue(next);
    setInputNotice(null);
    setMenuOpen(true);
    props.onRefreshCandidates();
    inputRef.current?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (menuOpen && filteredCandidates.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCandidates.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length,
        );
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const candidate = filteredCandidates[selectedIndex];
        if (candidate) {
          addFilePath(candidate.path);
          return;
        }
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (inputValue.trim().length > 0) {
        addFilePath(inputValue);
      }
    } else if (event.key === 'Escape') {
      setMenuOpen(false);
    }
  }

  async function handleEditFile(filePath: string): Promise<void> {
    const result = await openPromptFileForEditing(filePath, isZh);
    if (result.ok) {
      setInfo(
        result.mode === 'editor'
          ? isZh
            ? '已在外部编辑器打开源文件。'
            : 'Opened in external editor.'
          : isZh
            ? '已复制文件路径。'
            : 'File path copied.',
        'info',
      );
      return;
    }
    setError(result.message);
  }

  async function handleReveal(targetPath: string): Promise<void> {
    const result = await revealPromptFileInFolder(targetPath);
    if (!result.ok) {
      setError(isZh ? '无法定位本地路径。' : 'Could not reveal local path.');
    }
  }

  function openWorkspaceFilePicker(): void {
    setFilePickerPath(props.systemPromptsDir ?? props.projectPath ?? '');
    setFilePickerOpen(true);
  }

  const showMenu = menuOpen && atState.active;

  return (
    <div className="sysprompt-stack-editor" data-testid="system-prompts-file-stack-editor">
      <div className="sysprompt-at-combobox" ref={comboboxRef}>
        <div className="sysprompt-at-input-shell">
          <button
            type="button"
            className="sysprompt-at-trigger-chip"
            onClick={triggerAtPicker}
            disabled={props.disabled}
            title={isZh ? '使用 @ 检索 .md / .txt 文件' : 'Search .md / .txt with @'}
            data-testid="system-prompts-at-trigger"
          >
            @
          </button>
          <input
            ref={inputRef}
            type="text"
            className="sysprompt-at-input"
            disabled={props.disabled}
            value={inputValue}
            onChange={(event) => handleInputChange(event.currentTarget.value)}
            onFocus={() => {
              if (inputValue.includes('@')) setMenuOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              isZh ? '输入 @ 添加 .md / .txt 文件，或粘贴路径回车…' : 'Type @ to add .md / .txt file…'
            }
            aria-label={isZh ? '使用 @ 引用提示词文件' : 'Reference prompt files with @'}
            aria-expanded={showMenu}
            data-testid="system-prompts-at-input"
          />
          <div className="sysprompt-at-inline-actions">
            {hostClient?.request ? (
              <button
                type="button"
                className="sysprompt-bar-action"
                disabled={props.disabled}
                onClick={openWorkspaceFilePicker}
                title={isZh ? '从目录树浏览选择 .md / .txt 文件' : 'Browse local files'}
                data-testid="system-prompts-browse-files"
              >
                <IconFolder size={13} />
                <span>{isZh ? '选择文件' : 'Browse'}</span>
              </button>
            ) : null}
            {props.systemPromptsDir ? (
              <button
                type="button"
                className="sysprompt-bar-icon"
                disabled={props.disabled}
                onClick={() => void handleReveal(props.systemPromptsDir!)}
                title={
                  isZh
                    ? `打开全局提示词目录：${props.systemPromptsDir}`
                    : `Open global dir: ${props.systemPromptsDir}`
                }
                aria-label={isZh ? '打开全局提示词目录' : 'Open global prompts directory'}
                data-testid="system-prompts-open-global-dir"
              >
                <IconExternalLink size={13} />
              </button>
            ) : null}
          </div>
        </div>

        {showMenu ? (
          <div
            className="sysprompt-at-popover"
            role="listbox"
            aria-label={isZh ? '提示词文件候选' : 'Prompt file candidates'}
            data-testid="system-prompts-at-menu"
          >
            {props.loadingCandidates ? (
              <div className="sysprompt-at-empty">{isZh ? '扫描中…' : 'Scanning…'}</div>
            ) : filteredCandidates.length === 0 ? (
              <div className="sysprompt-at-empty">
                {isZh ? '无匹配 .md / .txt 文件' : 'No matching .md / .txt files'}
              </div>
            ) : (
              <>
                {groupedCandidates.globalItems.length > 0 ? (
                  <div className="sysprompt-at-group">
                    <div className="sysprompt-at-group-label">
                      {isZh ? '全局库 (~/.piwin/system-prompts)' : 'Global Library'}
                    </div>
                    {groupedCandidates.globalItems.map(({ item, flatIndex }) => {
                      const already = existingSet.has(item.path);
                      const selected = flatIndex === selectedIndex;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={already}
                          className={`sysprompt-at-option${selected ? ' is-selected' : ''}${
                            already ? ' is-added' : ''
                          }`}
                          data-testid={`sysprompt-at-option-${item.fileName}`}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onClick={() => addFilePath(item.path)}
                        >
                          <span className="sysprompt-format-badge">{item.extension.toUpperCase()}</span>
                          <span className="sysprompt-at-option-main">
                            <span className="sysprompt-at-option-name">@{item.fileName}</span>
                            {item.displayPath !== item.fileName ? (
                              <span className="sysprompt-at-option-path">{item.displayPath}</span>
                            ) : null}
                          </span>
                          <span className="sysprompt-at-option-meta">
                            {already ? (isZh ? '已添加' : 'Added') : formatPromptByteSize(item.sizeBytes)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {groupedCandidates.projectItems.length > 0 ? (
                  <div className="sysprompt-at-group">
                    <div className="sysprompt-at-group-label">
                      {isZh ? '当前项目' : 'Current Project'}
                    </div>
                    {groupedCandidates.projectItems.map(({ item, flatIndex }) => {
                      const already = existingSet.has(item.path);
                      const selected = flatIndex === selectedIndex;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={already}
                          className={`sysprompt-at-option${selected ? ' is-selected' : ''}${
                            already ? ' is-added' : ''
                          }`}
                          data-testid={`sysprompt-at-option-${item.fileName}`}
                          onMouseEnter={() => setSelectedIndex(flatIndex)}
                          onClick={() => addFilePath(item.path)}
                        >
                          <span className="sysprompt-format-badge">{item.extension.toUpperCase()}</span>
                          <span className="sysprompt-at-option-main">
                            <span className="sysprompt-at-option-name">@{item.fileName}</span>
                            {item.displayPath !== item.fileName ? (
                              <span className="sysprompt-at-option-path">{item.displayPath}</span>
                            ) : null}
                          </span>
                          <span className="sysprompt-at-option-meta">
                            {already ? (isZh ? '已添加' : 'Added') : formatPromptByteSize(item.sizeBytes)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {inputNotice ? (
        <Notice tone="warning" testId="system-prompts-at-notice">
          {inputNotice}
        </Notice>
      ) : null}

      {props.filePaths.length === 0 && !props.leadingSlot ? (
        <button
          type="button"
          className="sysprompt-empty-slot"
          disabled={props.disabled}
          onClick={triggerAtPicker}
          data-testid="system-prompts-stack-empty"
        >
          <span className="sysprompt-empty-at">@</span>
          <span>
            {props.emptySlotHint ??
              (isZh
                ? '点击或输入 @ 引用 .md / .txt 文件，按堆叠顺序拼接'
                : 'Click or type @ to stack .md / .txt files in order')}
          </span>
        </button>
      ) : (
        <ol className="sysprompt-stack-list" data-testid="system-prompts-stack-list">
          {props.leadingSlot}
          {props.filePaths.map((filePath, index) => {
            const readItem = props.readItemsByPath.get(filePath);
            const fileName = promptFileDisplayName(filePath);
            const ext = promptFileExtensionLabel(filePath);
            const sourceInfo = describePromptFileSource(filePath, {
              systemPromptsDir: props.systemPromptsDir,
              projectPath: props.projectPath,
              isZh,
            });
            const isMissing = readItem !== undefined && !readItem.exists;
            const orderTag = String(index + 1 + (props.orderOffset ?? 0)).padStart(2, '0');
            const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
            const resolvedPath = readItem?.resolvedPath ?? filePath;
            const showSubPath = sourceInfo.compactPath !== fileName;

            return (
              <li
                key={filePath}
                draggable={!props.disabled}
                onDragStart={() => setDragIndex(index)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (dropIndex !== index) setDropIndex(index);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragIndex !== null) moveItem(dragIndex, index);
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setDropIndex(null);
                }}
                className={`sysprompt-stack-card${isMissing ? ' is-missing' : ''}${
                  isDropTarget ? ' is-drop-target' : ''
                }`}
                data-testid={`sysprompt-stack-item-${index}`}
              >
                <button
                  type="button"
                  className="sysprompt-stack-card-main"
                  title={resolvedPath}
                  onClick={() => props.onPreviewFile(filePath)}
                  data-testid={`sysprompt-stack-preview-${index}`}
                >
                  <span className="sysprompt-stack-order" aria-hidden="true">
                    {orderTag}
                  </span>
                  <span className="sysprompt-format-badge">{ext}</span>
                  <span className="sysprompt-stack-filename">@{fileName}</span>
                  <span className="sysprompt-source-pill">{sourceInfo.badge}</span>
                  {showSubPath ? (
                    <span className="sysprompt-stack-subpath">{sourceInfo.compactPath}</span>
                  ) : null}
                  {isMissing ? (
                    <StatusBadge
                      tone="warning"
                      label={isZh ? '缺失' : 'Missing'}
                      showDot={false}
                    />
                  ) : readItem ? (
                    <span className="sysprompt-stack-bytes">
                      {formatPromptByteSize(readItem.sizeBytes)}
                    </span>
                  ) : null}
                  <span className="sysprompt-stack-preview-eye" aria-hidden="true">
                    <IconEye size={13} />
                  </span>
                </button>

                <div className="sysprompt-stack-card-actions">
                  <button
                    type="button"
                    className="sysprompt-icon-action"
                    onClick={() => void handleEditFile(resolvedPath)}
                    title={isZh ? '去源文件编辑' : 'Edit source file'}
                    aria-label={isZh ? `编辑 ${fileName}` : `Edit ${fileName}`}
                    data-testid={`sysprompt-stack-edit-${index}`}
                  >
                    <IconEdit size={13} />
                  </button>
                  <button
                    type="button"
                    className="sysprompt-icon-action"
                    onClick={() => void handleReveal(resolvedPath)}
                    title={isZh ? '在文件夹中显示' : 'Reveal in folder'}
                    aria-label={isZh ? `定位 ${fileName}` : `Reveal ${fileName}`}
                  >
                    <IconFolderOpen size={13} />
                  </button>
                  <button
                    type="button"
                    className="sysprompt-icon-action"
                    disabled={index === 0 || props.disabled}
                    onClick={() => moveItem(index, index - 1)}
                    title={isZh ? '上移' : 'Move up'}
                    aria-label={isZh ? `上移 ${fileName}` : `Move ${fileName} up`}
                    data-testid={`sysprompt-stack-up-${index}`}
                  >
                    <IconArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="sysprompt-icon-action"
                    disabled={index === props.filePaths.length - 1 || props.disabled}
                    onClick={() => moveItem(index, index + 1)}
                    title={isZh ? '下移' : 'Move down'}
                    aria-label={isZh ? `下移 ${fileName}` : `Move ${fileName} down`}
                    data-testid={`sysprompt-stack-down-${index}`}
                  >
                    <IconArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="sysprompt-icon-action is-danger"
                    disabled={props.disabled}
                    onClick={() => removeItem(index)}
                    title={isZh ? '移除' : 'Remove'}
                    aria-label={isZh ? `移除 ${fileName}` : `Remove ${fileName}`}
                    data-testid={`sysprompt-stack-remove-${index}`}
                  >
                    <IconClose size={13} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <Dialog
        label={isZh ? '选择系统提示词文件 (.md / .txt)' : 'Choose prompt file (.md / .txt)'}
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        testId="system-prompts-file-picker-dialog"
        contentClassName="workspace-open-dialog"
      >
        <HostWorkspacePicker
          locale={isZh ? 'zh-CN' : 'en'}
          currentPath={filePickerPath}
          onCurrentPathChange={setFilePickerPath}
          mode="file"
          listDirectory={async (path, includeHidden) => {
            const response = await hostClient?.request?.({
              type: 'host/list-dir',
              ...(path ? { path } : {}),
              includeHidden: includeHidden ?? false,
            });
            if (!response?.success) {
              throw new Error(response?.error ?? 'host/list-dir failed');
            }
            return response.data as HostListDirData;
          }}
          {...(hostClient?.supportsCommand?.('host/create-entry') && hostClient.request
            ? {
                createEntry: (input) =>
                  requestHostPickerEntry(
                    (command) => {
                      const send = hostClient.request;
                      if (!send) throw new Error('Host connection is unavailable.');
                      return send(command);
                    },
                    input,
                    isZh ? 'zh-CN' : 'en',
                  ),
              }
            : {})}
          onConfirm={(selectedPath) => {
            if (addFilePath(selectedPath)) {
              setFilePickerOpen(false);
            }
          }}
          onCancel={() => setFilePickerOpen(false)}
        />
      </Dialog>
    </div>
  );
}
