import type { ReactElement } from 'react';
import { InkstoneApp } from './inkstone/InkstoneApp.js';

/**
 * Inkstone mobile shell (visual truth: docs/design/inkstone/proto-08-mobile.html).
 *
 * UI-first round: the shell runs on local prototype data and does not touch a Host.
 * The previous Deck implementation (components/, surfaces/, hooks/) is kept in place
 * for the follow-up pass that wires Inkstone screens to the live host connection.
 */
export function App(): ReactElement {
  return <InkstoneApp />;
}
