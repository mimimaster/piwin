import { createContext, useContext, type Dispatch } from 'react';
import { type InkstoneAction, type InkstoneState } from './inkstone-state.js';

export interface InkstoneContextValue {
  state: InkstoneState;
  dispatch: Dispatch<InkstoneAction>;
}

export const InkstoneContext = createContext<InkstoneContextValue | null>(null);

export function useInkstone(): InkstoneContextValue {
  const value = useContext(InkstoneContext);
  if (value === null) {
    throw new Error('useInkstone must be used inside InkstoneContext');
  }
  return value;
}
