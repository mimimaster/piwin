/**
 * Risk-specific permission presentation (PSR-S4).
 * Host supplies normalized PermissionRequestContext; UI never parses Pi-native payloads.
 */
import type { ReactElement } from 'react';
import type { PermissionRequestContext } from '@piwin/contracts';

export type PermissionRequestCardProps = {
  action: string;
  detail: string;
  defaultDecision: string;
  context?: PermissionRequestContext | null;
  headingId?: string;
};

/**
 * Per-kind fact table (command / file-write / git / network / mcp / unknown).
 * Extracted so the inline permission presentations (PermissionBar, the
 * request dialog) can share one rendering without duplicating the per-kind
 * branching.
 */
export function PermissionFacts(props: {
  action: string;
  detail: string;
  context?: PermissionRequestContext | null | undefined;
}): ReactElement {
  const context = props.context;
  const kind = context?.kind ?? 'unknown';

  return (
    <>
      {kind === 'command' ? (
        <dl className="permission-facts">
          {context?.command ? (
            <>
              <dt>Command</dt>
              <dd>
                <pre className="permission-detail">{context.command}</pre>
              </dd>
            </>
          ) : null}
          {context?.cwd ? (
            <>
              <dt>Working directory</dt>
              <dd>{context.cwd}</dd>
            </>
          ) : null}
          {context?.destructive ? (
            <>
              <dt>Risk</dt>
              <dd className="permission-risk-danger">Destructive command pattern</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {kind === 'file-write' ? (
        <dl className="permission-facts">
          <dt>Paths</dt>
          <dd>
            {context?.paths && context.paths.length > 0 ? (
              <ul>
                {context.paths.map((entry) => (
                  <li key={entry}>
                    <code>{entry}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <pre className="permission-detail">{props.detail}</pre>
            )}
          </dd>
          {context?.secretRelated ? (
            <>
              <dt>Warning</dt>
              <dd className="permission-risk-danger">May touch secrets or credentials</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {kind === 'git' ? (
        <dl className="permission-facts">
          {context?.branch ? (
            <>
              <dt>Branch</dt>
              <dd>{context.branch}</dd>
            </>
          ) : null}
          {context?.remote ? (
            <>
              <dt>Remote</dt>
              <dd>{context.remote}</dd>
            </>
          ) : null}
          {context?.command ? (
            <>
              <dt>Action</dt>
              <dd>
                <pre className="permission-detail">{context.command}</pre>
              </dd>
            </>
          ) : null}
          {context?.destructive ? (
            <>
              <dt>Risk</dt>
              <dd className="permission-risk-danger">Destructive or force Git action</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {kind === 'network' || kind === 'mcp' ? (
        <dl className="permission-facts">
          {context?.host ? (
            <>
              <dt>Host</dt>
              <dd>
                <code>{context.host}</code>
              </dd>
            </>
          ) : null}
          {context?.serverId ? (
            <>
              <dt>MCP server</dt>
              <dd>
                <code>{context.serverId}</code>
              </dd>
            </>
          ) : null}
          {context?.mcpTool ? (
            <>
              <dt>Tool</dt>
              <dd>
                <code>{context.mcpTool.selector}</code>
              </dd>
              <dt>Risk</dt>
              <dd>{context.mcpTool.risk}</dd>
              <dt>Arguments</dt>
              <dd>
                <pre className="permission-detail">{context.mcpTool.argumentsSummary}</pre>
              </dd>
            </>
          ) : null}
          {kind === 'network' ? (
            <>
              <dt>Remember scope</dt>
              <dd>Project remember is available for this network risk.</dd>
            </>
          ) : null}
          {context?.command ? (
            <>
              <dt>Detail</dt>
              <dd>
                <pre className="permission-detail">{context.command}</pre>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {kind === 'unknown' ? (
        <pre className="permission-detail">{props.detail || props.action}</pre>
      ) : null}

      {!context ? <pre className="permission-detail">{props.detail}</pre> : null}
    </>
  );
}

export function PermissionRequestCard(props: PermissionRequestCardProps): ReactElement {
  const context = props.context;
  const kind = context?.kind ?? 'unknown';

  return (
    <div
      className="permission-request-card"
      data-testid="permission-request-card"
      data-kind={kind}
      tabIndex={-1}
      aria-labelledby={props.headingId}
    >
      <h3 id={props.headingId}>Permission required</h3>
      <p className="permission-summary">
        <strong>{context?.summary ?? props.action}</strong>
      </p>
      {context?.reason ? <p className="muted">{context.reason}</p> : null}

      <PermissionFacts action={props.action} detail={props.detail} context={props.context} />

      <p className="muted">Default: {props.defaultDecision}</p>
    </div>
  );
}

export function canRememberPermissionForProject(
  context: PermissionRequestContext | null | undefined,
  action: string,
): boolean {
  // A process cwd grant is session-only; project persistence has no process
  // rule writer and must never show a button that silently acts like Allow once.
  if (action === 'process:start' || action === 'browser:upload' || action === 'browser:screenshot') return false;
  if (!context) {
    return action.startsWith('network:');
  }
  return context.kind === 'network' || context.kind === 'command' || context.kind === 'file-write';
}
