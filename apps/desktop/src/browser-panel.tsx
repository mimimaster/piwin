/**
 * Browser side panel — simple URL preview via iframe.
 * Defaults to a local dev server; persists the last URL in sessionStorage.
 */

import { useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';

const BROWSER_URL_KEY = 'piwin.desktop.browserUrl';

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^\d+$/.test(trimmed)) {
    return `http://localhost:${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function BrowserPanel(): ReactElement {
  const [input, setInput] = useState(() => sessionStorage.getItem(BROWSER_URL_KEY) ?? 'http://localhost:3000');
  const [url, setUrl] = useState(input);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const next = normalizeUrl(input);
    setUrl(next);
    sessionStorage.setItem(BROWSER_URL_KEY, next);
  }

  return (
    <div className="browser-panel" data-testid="browser-panel">
      <form className="browser-panel-bar" onSubmit={handleSubmit}>
        <input
          className="browser-panel-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="http://localhost:3000"
          aria-label="URL to preview"
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" data-testid="browser-go-btn">
          Go
        </Button>
      </form>
      <div className="browser-panel-frame">
        {url ? (
          <iframe
            className="browser-panel-iframe"
            src={url}
            title="Browser preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            data-testid="browser-iframe"
          />
        ) : (
          <div className="muted terminal-empty">Enter a URL to load a preview.</div>
        )}
      </div>
    </div>
  );
}
