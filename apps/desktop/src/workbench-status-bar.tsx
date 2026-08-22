/**
 * Workbench status bar wiring (extracted from App.tsx).
 */
import type { ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import type { ShellSettingsSection } from './shell-navigation';
import { StatusBar } from './status-bar';

export type WorkbenchStatusBarProps = {
  modelLabel: string;
  streaming: boolean;
  error: string | null | undefined;
  terminalAttention: boolean;
  isConversationSession: boolean;
  skillsCount: number;
  mcpCount: number;
  contextUsagePercent: number | undefined;
  contextUsage: ContextUsageSnapshot | null | undefined;
  modelContextWindow: number | undefined;
  openSettingsSection: (section: ShellSettingsSection) => void;
  locale: DesktopLocale;
};

export function WorkbenchStatusBar(props: WorkbenchStatusBarProps): ReactElement {
  return (
    <StatusBar
      modelLabel={props.modelLabel}
      agentState={props.streaming ? 'running' : props.error ? 'error' : 'idle'}
      terminalAttention={props.terminalAttention}
      isConversationSession={props.isConversationSession}
      {...(props.isConversationSession
        ? {}
        : {
            skillsCount: props.skillsCount,
            mcpCount: props.mcpCount,
          })}
      {...(typeof props.contextUsagePercent === 'number'
        ? { contextPercent: props.contextUsagePercent }
        : {})}
      {...(props.contextUsage ? { contextUsage: props.contextUsage } : {})}
      {...(typeof props.modelContextWindow === 'number'
        ? { modelContextWindow: props.modelContextWindow }
        : {})}
      onOpenSkills={() => props.openSettingsSection('skills')}
      onOpenMcp={() => props.openSettingsSection('tools')}
      locale={props.locale}
    />
  );
}
