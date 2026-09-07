/**
 * Shared MCP tool catalog row — settings expand + editor pin list.
 */
import { useState, type ReactElement } from 'react';
import { Button, IconButton } from '@piwin/ui-kit';
import { IconPin, IconChevronDown, IconChevronRight } from './shell-icons.js';
import {
  listMcpSchemaProperties,
  type McpToolCatalogEntry,
} from './mcp-visibility-model.js';

export type McpToolCatalogRowProps = {
  entry: McpToolCatalogEntry;
  isChinese: boolean;
  /** When set, shows pin control for direct-call exposure. */
  onTogglePinned?: (selector: string, pinned: boolean) => void;
  pinning?: boolean;
  defaultExpanded?: boolean;
};

export function McpToolCatalogRow(props: McpToolCatalogRowProps): ReactElement {
  const { entry, isChinese } = props;
  const [expanded, setExpanded] = useState(props.defaultExpanded === true);
  const schemaRows = listMcpSchemaProperties(entry.inputSchema);
  const hasSchema =
    entry.inputSchema !== undefined && Object.keys(entry.inputSchema).length > 0;
  const exposureLabel =
    entry.exposure === 'direct'
      ? isChinese
        ? '直调'
        : 'direct'
      : entry.exposure === 'dormant-pin'
        ? isChinese
          ? '休眠固定'
          : 'dormant pin'
        : 'gateway';
  const sourceLabel =
    entry.source === 'cached'
      ? isChinese
        ? '缓存'
        : 'cached'
      : entry.source === 'pinned-dormant'
        ? isChinese
          ? '仅固定'
          : 'pin only'
        : null;

  return (
    <li
      className={`mcp-tool-catalog-row${expanded ? ' is-expanded' : ''}`}
      data-testid={`mcp-tool-catalog-${entry.selector}`}
      data-exposure={entry.exposure}
    >
      <div className="mcp-tool-catalog-row-head">
        {props.onTogglePinned ? (
          <IconButton
            className={
              entry.exposure === 'direct'
                ? 'mcp-tool-pin-btn mcp-tool-pin-btn--active'
                : 'mcp-tool-pin-btn'
            }
            label={
              entry.exposure === 'direct'
                ? isChinese
                  ? '取消固定直接调用'
                  : 'Unpin direct call'
                : isChinese
                  ? '固定为直接调用工具'
                  : 'Pin as direct tool'
            }
            title={
              entry.exposure === 'direct'
                ? isChinese
                  ? '取消固定直接调用'
                  : 'Unpin direct call'
                : isChinese
                  ? '固定为直接调用工具'
                  : 'Pin as direct tool'
            }
            aria-pressed={entry.exposure === 'direct'}
            disabled={props.pinning === true}
            data-testid={`mcp-pin-${entry.selector}`}
            onClick={() => {
              props.onTogglePinned?.(entry.selector, entry.exposure !== 'direct');
            }}
          >
            <IconPin
              className={
                entry.exposure === 'direct'
                  ? 'mcp-tool-pin-icon mcp-tool-pin-icon--filled'
                  : 'mcp-tool-pin-icon'
              }
              width={16}
              height={16}
            />
          </IconButton>
        ) : null}
        <button
          type="button"
          className="mcp-tool-catalog-toggle"
          aria-expanded={expanded}
          data-testid={`mcp-tool-catalog-toggle-${entry.selector}`}
          onClick={() => setExpanded((current) => !current)}
        >
          <div className="mcp-tool-catalog-title">
            <strong>{entry.name}</strong>
            <span
              className={
                entry.exposure === 'direct'
                  ? 'mcp-tool-pin-pill'
                  : entry.exposure === 'dormant-pin'
                    ? 'mcp-tool-dormant-pill'
                    : 'mcp-tool-gateway-pill'
              }
            >
              {exposureLabel}
            </span>
            {sourceLabel ? <span className="mcp-meta-badge">{sourceLabel}</span> : null}
          </div>
          <span className="muted mcp-tool-catalog-desc">{entry.description}</span>
          <code className="mcp-tool-selector muted">{entry.selector}</code>
        </button>
        <span className="mcp-tool-catalog-chevron" aria-hidden>
          {expanded ? <IconChevronDown /> : <IconChevronRight />}
        </span>
      </div>
      {expanded ? (
        <div className="mcp-tool-catalog-body" data-testid={`mcp-tool-catalog-body-${entry.selector}`}>
          <p className="mcp-tool-catalog-full-desc">{entry.description}</p>
          <p className="muted mcp-tool-catalog-exposed">
            {isChinese ? 'Agent 名称：' : 'Agent name: '}
            <code>{entry.exposedName}</code>
          </p>
          {hasSchema ? (
            schemaRows.length > 0 ? (
              <table className="mcp-tool-schema-table">
                <thead>
                  <tr>
                    <th>{isChinese ? '参数' : 'Param'}</th>
                    <th>{isChinese ? '类型' : 'Type'}</th>
                    <th>{isChinese ? '说明' : 'Description'}</th>
                  </tr>
                </thead>
                <tbody>
                  {schemaRows.map((row) => (
                    <tr key={row.name}>
                      <td>
                        <code>{row.name}</code>
                        {row.required ? (
                          <span className="mcp-tool-required">
                            {isChinese ? '必填' : 'required'}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <code>{row.typeLabel}</code>
                      </td>
                      <td>{row.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre className="mcp-tool-schema-raw">
                {JSON.stringify(entry.inputSchema, null, 2)}
              </pre>
            )
          ) : (
            <p className="muted mcp-tool-catalog-empty-schema">
              {isChinese ? '该工具未提供参数 schema。' : 'No parameter schema for this tool.'}
            </p>
          )}
          {hasSchema && schemaRows.length > 0 ? (
            <details className="mcp-tool-schema-details">
              <summary>{isChinese ? '原始 JSON Schema' : 'Raw JSON Schema'}</summary>
              <pre className="mcp-tool-schema-raw">
                {JSON.stringify(entry.inputSchema, null, 2)}
              </pre>
            </details>
          ) : null}
          {props.onTogglePinned ? null : (
            <Button
              size="compact"
              variant="ghost"
              className="mcp-tool-catalog-collapse"
              onClick={() => setExpanded(false)}
            >
              {isChinese ? '收起' : 'Collapse'}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}
