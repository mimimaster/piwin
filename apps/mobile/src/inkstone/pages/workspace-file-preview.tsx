import { useState, type ReactElement } from 'react';
import type { ProjectReadFileData } from '@piwin/contracts';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';
import { Icon } from '../icons.js';
import { CodeView } from '../syntax/CodeView.js';
import { filePreviewKind } from '../syntax/file-kind.js';

export type WorkspaceFile = Pick<
  ProjectReadFileData,
  'relativePath' | 'content' | 'byteSize' | 'truncated' | 'isBinary' | 'previewDataUrl' | 'previewThumbDataUrl'
>;

/**
 * One Host file, previewed by kind: highlighted code, rendered Markdown (with
 * a source toggle), the Host's image preview, or an honest "binary" note.
 */
export function WorkspaceFilePreview({
  file,
  onBack,
  onReference,
}: {
  file: WorkspaceFile;
  onBack: () => void;
  onReference: () => void;
}): ReactElement {
  const kind = filePreviewKind(file.relativePath);
  const [showSource, setShowSource] = useState(false);
  const name = file.relativePath.split('/').pop() ?? file.relativePath;
  const image = file.previewDataUrl ?? file.previewThumbDataUrl;

  return (
    <article className="file-preview">
      <header className="file-preview-head">
        <button className="icon-button" type="button" aria-label="返回目录" onClick={onBack}>
          <Icon name="chevl" />
        </button>
        <span className="grow">
          <strong>{name}</strong>
          <small>
            {file.relativePath} · {formatSize(file.byteSize)}
          </small>
        </span>
        {kind.kind === 'markdown' ? (
          <button className="chip" type="button" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>
            {showSource ? '预览' : '源码'}
          </button>
        ) : null}
        <button className="chip" type="button" onClick={onReference}>
          引用
        </button>
      </header>
      {image !== undefined ? (
        <div className="file-image">
          <img src={image} alt={name} />
          {file.previewDataUrl === undefined ? <p className="muted">图片较大，显示的是 Host 生成的缩略图。</p> : null}
        </div>
      ) : file.isBinary ? (
        <p className="muted">这是二进制文件，手机上不预览内容。</p>
      ) : kind.kind === 'markdown' && !showSource ? (
        <div className="assistant-prose file-markdown">
          <MobileMarkdown content={file.content} />
        </div>
      ) : (
        <CodeView code={file.content} language={kind.kind === 'code' ? kind.language : kind.kind === 'markdown' ? 'markdown' : undefined} />
      )}
      {file.truncated ? <p className="muted">文件较长，只显示了 Host 返回的前一部分。</p> : null}
    </article>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  return `${bytes} B`;
}
