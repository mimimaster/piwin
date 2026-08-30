import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DocumentManifest,
  GenerationJob,
  HostResponse,
  IngestionJob,
  PiwinConfig,
  ScannedDocFile,
  ScannedFileV2,
} from '@piwin/contracts';
import { loadRecentFolders, saveRecentFolder } from '../../doccards-recent-folders.js';
import { pickProjectDirectory } from '../../pick-project-directory.js';
import { waitForDoccardsIndexJob } from '../../doccards-index-job.js';
import { runDoccardsGenerate } from '../../doccards-generate-client.js';
import { deriveKnowledgeLoop, generateDisabledCopy } from '../../knowledge/knowledge-loop-state.js';
import {
  defaultSelectedSupportedPaths,
  formatIngestionWarnings,
  readyRelativePaths,
} from '../../knowledge/knowledge-selection.js';
import { knowledgeCapabilityLights } from '../../knowledge-capabilities.js';

export type FlashcardsProduceCommand =
  | { type: 'config/get' }
  | { type: 'doccards/scan-folder'; folderPath: string }
  | { type: 'doccards/index-folder'; folderPath: string; includeFiles?: string[] }
  | { type: 'doccards/index-status'; folderPath: string }
  | { type: 'doccards/generate'; folderPath: string; includeFiles?: string[]; topic?: string }
  | { type: 'doccards/generation-status'; folderPath: string; includeFiles?: string[]; topic?: string }
  | { type: 'doccards/forget-folder'; folderPath: string }
  | { type: 'doccards/list-by-folder'; folderPath: string };

export type FlashcardsProduceRequest = (command: FlashcardsProduceCommand) => Promise<HostResponse>;

function folderBasename(folderPath: string): string {
  const parts = folderPath.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || folderPath;
}

export function useFlashcardsProduce(input: {
  request: FlashcardsProduceRequest;
  projectPath?: string | null | undefined;
  locale: 'zh-CN' | 'en';
  onCardsChanged?: () => void;
}) {
  const requestRef = useRef(input.request);
  requestRef.current = input.request;
  const onCardsChangedRef = useRef(input.onCardsChanged);
  onCardsChangedRef.current = input.onCardsChanged;

  const [selectedPath, setSelectedPath] = useState('');
  const [mountedFolders, setMountedFolders] = useState<string[]>([]);
  const [folderCardCount, setFolderCardCount] = useState(0);
  const [scannedFiles, setScannedFiles] = useState<ScannedDocFile[]>([]);
  const [unsupportedFiles, setUnsupportedFiles] = useState<ScannedFileV2[]>([]);
  const [documents, setDocuments] = useState<DocumentManifest[]>([]);
  const [selectedSupported, setSelectedSupported] = useState<string[]>([]);
  const [indexingJob, setIndexingJob] = useState<IngestionJob | null>(null);
  const [generationJob, setGenerationJob] = useState<GenerationJob | null>(null);
  const [dismissedGenerationId, setDismissedGenerationId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [config, setConfig] = useState<PiwinConfig | null>(null);

  useEffect(() => {
    let active = true;
    void requestRef.current({ type: 'config/get' }).then((res) => {
      if (!active || !res.success || !res.data) return;
      const payload = (res.data as { config?: PiwinConfig }).config ?? (res.data as PiwinConfig);
      if (payload && typeof payload === 'object') setConfig(payload);
    });
    const recent = loadRecentFolders();
    setMountedFolders(recent);
    if (recent[0]) setSelectedPath(recent[0]);
    return () => {
      active = false;
    };
  }, []);

  const loadFolder = useCallback(async (folderPath: string) => {
    if (!folderPath) return;
    setBusy(true);
    try {
      const scanRes = await requestRef.current({ type: 'doccards/scan-folder', folderPath });
      let files: ScannedDocFile[] = [];
      if (scanRes.success && scanRes.data) {
        const scanData = scanRes.data as { files?: ScannedDocFile[]; unsupported?: ScannedFileV2[] };
        files = scanData.files ?? [];
        setScannedFiles(files);
        setUnsupportedFiles(scanData.unsupported ?? []);
      }
      const statusRes = await requestRef.current({ type: 'doccards/index-status', folderPath });
      let nextDocuments: DocumentManifest[] = [];
      if (statusRes.success && statusRes.data) {
        const statusData = statusRes.data as { job?: IngestionJob | null; documents?: DocumentManifest[] };
        setIndexingJob(statusData.job ?? null);
        nextDocuments = statusData.documents ?? [];
        setDocuments(nextDocuments);
      }
      const cardsRes = await requestRef.current({ type: 'doccards/list-by-folder', folderPath });
      if (cardsRes.success && cardsRes.data) {
        const cardData = cardsRes.data as { records?: unknown[]; cards?: unknown[] };
        setFolderCardCount((cardData.records ?? cardData.cards ?? []).length);
      } else {
        setFolderCardCount(0);
      }
      setSelectedSupported(defaultSelectedSupportedPaths(files, nextDocuments));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPath) void loadFolder(selectedPath);
  }, [selectedPath, loadFolder]);

  const mountFolder = useCallback((folder: string) => {
    saveRecentFolder(folder);
    setMountedFolders((current) => [folder, ...current.filter((path) => path !== folder)]);
    setSelectedPath(folder);
    setGenerationJob(null);
    setDismissedGenerationId(null);
    setActionError(null);
  }, []);

  const pickFolder = useCallback(async () => {
    const picked = await pickProjectDirectory({
      title: input.locale === 'zh-CN' ? '选择文档文件夹' : 'Choose a document folder',
    });
    if (picked) mountFolder(picked);
  }, [input.locale, mountFolder]);

  const startIndex = useCallback(async () => {
    if (!selectedPath || busy || selectedSupported.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const started = await requestRef.current({
        type: 'doccards/index-folder',
        folderPath: selectedPath,
        includeFiles: selectedSupported,
      });
      if (!started.success) {
        setActionError(started.error);
        return;
      }
      const job = await waitForDoccardsIndexJob(requestRef.current, selectedPath);
      setIndexingJob(job);
      const warningText = formatIngestionWarnings(job.warnings);
      if (warningText) setActionError(warningText);
      await loadFolder(selectedPath);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, loadFolder, selectedPath, selectedSupported]);

  const startGenerate = useCallback(async () => {
    if (!selectedPath || busy || selectedSupported.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const job = await runDoccardsGenerate((command) => requestRef.current(command), {
        folderPath: selectedPath,
        includeFiles: selectedSupported,
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        onProgress: setGenerationJob,
      });
      setGenerationJob(job);
      setDismissedGenerationId(null);
      onCardsChangedRef.current?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy, selectedPath, selectedSupported, topic]);

  const forgetFolder = useCallback(async () => {
    if (!selectedPath) return;
    const confirmed = window.confirm(
      input.locale === 'zh-CN' ? '忘掉此文件夹下的卡？' : 'Forget cards from this folder?',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await requestRef.current({ type: 'doccards/forget-folder', folderPath: selectedPath });
      onCardsChangedRef.current?.();
      await loadFolder(selectedPath);
    } finally {
      setBusy(false);
    }
  }, [input.locale, loadFolder, selectedPath]);

  const isEmbeddingConfigured = useMemo(() => {
    const lights = knowledgeCapabilityLights(config ?? undefined);
    return lights.find((item) => item.id === 'embedding')?.configured ?? false;
  }, [config]);

  const view = deriveKnowledgeLoop({
    folderPath: selectedPath || null,
    selectedSupported,
    documents,
    indexJob: indexingJob,
    generationJob,
    userView: 'loop',
    dismissedGenerationId,
  });
  const generateReason = generateDisabledCopy(
    view.generateBlockReason,
    { mineruMissing: unsupportedFiles.some((file) => file.unsupportedReason === 'MINERU_NOT_CONFIGURED') },
    input.locale,
  );
  const createdCount = generationJob?.created ?? generationJob?.createdCardIds?.length ?? 0;
  const readyCount = readyRelativePaths(documents).size;
  const folders = useMemo(() => {
    const items = [...mountedFolders];
    if (input.projectPath && !items.includes(input.projectPath)) {
      items.push(input.projectPath);
    }
    return items;
  }, [input.projectPath, mountedFolders]);

  return {
    selectedPath,
    selectedName: selectedPath ? folderBasename(selectedPath) : '',
    folders,
    folderCardCount,
    readyCount,
    scannedFiles,
    unsupportedFiles,
    documents,
    selectedSupported,
    setSelectedSupported,
    indexingJob,
    generationJob,
    topic,
    setTopic,
    busy,
    actionError,
    isEmbeddingConfigured,
    view,
    generateReason,
    createdCount,
    pickFolder,
    mountFolder,
    selectFolder: mountFolder,
    reloadFolder: () => (selectedPath ? loadFolder(selectedPath) : Promise.resolve()),
    useProject: input.projectPath ? () => mountFolder(input.projectPath as string) : undefined,
    startIndex,
    startGenerate,
    forgetFolder,
    dismissResult: () => {
      if (generationJob) setDismissedGenerationId(generationJob.id);
    },
  };
}
