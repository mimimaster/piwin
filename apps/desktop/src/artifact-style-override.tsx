/**
 * Expressive artifacts the host cannot vouch for (design.md §6.4): a quiet
 * badge when the in-frame probe finds low contrast or a theme mismatch, and a
 * one-click "view with the theme" that re-renders under host style. Never an
 * automatic rewrite.
 */
import type { ReactElement } from 'react';
import type { ArtifactContrastMessage } from '@piwin/artifact';

export type ArtifactStyleOverride = {
  /** The artifact is currently shown under host style instead of its own. */
  active: boolean;
  onToggle: () => void;
};

type Locale = 'zh-CN' | 'en';

export function artifactContrastBadgeCopy(
  issue: Pick<ArtifactContrastMessage, 'lowContrast' | 'themeMismatch'>,
  locale: Locale,
): { label: string; action: string } {
  const zh = locale === 'zh-CN';
  const label = issue.lowContrast
    ? zh
      ? '对比度偏低'
      : 'Low contrast'
    : zh
      ? '与当前主题不一致'
      : 'Off-theme colors';
  return { label, action: zh ? '用主题样式查看' : 'View with theme' };
}

export function artifactHostViewCopy(locale: Locale): { label: string; action: string } {
  return locale === 'zh-CN'
    ? { label: '已用主题样式显示', action: '恢复原样' }
    : { label: 'Shown with theme style', action: 'Restore original' };
}

export function ArtifactContrastBadge(props: {
  issue: ArtifactContrastMessage | null;
  override: ArtifactStyleOverride | undefined;
  locale: Locale;
}): ReactElement | null {
  const { override } = props;
  if (override?.active) {
    const copy = artifactHostViewCopy(props.locale);
    return (
      <p className="artifact-style-badge is-host-view" data-testid="artifact-host-view" role="status">
        <span>{copy.label}</span>
        <button type="button" onClick={override.onToggle} data-testid="artifact-host-view-restore">
          {copy.action}
        </button>
      </p>
    );
  }
  if (!props.issue) return null;
  const copy = artifactContrastBadgeCopy(props.issue, props.locale);
  return (
    <p
      className="artifact-style-badge"
      data-testid="artifact-contrast-badge"
      data-contrast-min-ratio={String(props.issue.minRatio)}
      role="status"
    >
      <span>{copy.label}</span>
      {override ? (
        <button type="button" onClick={override.onToggle} data-testid="artifact-contrast-host-view">
          {copy.action}
        </button>
      ) : null}
    </p>
  );
}
