// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, memo, useCallback, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesktopLocaleProvider, useDesktopLocale } from './desktop-locale-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const LocaleProbe = memo(function LocaleProbe({ onRender }: { onRender: () => void }) {
  const { locale } = useDesktopLocale();
  onRender();
  return <span data-testid="locale-probe">{locale}</span>;
});

function Harness({
  locale,
  tick,
  onRender,
}: {
  locale: 'zh-CN' | 'en';
  tick: number;
  onRender: () => void;
}): ReactElement {
  const onLocaleChange = useCallback(() => undefined, []);
  return (
    <DesktopLocaleProvider locale={locale} onLocaleChange={onLocaleChange}>
      <LocaleProbe onRender={onRender} />
      <span data-testid="tick">{tick}</span>
    </DesktopLocaleProvider>
  );
}

describe('DesktopLocaleProvider', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('does not re-render locale consumers when only the host activity tick changes', () => {
    const onRender = vi.fn();
    act(() => {
      root.render(<Harness locale="en" tick={0} onRender={onRender} />);
    });
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<Harness locale="en" tick={1} onRender={onRender} />);
    });
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="tick"]')?.textContent).toBe('1');
  });

  it('updates consumers when the selected locale changes', () => {
    const onRender = vi.fn();
    act(() => {
      root.render(<Harness locale="zh-CN" tick={0} onRender={onRender} />);
    });
    act(() => {
      root.render(<Harness locale="en" tick={1} onRender={onRender} />);
    });

    expect(onRender).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="locale-probe"]')?.textContent).toBe('en');
  });
});
