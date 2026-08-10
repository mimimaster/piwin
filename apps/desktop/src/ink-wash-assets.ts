import type { ThemeManifest } from '@piwin/contracts';

export type InkWashAssetKind =
  | 'hero'
  | 'conversationTexture'
  | 'sidebarBg'
  | 'rightPanelBg'
  | 'agentSeal'
  | 'dryBrushDivider'
  | 'emptySession'
  | 'emptyFiles'
  | 'emptyFailure'
  | 'emptyComplete';

const ASSET_PATHS: Record<InkWashAssetKind, string> = {
  hero: '/ui/ink-wash/hero.jpg',
  conversationTexture: '/ui/ink-wash/conversation-texture.jpg',
  sidebarBg: '/ui/ink-wash/sidebar-bg.jpg',
  rightPanelBg: '/ui/ink-wash/right-panel-bg.jpg',
  agentSeal: '/ui/ink-wash/agent-seal.jpg',
  dryBrushDivider: '/ui/ink-wash/dry-brush-divider.jpg',
  emptySession: '/ui/ink-wash/empty-session.jpg',
  emptyFiles: '/ui/ink-wash/empty-files.jpg',
  emptyFailure: '/ui/ink-wash/empty-failure.jpg',
  emptyComplete: '/ui/ink-wash/empty-complete.jpg',
};

/**
 * Product-owned asset lookup. Theme manifests select a visual style, never an
 * arbitrary URL, so removing the asset directory falls back to token-only UI.
 */
export function getThemeAsset(
  theme: ThemeManifest | null | undefined,
  kind: InkWashAssetKind,
): string | undefined {
  if (theme?.id !== 'piwin-ink-wash' || theme.visualStyle !== 'ink-wash') {
    return undefined;
  }
  return ASSET_PATHS[kind];
}
