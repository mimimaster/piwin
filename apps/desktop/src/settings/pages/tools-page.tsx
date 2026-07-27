/**
 * Settings → MCP tools page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing McpPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { McpPanel } from '../../McpPanel';
import { useSettings } from '../settings-context';

export function ToolsPage(): ReactElement {
  const { requestMcp } = useSettings();

  return (
    <div className="settings-card settings-card-flush" data-testid="settings-mcp">
      <McpPanel request={requestMcp} variant="inline" />
    </div>
  );
}
