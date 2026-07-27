import {
  createContext,
  useContext,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import {
  getDesktopTranslator,
  type DesktopLocale,
  type DesktopTranslator,
} from './desktop-locale';

type DesktopLocaleContextValue = {
  locale: DesktopLocale;
  setLocale: (locale: DesktopLocale) => void;
  translator: DesktopTranslator;
};

const DEFAULT_CONTEXT_VALUE: DesktopLocaleContextValue = {
  locale: 'zh-CN',
  setLocale: () => undefined,
  translator: getDesktopTranslator('zh-CN'),
};

const DesktopLocaleContext = createContext<DesktopLocaleContextValue>(DEFAULT_CONTEXT_VALUE);

export type DesktopLocaleProviderProps = PropsWithChildren<{
  locale: DesktopLocale;
  onLocaleChange: (locale: DesktopLocale) => void;
}>;

/** Provides display-only language state to every desktop surface and dialog. */
export function DesktopLocaleProvider({
  locale,
  onLocaleChange,
  children,
}: DesktopLocaleProviderProps): ReactElement {
  return (
    <DesktopLocaleContext.Provider
      value={{
        locale,
        setLocale: onLocaleChange,
        translator: getDesktopTranslator(locale),
      }}
    >
      {children}
    </DesktopLocaleContext.Provider>
  );
}

export function useDesktopLocale(): DesktopLocaleContextValue {
  return useContext(DesktopLocaleContext);
}
