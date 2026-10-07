import type { ReactElement } from 'react';
import { shellInterfaceEntryPath, switchShellInterface } from '@piwin/host-client';
import { ListRow } from './inkstone-ui.js';

/**
 * The default interface only exists in the assembled shell bundle, where this
 * app is served from the classic entry path. A plain `vite dev` of this
 * package has nothing to switch to.
 */
const CAN_SWITCH_INTERFACE =
  import.meta.env.BASE_URL !== '/' &&
  shellInterfaceEntryPath('classic').startsWith(import.meta.env.BASE_URL);

/** Returns the shell to its default interface (see shell-interface-mode). */
export function ShellInterfaceRow(): ReactElement | null {
  if (!CAN_SWITCH_INTERFACE) {
    return null;
  }
  return (
    <ListRow
      name="globe"
      title="界面模式"
      subtitle="当前为经典界面 · 轻点切换到默认界面"
      onClick={() => switchShellInterface('web', window)}
    />
  );
}
