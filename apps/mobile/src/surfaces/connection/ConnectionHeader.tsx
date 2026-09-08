import type { ReactElement } from 'react';

export type ConnectionHeaderProps = {
  isConnected: boolean;
};

export function ConnectionHeader({ isConnected }: ConnectionHeaderProps): ReactElement {
  return (
    <header className="connection-header">
      <div className="brand-seal" aria-hidden="true">
        印
      </div>
      <h1>{isConnected ? 'Host 已连接' : '连接 Piwin Host'}</h1>
      <p>随身掌控会话，工作区与算力常驻 Host。</p>
    </header>
  );
}
