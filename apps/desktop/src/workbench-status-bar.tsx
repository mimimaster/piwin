/**
 * Workbench status bar wiring (extracted from App.tsx).
 */
import type { ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import { StatusBar } from './status-bar';

export type WorkbenchStatusBarProps = {
  streaming: boolean;
  runStartedAt: number | null;
  error: string | null | undefined;
  terminalAttention: boolean;
  contextUsage: ContextUsageSnapshot | null | undefined;
  locale: DesktopLocale;
};

export function WorkbenchStatusBar(props: WorkbenchStatusBarProps): ReactElement {
  return (
    <StatusBar
      agentState={props.streaming ? 'running' : props.error ? 'error' : 'idle'}
      {...(typeof props.runStartedAt === 'number' ? { runStartedAt: props.runStartedAt } : {})}
      terminalAttention={props.terminalAttention}
      {...(props.contextUsage ? { contextUsage: props.contextUsage } : {})}
      locale={props.locale}
    />
  );
}
