import { useState, type ReactElement } from 'react';
import type { RemotePermissionRequest } from '../../mobile-transcript.js';
import { ScopeOptionsSelector } from './ScopeOptionsSelector.js';
import { describePermission } from './permission-view.js';

export type PermissionScope = 'once' | 'session' | 'project';

/**
 * Permission seal on the ink line. The Host owns the decision; the phone only
 * relays 允/否 plus the remember scope through `permission/resolve`.
 */
export function PermissionGateCard({
  request,
  resolving,
  onResolve,
  onOpenDetail,
}: {
  request: RemotePermissionRequest;
  resolving: boolean;
  onResolve: (decision: 'allow' | 'deny', scope: PermissionScope) => void;
  onOpenDetail: () => void;
}): ReactElement {
  const [scope, setScope] = useState<PermissionScope>('once');
  const gate = describePermission(request);
  return (
    <div className="tr-gate">
      <span className="node wait" aria-hidden="true" />
      <article className="gate" aria-live="polite">
        <div className="mic">
          需要你批准 · {gate.kindLabel}
          {gate.destructive ? ' · 破坏性' : ''}
        </div>
        <div className="cmd">
          <b>{gate.tool}</b> {gate.target !== undefined ? <code>{gate.target}</code> : null}
        </div>
        {gate.detail !== undefined ? <p>{gate.detail}</p> : null}
        {gate.facts.length > 0 ? (
          <div className="facts">
            {gate.facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </div>
        ) : null}
        <ScopeOptionsSelector scope={scope} onSelect={setScope} />
        <div className="gate-row">
          <button className="text-link" type="button" onClick={onOpenDetail}>
            展开详情
          </button>
          <button
            className="seal-button ghost"
            type="button"
            disabled={resolving}
            aria-label="拒绝"
            onClick={() => onResolve('deny', scope)}
          >
            否
          </button>
          <button
            className="seal-button"
            type="button"
            disabled={resolving}
            aria-label="允许"
            onClick={() => onResolve('allow', scope)}
          >
            允
          </button>
        </div>
      </article>
    </div>
  );
}
