import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  artifactFileName,
  buildArtifactHostPage,
  listTranscriptArtifacts,
  type TranscriptArtifact,
} from './artifact-export.js';
import { ChoiceOverlay } from './choice-overlay.js';
import type { TranscriptState } from './transcript-model.js';
import type { TuiModalStack } from './tui-modals.js';
import { ViewerOverlay } from './viewer-overlay.js';

/** Hand a local file to the system's default browser. */
export type FileOpener = (filePath: string) => Promise<void>;

const openWithSystemBrowser: FileOpener = (filePath) =>
  new Promise((resolve, reject) => {
    const [command, args] =
      process.platform === 'darwin'
        ? (['open', [filePath]] as const)
        : process.platform === 'win32'
          ? // `start` takes its first quoted argument as a window title.
            (['cmd', ['/c', 'start', '', filePath]] as const)
          : (['xdg-open', [filePath]] as const);
    execFile(command, [...args], { windowsHide: true }, (error) => (error === null ? resolve() : reject(error)));
  });

export type TuiArtifactControllerOptions = {
  modals: TuiModalStack;
  getTranscript: () => TranscriptState;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
  /** Test seams. */
  openFile?: FileOpener;
  exportRoot?: string;
};

/**
 * Artifacts of the conversation on screen. A terminal has no way to draw
 * them, so this lists them, shows their source, and exports one to a
 * sandboxed page for the browser on the machine the TUI runs on.
 */
export class TuiArtifactController {
  public constructor(private readonly options: TuiArtifactControllerOptions) {}

  public open(): void {
    const artifacts = listTranscriptArtifacts(this.options.getTranscript());
    if (artifacts.length === 0) {
      this.options.onHint('当前这页对话里没有 artifact');
      return;
    }
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: 'Artifact',
        message: '从新到旧。终端里不能直接渲染，可以看源码，或在浏览器里打开。',
        items: artifacts.map((artifact) => ({
          value: artifact.key,
          label: artifact.title,
          description: [artifact.kind.toUpperCase(), artifact.blocked === undefined ? undefined : `已拦截：${artifact.blocked}`]
            .filter((part): part is string => part !== undefined)
            .join(' · '),
        })),
        onSelect: (key) => {
          modals.close();
          const artifact = artifacts.find((entry) => entry.key === key);
          if (artifact !== undefined) this.openArtifact(artifact);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private openArtifact(artifact: TranscriptArtifact): void {
    const { modals } = this.options;
    modals.show(
      new ChoiceOverlay({
        title: artifact.title,
        ...(artifact.blocked === undefined
          ? {}
          : { message: `策略不允许渲染这个 artifact：${artifact.blocked}。桌面端同样不会渲染它。` }),
        items: [
          ...(artifact.blocked === undefined
            ? [{ value: 'browser', label: '在浏览器里打开', description: '导出为带沙箱的本地页面' }]
            : []),
          { value: 'source', label: '查看源码' },
          { value: 'close', label: '关闭' },
        ],
        onSelect: (value) => {
          modals.close();
          if (value === 'browser') this.exportToBrowser(artifact).catch(this.options.onError);
          else if (value === 'source') this.showSource(artifact);
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  private showSource(artifact: TranscriptArtifact): void {
    const { modals } = this.options;
    modals.show(
      new ViewerOverlay({
        title: `${artifact.title}（源码）`,
        lines: artifact.source.split('\n'),
        onClose: () => {
          modals.close();
          this.openArtifact(artifact);
        },
      }),
    );
  }

  private async exportToBrowser(artifact: TranscriptArtifact): Promise<void> {
    const page = buildArtifactHostPage(artifact);
    if (page === undefined) return;
    // A fresh directory per export: nothing else lives beside the page.
    const directory = await mkdtemp(path.join(this.options.exportRoot ?? tmpdir(), 'piwin-artifact-'));
    const filePath = path.join(directory, artifactFileName(artifact));
    await writeFile(filePath, page, { encoding: 'utf8', mode: 0o600 });
    try {
      await (this.options.openFile ?? openWithSystemBrowser)(filePath);
      this.options.onNotice('info', `已在浏览器打开「${artifact.title}」\n${filePath}`);
    } catch {
      // No opener on this machine (a headless box): the file is still there to open by hand.
      this.options.onNotice('info', `没能自动打开浏览器，页面已导出到：\n${filePath}`);
    }
  }
}
