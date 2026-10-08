import path from 'node:path';
import { parsePathArguments } from './attachment-paths.js';
import { readClipboardImage } from './clipboard-image.js';
import { AttachmentQueue, MAX_PROMPT_ATTACHMENTS, type PendingAttachment } from './tui-attachments.js';
import type { TuiHostLink } from './tui-host-link.js';

export type TuiAttachmentControllerOptions = {
  link: TuiHostLink;
  /** Uploads belong to a session's media vault, so attaching to a draft creates it. */
  ensureSession: () => Promise<string>;
  onChanged: () => void;
  onHint: (text: string) => void;
  onNotice: (tone: 'info' | 'error', text: string) => void;
};

/** `/attach`, `/paste`, `/detach` and dropped image paths for the TUI composer. */
export class TuiAttachmentController {
  private readonly queue: AttachmentQueue;
  /** Uploads in flight; a prompt sent meanwhile would miss them. */
  private uploading = 0;

  public constructor(private readonly options: TuiAttachmentControllerOptions) {
    this.queue = new AttachmentQueue({ request: (command) => options.link.request(command) });
  }

  public get isUploading(): boolean {
    return this.uploading > 0;
  }

  public describe(): string | undefined {
    if (this.uploading > 0) return '附件上传中…';
    return this.queue.count === 0 ? undefined : `附件 ${this.queue.count}`;
  }

  /** `/attach` alone lists what is queued; with paths it uploads them. */
  public async attachPaths(argument: string): Promise<void> {
    const paths = parsePathArguments(argument, process.cwd());
    if (paths.length === 0) {
      const labels = this.queue.labels();
      this.options.onNotice(
        'info',
        labels.length === 0
          ? '用法：/attach <文件路径…>，/paste 粘贴剪贴板图片（Ctrl+V），/detach 清空'
          : `待发送附件：${labels.join('、')}`,
      );
      return;
    }
    await this.track(async (sessionId) => {
      for (const filePath of paths) {
        try {
          await this.queue.addFile(sessionId, filePath, 'file-picker');
        } catch (error) {
          this.options.onNotice('error', `${path.basename(filePath)}：${describeError(error)}`);
        }
      }
    });
  }

  public async pasteClipboardImage(): Promise<void> {
    if (this.queue.count >= MAX_PROMPT_ATTACHMENTS) {
      this.options.onHint(`一条消息最多带 ${MAX_PROMPT_ATTACHMENTS} 个附件`);
      return;
    }
    const clipboard = await readClipboardImage();
    if (clipboard.kind === 'unsupported') {
      this.options.onHint(`读不到剪贴板：${clipboard.hint}`);
      return;
    }
    if (clipboard.kind === 'empty') {
      this.options.onHint('剪贴板里没有图片');
      return;
    }
    await this.track(async (sessionId) => {
      try {
        const name = `clipboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        await this.queue.addImageBytes(sessionId, clipboard.image.bytes, clipboard.image.mimeType, name);
      } catch (error) {
        this.options.onNotice('error', `粘贴图片失败：${describeError(error)}`);
      }
    });
  }

  public detach(): void {
    const cleared = this.queue.clear();
    this.options.onHint(cleared === 0 ? '没有待发送的附件' : `已移除 ${cleared} 个附件`);
  }

  /** Attach images whose paths the user dropped into the message itself. */
  public async adoptDroppedImages(sessionId: string, text: string): Promise<string> {
    const adopted = await this.queue.adoptImagePathsIn(sessionId, text);
    for (const failure of adopted.failures) this.options.onNotice('error', `图片未附上 — ${failure}`);
    return adopted.text;
  }

  public take(): PendingAttachment[] {
    return this.queue.take();
  }

  public restore(taken: readonly PendingAttachment[]): void {
    this.queue.restore(taken);
    this.options.onChanged();
  }

  private async track(work: (sessionId: string) => Promise<void>): Promise<void> {
    this.uploading += 1;
    this.options.onChanged();
    try {
      await work(await this.options.ensureSession());
    } finally {
      this.uploading -= 1;
      this.options.onChanged();
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
