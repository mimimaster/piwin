import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { MemoryPressureLevel } from '../notes/memory-governor.js';

export type SettledTurnDietValue = {
  compactSettled: boolean;
};

const DEFAULT_VALUE: SettledTurnDietValue = { compactSettled: false };
const COMPACT_VALUE: SettledTurnDietValue = { compactSettled: true };

const SettledTurnDietContext = createContext<SettledTurnDietValue>(DEFAULT_VALUE);

/** Max turns kept in the static live-tail flow before folding older turns behind the top pager. */
export function resolveLiveStaticTurnTailCap(level: MemoryPressureLevel): number {
  void level;
  return 8;
}

/** Max recent turns kept with full rich interactive chrome before settled-turn auto-compaction. */
export function resolveFullFidelityTailCount(level: MemoryPressureLevel): number {
  void level;
  return 3;
}

export function SettledTurnDietProvider(props: {
  compactSettled: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <SettledTurnDietContext.Provider value={props.compactSettled ? COMPACT_VALUE : DEFAULT_VALUE}>
      {props.children}
    </SettledTurnDietContext.Provider>
  );
}

export function useSettledTurnDiet(): SettledTurnDietValue {
  return useContext(SettledTurnDietContext);
}
