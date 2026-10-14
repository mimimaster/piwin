/**
 * Pure geometry for the subagent fan-out card (Inkstone proto-14).
 *
 * Every child row is exactly `SUBAGENT_FANOUT_ROW_HEIGHT` tall in every
 * phase, so wire endpoints are arithmetic on the row index — no DOM
 * measurement, and a row changing phase never moves a wire. The CSS row
 * height (`--sa-fan-row-h` in subagent-fanout.css) must equal this constant.
 */

export const SUBAGENT_FANOUT_ROW_HEIGHT = 46;
/** Width of the curve column between the main node and the rows. */
export const SUBAGENT_FANOUT_WIRE_WIDTH = 52;
/** Width of the tree-rail column used when the card is narrow. */
export const SUBAGENT_FANOUT_RAIL_WIDTH = 22;

const RAIL_X = 11;
const RAIL_RADIUS = 6;

export function subagentFanoutHeight(count: number): number {
  return Math.max(0, count) * SUBAGENT_FANOUT_ROW_HEIGHT;
}

/** Vertical centre of row `index`. */
export function subagentFanoutRowY(index: number): number {
  return index * SUBAGENT_FANOUT_ROW_HEIGHT + SUBAGENT_FANOUT_ROW_HEIGHT / 2;
}

/** All wires leave the main node from the middle of the column. */
export function subagentFanoutOriginY(count: number): number {
  return subagentFanoutHeight(count) / 2;
}

/** Cubic from the shared origin (x = 0) to the left edge of row `index`. */
export function subagentFanoutCurvePath(
  index: number,
  count: number,
  width: number = SUBAGENT_FANOUT_WIRE_WIDTH,
): string {
  const y0 = subagentFanoutOriginY(count);
  const y1 = subagentFanoutRowY(index);
  const bend = width * 0.55;
  return `M0 ${y0} C${bend} ${y0} ${width - bend} ${y1} ${width} ${y1}`;
}

/** Narrow card: one trunk from the top with a rounded elbow into each row. */
export function subagentFanoutRailPath(index: number): string {
  const y1 = subagentFanoutRowY(index);
  return (
    `M${RAIL_X} 0 V${y1 - RAIL_RADIUS} ` +
    `Q${RAIL_X} ${y1} ${RAIL_X + RAIL_RADIUS} ${y1} H${SUBAGENT_FANOUT_RAIL_WIDTH}`
  );
}
