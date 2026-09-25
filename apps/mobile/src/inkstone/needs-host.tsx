import type { ReactElement } from 'react';
import { useInkstone } from './inkstone-context.js';
import { FullButton } from './inkstone-ui.js';

/**
 * What any Host-backed page or sheet shows without a Host. The shell has no
 * local data to fall back to, so it says so and offers the connection page;
 * it never renders sample content.
 */
export function NeedsHost({ what = '这一页' }: { what?: string }): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <div className="empty-state needs-host">
      <span className="brand-seal">砚</span>
      <h2>{what}需要连上 Host。</h2>
      <p>会话、项目与工具都在你的 Host 上，手机只是另一扇窗。</p>
      <FullButton onClick={() => dispatch({ type: 'navigate', route: 'connect' })}>连接 Host</FullButton>
    </div>
  );
}
