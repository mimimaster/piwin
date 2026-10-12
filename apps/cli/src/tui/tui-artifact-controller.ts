import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { osc52Sequence } from './clipboard-text.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  artifactFileName,
  artifactSourceFileName,
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

/** The OS opener for a file: `open` (macOS), `start` via cmd (Windows), `xdg-open` elsewhere. */
export function systemOpenCommand(platform: NodeJS.Platform, filePath: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [filePath]];
  // `start` takes its first quoted argument as a window title, hence the empty one.
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', filePath]];
  return ['xdg-open', [filePath]];
}

export const openWithSystemBrowser: FileOpener = (filePath) =>
  new Promise((resolve, reject) => {
    const [command, args] = systemOpenCommand(process.platform, filePath);
    execFile(command, args, { windowsHide: true }, (error) => (error === null ? resolve() : reject(error)));
  });

export type TuiArtifactControllerOptions = {
  modals: TuiModalStack;
  getTranscript: () => TranscriptState;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
  onError: (error: unknown) => void;
  /** Directory "保存到项目" writes into: the session's project root, else the working directory. */
  getProjectRoot?: () => string | undefined;
  /** Writes raw bytes to the terminal (for the OSC 52 clipboard sequence). */
  writeTerminal?: (data: string) => void;
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

  /** The shortcut: newest artifact the policy lets render, straight to the browser. */
  public openLatest(): void {
    const artifacts = listTranscriptArtifacts(this.options.getTranscript());
    const latest = artifacts.find((artifact) => artifact.blocked === undefined);
    if (latest === undefined) {
      this.options.onHint(artifacts.length === 0 ? '当前这页对话里没有 artifact' : '最新的 artifact 都被拦截了，/artifacts 可以看源码');
      return;
    }
    this.exportToBrowser(latest).catch(this.options.onError);
  }

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
            ? [{ value: 'browser', label: 'o 在浏览器里打开', description: '导出为带沙箱的本地页面' }]
            : []),
          { value: 'source', label: 's 查看源码' },
          { value: 'save', label: 'w 保存到项目', description: `原始源码，.${artifact.kind}` },
          { value: 'copy', label: 'c 复制源码', description: '经终端（OSC 52）写入剪贴板' },
          { value: 'close', label: '关闭' },
        ],
        shortcuts: { o: 'browser', s: 'source', w: 'save', c: 'copy' },
        onSelect: (value) => {
          modals.close();
          if (value === 'browser') this.exportToBrowser(artifact).catch(this.options.onError);
          else if (value === 'source') this.showSource(artifact);
          else if (value === 'save') this.saveToProject(artifact).catch(this.options.onError);
          else if (value === 'copy') this.copySource(artifact);
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

  /** Raw source into the project root; an existing file is never overwritten. */
  public async saveToProject(artifact: TranscriptArtifact): Promise<string> {
    const directory = this.options.getProjectRoot?.() ?? process.cwd();
    for (let attempt = 0; ; attempt += 1) {
      const filePath = path.join(directory, artifactSourceFileName(artifact, attempt));
      try {
        await writeFile(filePath, artifact.source, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 999) continue;
        throw error;
      }
      this.options.onNotice('info', `已保存「${artifact.title}」\n${filePath}`);
      return filePath;
    }
  }

  public copySource(artifact: TranscriptArtifact): void {
    if (this.options.writeTerminal === undefined) {
      this.options.onHint('这个终端不能写剪贴板');
      return;
    }
    this.options.writeTerminal(osc52Sequence(artifact.source));
    this.options.onHint(`已复制「${artifact.title}」源码（终端需支持 OSC 52）`);
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
