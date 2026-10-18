/**
 * 自定义请求 section of the model editors (ADR 0095): per-model request
 * headers (rows or JSON) and a custom JSON body merged into every request,
 * with templates, live validation and an OpenRouter routing helper.
 * Shared by Add Model and the inline model editor.
 */
import { useState, type ReactElement } from 'react';
import {
  Button,
  Collapse,
  DropdownMenu,
  DropdownMenuItem,
  SegmentedControl,
  TextArea,
} from '@piwin/ui-kit';
import {
  RESERVED_REQUEST_BODY_KEYS,
  type ModelProviderConfig,
  type RequestBodyIssue,
} from '@piwin/contracts';
import { HeaderRowsEditor } from './header-rows-editor.js';
import type { ModelConfigurationDraft } from './model-configuration.js';
import {
  REQUEST_BODY_TEMPLATES,
  applyRequestBodyTemplate,
  formatHeadersJsonText,
  formatRequestBodyText,
  hasOpenRouterRouting,
  isOpenRouterBaseUrl,
  parseHeadersJsonText,
  parseRequestBodyText,
  readOpenRouterRouting,
  requestBodyTopLevelKeys,
  requestBodyWireHint,
  writeOpenRouterRouting,
  type HeadersTextError,
  type RequestBodyTemplateId,
  type RequestBodyTextError,
} from './model-request-overrides.js';
import { OpenRouterRoutingFields } from './openrouter-routing-fields.js';
import { headersToRows, rowsToHeaders } from './provider-draft.js';
import { IconChevronRight } from './shell-icons.js';

export type ModelRequestOverridesValue = Pick<
  ModelConfigurationDraft,
  'headerRows' | 'headersJsonText' | 'extraBodyText'
>;

export type ModelRequestOverridesFieldsProps<T extends ModelRequestOverridesValue> = {
  value: T;
  /** The model's effective protocol (its override, else the provider's). */
  protocol: ModelProviderConfig['protocol'];
  baseUrl?: string;
  disabled?: boolean;
  isChinese: boolean;
  testIdPrefix: string;
  onChange: (update: (current: T) => T) => void;
};

export function ModelRequestOverridesFields<T extends ModelRequestOverridesValue>({
  value,
  protocol,
  baseUrl,
  disabled = false,
  isChinese,
  testIdPrefix,
  onChange,
}: ModelRequestOverridesFieldsProps<T>): ReactElement {
  const t = isChinese ? ZH : EN;
  const prefix = `${testIdPrefix}-request`;
  const headersJsonMode = value.headersJsonText !== undefined;
  const headersParsed = headersJsonMode ? parseHeadersJsonText(value.headersJsonText ?? '') : undefined;
  const headers = headersParsed
    ? headersParsed.ok
      ? headersParsed.headers
      : undefined
    : rowsToHeaders(value.headerRows ?? []);
  const bodyText = value.extraBodyText ?? '';
  const bodyParsed = parseRequestBodyText(bodyText);
  const body = bodyParsed.ok ? bodyParsed.body : undefined;
  const openRouter = isOpenRouterBaseUrl(baseUrl) || hasOpenRouterRouting(body);
  const headerCount = headers ? Object.keys(headers).length : 0;
  const bodyKeys = requestBodyTopLevelKeys(body);
  const hasError = (headersParsed !== undefined && !headersParsed.ok) || !bodyParsed.ok;
  const [open, setOpen] = useState(false);
  const [modeError, setModeError] = useState(false);

  function setHeadersMode(mode: string): void {
    if (mode === 'json' && !headersJsonMode) {
      setModeError(false);
      onChange((current) => ({
        ...current,
        headersJsonText: formatHeadersJsonText(rowsToHeaders(current.headerRows ?? [])),
      }));
      return;
    }
    if (mode === 'rows' && headersJsonMode) {
      const parsed = parseHeadersJsonText(value.headersJsonText ?? '');
      if (!parsed.ok) {
        setModeError(true);
        return;
      }
      setModeError(false);
      onChange((current) => {
        const next = { ...current, headerRows: headersToRows(parsed.headers) };
        delete next.headersJsonText;
        return next;
      });
    }
  }

  function setBodyText(text: string): void {
    onChange((current) => ({ ...current, extraBodyText: text }));
  }

  function insertTemplate(id: RequestBodyTemplateId): void {
    const template = REQUEST_BODY_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    const next = applyRequestBodyTemplate(bodyText, template.body);
    if (next.ok) setBodyText(next.text);
  }

  const summary = [
    headerCount > 0 ? t.summaryHeaders(headerCount) : null,
    bodyKeys.length > 0 ? t.summaryBody(bodyKeys) : null,
  ].filter((part): part is string => part !== null);

  return (
    <section className="model-request-overrides" data-testid={prefix}>
      <button
        type="button"
        className="model-request-overrides-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid={`${prefix}-toggle`}
      >
        <IconChevronRight
          width={12}
          height={12}
          className={open ? 'model-request-overrides-caret is-open' : 'model-request-overrides-caret'}
        />
        <span className="model-request-overrides-title">{t.title}</span>
        <span
          className={hasError ? 'model-request-overrides-summary is-error' : 'model-request-overrides-summary'}
          data-testid={`${prefix}-summary`}
        >
          {hasError ? t.summaryError : summary.length > 0 ? summary.join(' · ') : t.summaryNone}
        </span>
      </button>
      <Collapse expanded={open} testId={`${prefix}-collapse`}>
        <div className="model-request-overrides-body">
          <div className="model-request-overrides-block">
            <div className="model-request-overrides-head">
              <span className="model-request-overrides-label">{t.headers}</span>
              <SegmentedControl
                size="xs"
                value={headersJsonMode ? 'json' : 'rows'}
                onChange={setHeadersMode}
                disabled={disabled}
                data={[
                  { value: 'rows', label: t.modeRows },
                  { value: 'json', label: 'JSON' },
                ]}
                testId={`${prefix}-headers-mode`}
              />
            </div>
            {headersJsonMode ? (
              <TextArea
                value={value.headersJsonText ?? ''}
                onChange={(text) => {
                  setModeError(false);
                  onChange((current) => ({ ...current, headersJsonText: text }));
                }}
                placeholder={'{\n  "HTTP-Referer": "https://example.com",\n  "X-Title": "piwin"\n}'}
                rows={4}
                disabled={disabled}
                error={
                  headersParsed && !headersParsed.ok
                    ? `${describeHeadersError(headersParsed.error, isChinese)}${modeError ? t.fixBeforeRows : ''}`
                    : null
                }
                className="model-request-json"
                nativeProps={{ spellCheck: false, autoComplete: 'off' }}
                testId={`${prefix}-headers-json`}
              />
            ) : (
              <div className="model-request-overrides-rows">
                <HeaderRowsEditor
                  rows={value.headerRows ?? []}
                  disabled={disabled}
                  copy={{
                    headerName: t.headerName,
                    headerValue: t.headerValue,
                    addHeader: t.addHeader,
                    deleteLabel: t.deleteHeader,
                  }}
                  testIdPrefix={testIdPrefix}
                  onChange={(headerRows) => onChange((current) => ({ ...current, headerRows }))}
                />
              </div>
            )}
            <p className="model-request-overrides-hint">{t.headersHint}</p>
          </div>

          <div className="model-request-overrides-block">
            <div className="model-request-overrides-head">
              <span className="model-request-overrides-label">{t.body}</span>
              <div className="model-request-overrides-actions">
                <DropdownMenu
                  modal={false}
                  align="end"
                  label={t.insertTemplate}
                  testId={`${prefix}-templates`}
                  contentClassName="model-request-templates-menu"
                  trigger={
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      disabled={disabled || !bodyParsed.ok}
                      data-testid={`${prefix}-templates-trigger`}
                    >
                      {t.insertTemplate}
                    </Button>
                  }
                >
                  {REQUEST_BODY_TEMPLATES.map((template) => (
                    <DropdownMenuItem
                      key={template.id}
                      onSelect={() => insertTemplate(template.id)}
                      testId={`${prefix}-template-${template.id}`}
                    >
                      {t.templates[template.id]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  disabled={disabled || !bodyParsed.ok || !bodyText.trim()}
                  onClick={() => setBodyText(formatRequestBodyText(body))}
                  data-testid={`${prefix}-body-format`}
                >
                  {t.format}
                </Button>
              </div>
            </div>
            {openRouter ? (
              <OpenRouterRoutingFields
                routing={readOpenRouterRouting(body)}
                blocked={!bodyParsed.ok}
                disabled={disabled}
                isChinese={isChinese}
                testIdPrefix={testIdPrefix}
                onChange={(routing) =>
                  setBodyText(formatRequestBodyText(writeOpenRouterRouting(body, routing)))
                }
              />
            ) : null}
            <TextArea
              value={bodyText}
              onChange={setBodyText}
              placeholder={t.bodyPlaceholder[requestBodyWireHint(protocol)]}
              rows={bodyText.split('\n').length > 5 ? 8 : 5}
              disabled={disabled}
              error={bodyParsed.ok ? null : describeBodyError(bodyParsed.error, isChinese)}
              className="model-request-json"
              nativeProps={{ spellCheck: false, autoComplete: 'off' }}
              testId={`${prefix}-body`}
            />
            {bodyParsed.ok && bodyKeys.length > 0 ? (
              <p className="model-request-overrides-status" data-testid={`${prefix}-body-status`}>
                {t.willMerge(bodyKeys)}
              </p>
            ) : null}
            <p className="model-request-overrides-hint">
              {t.bodyHint}
              {t.wireHint[requestBodyWireHint(protocol)]}
            </p>
          </div>
        </div>
      </Collapse>
    </section>
  );
}

function describeBodyError(error: RequestBodyTextError, isChinese: boolean): string {
  if (error.kind === 'syntax') {
    return isChinese ? `JSON 格式错误：${error.message}` : `Invalid JSON: ${error.message}`;
  }
  return describeBodyIssue(error.issue, isChinese);
}

function describeBodyIssue(issue: RequestBodyIssue, isChinese: boolean): string {
  switch (issue.code) {
    case 'not-object':
      return isChinese ? '请求体必须是 JSON 对象，例如 {"temperature": 0.7}' : 'The body must be a JSON object, e.g. {"temperature": 0.7}';
    case 'reserved-key':
      return isChinese
        ? `“${issue.key}”由 piwin 生成，不能在这里覆盖（受保护字段：${RESERVED_REQUEST_BODY_KEYS.join('、')}）`
        : `"${issue.key}" is generated by piwin and cannot be overridden (protected: ${RESERVED_REQUEST_BODY_KEYS.join(', ')})`;
    case 'not-json':
      return isChinese ? `“${issue.path}”不是合法的 JSON 值` : `"${issue.path}" is not a JSON value`;
    case 'too-large':
      return isChinese
        ? `请求体超过 ${Math.round(issue.limitBytes / 1024)} KB 上限`
        : `The body exceeds ${Math.round(issue.limitBytes / 1024)} KB`;
    case 'too-deep':
      return isChinese
        ? `嵌套超过 ${issue.limitDepth} 层`
        : `Nesting exceeds ${issue.limitDepth} levels`;
  }
}

function describeHeadersError(error: HeadersTextError, isChinese: boolean): string {
  switch (error.kind) {
    case 'syntax':
      return isChinese ? `JSON 格式错误：${error.message}` : `Invalid JSON: ${error.message}`;
    case 'not-object':
      return isChinese ? '请求头必须是 {"名称": "值"} 形式的对象' : 'Headers must be an object of {"name": "value"}';
    case 'not-string':
      return isChinese ? `“${error.name}”的值必须是字符串` : `The value of "${error.name}" must be a string`;
    case 'invalid-name':
      return isChinese ? `请求头名称“${error.name}”不合法` : `Header name "${error.name}" is invalid`;
    case 'duplicate':
      return isChinese ? `请求头“${error.name}”重复（不区分大小写）` : `Header "${error.name}" is set twice (case-insensitive)`;
  }
}

const ZH = {
  title: '自定义请求',
  summaryNone: '未设置',
  summaryError: 'JSON 有误，展开修正',
  summaryHeaders: (count: number) => `${count} 个请求头`,
  summaryBody: (keys: readonly string[]) => `请求体：${keys.join('、')}`,
  headers: '请求头',
  modeRows: '表格',
  headerName: '名称',
  headerValue: '值',
  addHeader: '添加请求头',
  deleteHeader: '删除',
  fixBeforeRows: '（修正后才能切回表格）',
  headersHint: '与服务商请求头合并，同名（不区分大小写）以这里为准。',
  body: '请求体（JSON）',
  insertTemplate: '插入模板',
  format: '格式化',
  templates: {
    'openrouter-upstream': 'OpenRouter：指定上游',
    sampling: '采样参数（temperature / top_p）',
    'remove-field': '删除默认字段（值为 null）',
  } satisfies Record<RequestBodyTemplateId, string>,
  bodyPlaceholder: {
    openai: '{\n  "provider": { "order": ["anthropic"], "allow_fallbacks": false },\n  "temperature": 0.7\n}',
    anthropic: '{\n  "top_k": 40,\n  "metadata": { "user_id": "me" }\n}',
    gemini: '{\n  "config": { "temperature": 0.2, "topK": 40 }\n}',
    bedrock: '{\n  "additionalModelRequestFields": { "top_k": 40 }\n}',
  },
  willMerge: (keys: readonly string[]) => `✓ 每次请求都会合并：${keys.join('、')}`,
  bodyHint:
    '按对象逐层合并到 piwin 生成的请求体：数组和普通值整体替换，值为 null 表示删除该字段；model、messages、tools、stream 等核心字段受保护。',
  wireHint: {
    openai: '当前为 OpenAI 格式，字段直接写在顶层。',
    anthropic: '当前为 Anthropic Messages 格式，字段直接写在顶层。',
    gemini: '当前为 Gemini 格式，生成参数写在 config 下。',
    bedrock: '当前为 Bedrock Converse 格式，模型专属字段写在 additionalModelRequestFields 下。',
  },
};

const EN: typeof ZH = {
  title: 'Custom request',
  summaryNone: 'Not set',
  summaryError: 'Invalid JSON — expand to fix',
  summaryHeaders: (count: number) => `${count} header${count === 1 ? '' : 's'}`,
  summaryBody: (keys: readonly string[]) => `body: ${keys.join(', ')}`,
  headers: 'Headers',
  modeRows: 'Rows',
  headerName: 'Name',
  headerValue: 'Value',
  addHeader: 'Add header',
  deleteHeader: 'Delete',
  fixBeforeRows: ' (fix it to switch back to rows)',
  headersHint: 'Layered over the provider headers; a same-named header (case-insensitive) wins.',
  body: 'Body (JSON)',
  insertTemplate: 'Insert template',
  format: 'Format',
  templates: {
    'openrouter-upstream': 'OpenRouter: pin upstream',
    sampling: 'Sampling (temperature / top_p)',
    'remove-field': 'Remove a default field (null)',
  },
  bodyPlaceholder: ZH.bodyPlaceholder,
  willMerge: (keys: readonly string[]) => `✓ Merged into every request: ${keys.join(', ')}`,
  bodyHint:
    'Deep-merged into the body piwin builds: arrays and scalars replace, null deletes a field; core fields such as model, messages, tools and stream are protected. ',
  wireHint: {
    openai: 'This model speaks OpenAI; put fields at the top level.',
    anthropic: 'This model speaks Anthropic Messages; put fields at the top level.',
    gemini: 'This model speaks Gemini; generation settings go under config.',
    bedrock: 'This model speaks Bedrock Converse; model-specific fields go under additionalModelRequestFields.',
  },
};
