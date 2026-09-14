/**
 * Proto-01 media generation row (`.gen`).
 * Shared by image and video: grind / thumb / err badge + title/meta + actions.
 */
import type { ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { IconAlertCircle } from './shell-icons';
import { getBehaviorActivitySpec } from './behavior-activity.js';
import { formatToolDuration } from './tool-call-head.js';
import { recoverSummaryFromInputPreview } from './tool-call-head.js';

export type MediaGenerationKind = 'image' | 'video';

export type MediaGenerationCardProps = {
  kind: MediaGenerationKind;
  locale?: 'zh-CN' | 'en';
  status?: ToolCardUi['status'];
  tool?: ToolCardUi;
  onCancel?: (() => void) | undefined;
  onRetry?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  onOpenLibrary?: (() => void) | undefined;
};

function titleFor(
  kind: MediaGenerationKind,
  status: ToolCardUi['status'],
  isChinese: boolean,
): string {
  if (status === 'running') {
    return kind === 'image'
      ? isChinese
        ? '正在生成图片'
        : 'Generating image'
      : isChinese
        ? '正在生成视频'
        : 'Generating video';
  }
  if (status === 'done') {
    return kind === 'image'
      ? isChinese
        ? '图片生成完成'
        : 'Image generated'
      : isChinese
        ? '视频生成完成'
        : 'Video generated';
  }
  return kind === 'image'
    ? isChinese
      ? '图片生成失败'
      : 'Image generation failed'
    : isChinese
      ? '视频生成失败'
      : 'Video generation failed';
}

function clipMeta(value: string, max = 48): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/** Build the mono subtitle: model · size · prompt/path/error. */
export function buildMediaGenerationMeta(input: {
  kind: MediaGenerationKind;
  status: ToolCardUi['status'];
  locale: 'zh-CN' | 'en';
  tool?: ToolCardUi;
}): string {
  const isChinese = input.locale !== 'en';
  const presentation = input.tool?.presentation;
  const parts: string[] = [];

  const model =
    presentation?.routedToolName?.trim() ||
    presentation?.title?.trim() ||
    (input.kind === 'image' ? 'image' : 'video');
  if (model && model !== 'image_gen' && model !== 'video_gen') {
    parts.push(model);
  } else {
    parts.push(input.kind === 'image' ? 'image' : 'video');
  }

  const prompt =
    recoverSummaryFromInputPreview(presentation?.inputPreview) ??
    (presentation?.summary && !presentation.summary.trim().startsWith('{')
      ? presentation.summary.trim()
      : undefined);

  if (input.status === 'running') {
    if (prompt) parts.push(`「${clipMeta(prompt, 36)}」`);
    return parts.join(' · ');
  }

  if (input.status === 'done') {
    if (typeof presentation?.durationMs === 'number') {
      parts.push(formatToolDuration(presentation.durationMs));
    }
    const path = presentation?.targetPaths?.[0] ?? presentation?.changedPaths?.[0];
    if (path) parts.push(clipMeta(path, 40));
    else if (prompt) parts.push(`「${clipMeta(prompt, 36)}」`);
    return parts.join(' · ');
  }

  const err =
    presentation?.error?.message?.trim() ||
    input.tool?.output?.trim().split('\n')[0] ||
    (isChinese ? '生成接口返回错误，可以重试' : 'The generation request failed; try again');
  parts.push(clipMeta(err, 56));
  return parts.join(' · ');
}

export function MediaGenerationCard(props: MediaGenerationCardProps): ReactElement {
  const isChinese = props.locale !== 'en';
  const status = props.status ?? 'running';
  const isRunning = status === 'running';
  const isCompleted = status === 'done';
  const isError = status === 'error';
  const activityId = props.kind === 'image' ? 'image' : 'video';
  const title = titleFor(props.kind, status, isChinese);
  const meta = buildMediaGenerationMeta({
    kind: props.kind,
    status,
    locale: props.locale ?? 'zh-CN',
    ...(props.tool !== undefined ? { tool: props.tool } : {}),
  });

  return (
    <div
      className={`gen media-generation-card image-generation-progress${
        props.kind === 'video' ? ' video-generation-progress' : ''
      } status-${status}`}
      data-testid={
        props.kind === 'image' ? 'image-generation-progress' : 'video-generation-progress'
      }
      data-activity-id={activityId}
      data-activity-animation={getBehaviorActivitySpec(activityId).animation}
      data-tool-status={status}
      role="status"
      aria-live="polite"
    >
      {isRunning ? (
        <span className="grind" aria-hidden="true" />
      ) : isCompleted ? (
        <span className="thumb" aria-hidden="true" />
      ) : (
        <span className="bdg err" aria-hidden="true">
          <IconAlertCircle className="i s12" />
        </span>
      )}
      <div className="tx">
        {title}
        <small>{meta}</small>
        {isRunning ? (
          <div className="bar" aria-hidden="true">
            <i />
          </div>
        ) : null}
      </div>
      {isRunning && props.onCancel ? (
        <button
          type="button"
          className="btn sm"
          data-testid="media-generation-cancel"
          onClick={props.onCancel}
        >
          {isChinese ? '取消' : 'Cancel'}
        </button>
      ) : null}
      {isCompleted ? (
        <span className="acts">
          <button type="button" className="btn sm" onClick={props.onOpen}>
            {isChinese ? '打开' : 'Open'}
          </button>
          <button type="button" className="btn sm" onClick={props.onOpenLibrary}>
            {isChinese ? '资料库 ↗' : 'Library ↗'}
          </button>
        </span>
      ) : null}
      {isError ? (
        <button type="button" className="btn sm pri" onClick={props.onRetry}>
          {isChinese ? '重试' : 'Retry'}
        </button>
      ) : null}
    </div>
  );
}
