/**
 * Custom CLI / HTTP search source fields inside Settings → Web.
 * Command mode matches MCP: command, args, env. HTTP matches Open WebUI External Search.
 */
import { useState, type ReactElement } from 'react';
import type { WebSearchSource } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { Button, Field, SegmentedControl, TextArea, TextInput } from '@piwin/ui-kit';
import {
  CLI_SEARCH_EXAMPLES,
  formatCliSearchExample,
} from './cli-search-examples.js';
import {
  CLI_QUERY_TOKEN,
  applyPickedExecutable,
  commandLineHasQueryToken,
  formatArgsLine,
  formatCommandLine,
  insertToken,
  linesToArgs,
  looksLikeDirectScript,
  looksLikeVersionPinnedNode,
  parseArgsLine,
  parseEnvLines,
} from './cli-command-line.js';
import type { DraftSearchSource } from './web-draft.js';

export type WebCliSourceFieldsProps = {
  source: DraftSearchSource;
  zh: boolean;
  disabled: boolean;
  onChange: (patch: Partial<DraftSearchSource>) => void;
  onPickScript: () => Promise<string | null>;
  onTest: (source: WebSearchSource) => Promise<{ durationMs: number; resultCount: number }>;
};

type TestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; durationMs: number; resultCount: number }
  | { status: 'err'; message: string };

export function draftToTestSource(draft: DraftSearchSource): WebSearchSource {
  const source: WebSearchSource = {
    id: draft.id,
    kind: draft.kind,
    enabled: true,
  };
  if (draft.command.trim()) source.command = draft.command.trim();
  const args = linesToArgs(draft.args);
  if (args.length > 0) source.args = args;
  if (draft.baseUrl.trim()) source.baseUrl = draft.baseUrl.trim();
  if (draft.apiKeyEnv.trim()) source.apiKeyEnv = draft.apiKeyEnv.trim();
  if (draft.apiKeyRef.trim()) source.apiKeyRef = draft.apiKeyRef.trim();
  const env = parseEnvLines(draft.envText);
  if (env) source.env = env;
  return source;
}

export function WebCliSourceFields(props: WebCliSourceFieldsProps): ReactElement {
  const { source, zh, disabled, onChange } = props;
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [argsFocused, setArgsFocused] = useState(false);
  const [draftArgs, setDraftArgs] = useState('');
  const httpMode = source.kind === 'http';
  const args = linesToArgs(source.args);
  const formattedArgs = formatArgsLine(args);
  const argsLine = argsFocused ? draftArgs : formattedArgs;
  const preview = formatCommandLine(source.command, args);

  function setArgsLine(next: string): void {
    if (argsFocused) {
      setDraftArgs(next);
    }
    onChange({ args: parseArgsLine(next).join('\n') });
    setAppliedNote(null);
    setTest({ status: 'idle' });
  }

  async function runTest(): Promise<void> {
    setTest({ status: 'loading' });
    try {
      const result = await props.onTest(draftToTestSource(source));
      setTest({ status: 'ok', durationMs: result.durationMs, resultCount: result.resultCount });
    } catch (error) {
      setTest({ status: 'err', message: formatError(error) });
    }
  }

  return (
    <>
      <p className="muted web-cli-intro">
        {zh
          ? '和添加 MCP 一样：command、args、env。搜索词写成 {{query}}。也可以改走 HTTP（Open WebUI External Search 那套）。'
          : 'Same as adding an MCP server: command, args, env. Put {{query}} where the search text goes. Or use HTTP (Open WebUI External Search).'}
      </p>
      <SegmentedControl
        value={httpMode ? 'http' : 'cmd'}
        onChange={(value) => {
          onChange({ kind: value === 'http' ? 'http' : 'cli' });
          setTest({ status: 'idle' });
          setAppliedNote(null);
        }}
        data={[
          { value: 'cmd', label: zh ? '命令' : 'Command' },
          { value: 'http', label: 'HTTP' },
        ]}
        testId="web-search-cli-mode"
        disabled={disabled}
      />

      {httpMode ? (
        <>
          <Field
            label={zh ? '接口 URL' : 'Endpoint URL'}
            description={
              zh
                ? 'POST {"query","count"}，返回 [{title,url|link,snippet}] 或 {hits:[…]}。'
                : 'POST {"query","count"}. Response is [{title,url|link,snippet}] or {hits:[…]}.'
            }
            className="web-source-field"
          >
            <TextInput
              value={source.baseUrl}
              onChange={(event) => onChange({ baseUrl: event.currentTarget.value })}
              placeholder="http://127.0.0.1:8787/search"
              spellCheck={false}
              disabled={disabled}
              testId="web-search-http-url"
            />
          </Field>
          <Field
            label={zh ? '环境变量（Bearer，可选）' : 'Env (Bearer, optional)'}
            description={
              zh ? '和 MCP 一样，密钥放在环境变量名里。' : 'Same as MCP: store the secret in an env var name.'
            }
            className="web-source-field"
          >
            <TextInput
              value={source.apiKeyEnv}
              onChange={(event) => onChange({ apiKeyEnv: event.currentTarget.value })}
              placeholder="SEARCH_API_KEY"
              spellCheck={false}
              disabled={disabled}
              testId="web-search-http-api-key-env"
            />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={zh ? '命令' : 'Command'}
            description={
              zh
                ? '要执行的文件，和 MCP 的 command 相同。有 shebang 的脚本直接填路径。'
                : 'The executable, same as MCP command. Scripts with a shebang can be the path itself.'
            }
            className="web-source-field"
          >
            <div className="web-cli-command-row">
              <TextInput
                value={source.command}
                onChange={(event) => {
                  onChange({ command: event.currentTarget.value });
                  setAppliedNote(null);
                  setTest({ status: 'idle' });
                }}
                placeholder="/path/to/search.mjs"
                spellCheck={false}
                disabled={disabled}
                testId="web-search-cli-command"
              />
              <Button
                variant="secondary"
                disabled={disabled}
                data-testid="web-search-cli-pick"
                onClick={() => {
                  void props.onPickScript().then((path) => {
                    if (!path) return;
                    const next = applyPickedExecutable(path, source.args);
                    onChange(next);
                    setAppliedNote(
                      zh ? '已选脚本，并自动补上 {{query}}' : 'Script selected; {{query}} was filled in if missing.',
                    );
                    setTest({ status: 'idle' });
                  });
                }}
              >
                {zh ? '选择脚本' : 'Choose script'}
              </Button>
            </div>
          </Field>
          {looksLikeDirectScript(source.command) ? (
            <div className="web-cli-notice is-ok">
              {zh
                ? '将直接执行这个脚本（走 shebang），不必再填 Node 路径。'
                : 'This script will run directly via its shebang. No Node path needed.'}
            </div>
          ) : null}
          {looksLikeVersionPinnedNode(source.command) ? (
            <div className="web-cli-notice is-warn">
              {zh
                ? 'command 绑死了某个 Node 版本。Host 通常没有 fnm：给脚本加 shebang，或点「选择脚本」。'
                : 'Command pins a Node version. Host usually lacks fnm — add a shebang, or choose the script.'}
            </div>
          ) : null}

          <Field
            label={zh ? '参数' : 'Args'}
            description={
              zh
                ? '空格分隔，和 MCP 的 args 相同。必须包含 {{query}}。'
                : 'Space-separated, same as MCP args. Must include {{query}}.'
            }
            className="web-source-field"
          >
            <TextInput
              value={argsLine}
              onChange={(event) => setArgsLine(event.currentTarget.value)}
              onFocus={() => {
                setDraftArgs(formattedArgs);
                setArgsFocused(true);
              }}
              onBlur={() => setArgsFocused(false)}
              placeholder={`${CLI_QUERY_TOKEN} --limit 5`}
              spellCheck={false}
              disabled={disabled}
              testId="web-search-cli-args"
            />
          </Field>
          <div className="web-cli-chip-row">
            <span className="web-cli-chip-label">{zh ? '插入' : 'Insert'}</span>
            <button
              type="button"
              className="web-cli-chip"
              disabled={disabled}
              data-testid="web-search-cli-insert-query"
              onClick={() => {
                setArgsLine(insertToken(argsLine, `"${CLI_QUERY_TOKEN}"`, argsLine.length));
              }}
            >
              {CLI_QUERY_TOKEN}
            </button>
          </div>
          {!commandLineHasQueryToken(source.command, args) ? (
            <div className="web-cli-notice is-warn">
              {zh ? 'args 里还没有 {{query}}，Host 不知道查询词往哪插。' : 'Add {{query}} to args so Host can insert the search text.'}
            </div>
          ) : null}

          <Field
            label={zh ? '环境变量' : 'Env'}
            description={zh ? '每行 KEY=VALUE，和 MCP 相同。' : 'One KEY=VALUE per line, same as MCP.'}
            className="web-source-field"
          >
            <TextArea
              value={source.envText}
              onChange={(value) => onChange({ envText: value })}
              placeholder="SEARCH_API_KEY="
              rows={3}
              testId="web-search-cli-env"
              disabled={disabled}
              nativeProps={{ spellCheck: false }}
            />
          </Field>

          <div className="web-cli-preview" data-testid="web-search-cli-preview">
            <div className="web-cli-preview-label">{zh ? '将执行' : 'Will run'}</div>
            <code className="web-cli-preview-code">{preview || '—'}</code>
          </div>
        </>
      )}

      <div className="web-cli-actions">
        <Button
          variant="secondary"
          disabled={disabled}
          data-testid="web-search-cli-examples-toggle"
          onClick={() => setExamplesOpen((open) => !open)}
        >
          {examplesOpen ? (zh ? '收起示例' : 'Hide examples') : zh ? '用示例填充' : 'Fill from example'}
        </Button>
        <Button
          variant="primary"
          disabled={disabled}
          data-testid="web-search-cli-test"
          onClick={() => void runTest()}
        >
          {test.status === 'loading' ? (zh ? '测试中…' : 'Testing…') : zh ? '测试' : 'Test'}
        </Button>
      </div>

      {examplesOpen ? (
        <div className="web-cli-examples-list" data-testid="web-search-cli-examples">
          <button
            type="button"
            className="web-cli-example"
            disabled={disabled}
            onClick={() => {
              onChange({
                kind: 'http',
                baseUrl: 'http://127.0.0.1:8787/search',
              });
              setExamplesOpen(false);
              setAppliedNote(zh ? '已切到 HTTP 接口示例' : 'Switched to the HTTP example');
              setTest({ status: 'idle' });
            }}
          >
            <div className="web-cli-example-title">{zh ? 'HTTP 接口' : 'HTTP endpoint'}</div>
            <code className="web-cli-example-command">POST /search {'{ query, count }'}</code>
            <div className="web-cli-example-note">
              {zh
                ? 'Open WebUI External Search 同款。已有搜索网关就用这个。'
                : 'Same contract as Open WebUI External Search. Use this when you already have an HTTP API.'}
            </div>
          </button>
          {CLI_SEARCH_EXAMPLES.map((example) => (
            <button
              type="button"
              className="web-cli-example"
              key={example.id}
              disabled={disabled}
              onClick={() => {
                onChange({
                  kind: 'cli',
                  command: example.command,
                  args: example.args.join('\n'),
                });
                setExamplesOpen(false);
                setAppliedNote(zh ? `已填入「${example.labelZh}」` : `Filled “${example.label}”`);
                setTest({ status: 'idle' });
              }}
            >
              <div className="web-cli-example-title">{zh ? example.labelZh : example.label}</div>
              <div className="web-cli-example-description">
                {zh ? example.descriptionZh : example.description}
              </div>
              <code className="web-cli-example-command">{formatCliSearchExample(example)}</code>
              <div className="web-cli-example-note">{zh ? example.noteZh : example.note}</div>
            </button>
          ))}
        </div>
      ) : null}

      {appliedNote ? <div className="web-cli-notice is-ok">{appliedNote}</div> : null}

      {test.status === 'ok' ? (
        <div className="web-secret-test-result is-success" data-testid="web-search-cli-test-result">
          {zh
            ? `解析到 ${test.resultCount} 条 hits · ${test.durationMs}ms`
            : `${test.resultCount} hits · ${test.durationMs}ms`}
        </div>
      ) : null}
      {test.status === 'err' ? (
        <div className="web-secret-test-result is-error" data-testid="web-search-cli-test-result">
          {test.message}
        </div>
      ) : null}
    </>
  );
}
