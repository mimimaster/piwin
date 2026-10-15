/**
 * Viz kit stylesheet (ADR 0093). Inlined with the kit CSS only when a
 * document carries `data-piwin-viz`. Every color is a `--piwin-artifact-*`
 * token or a mix of one; a state's hue arrives as `data-t` (tone) or
 * `data-s` (series) and is read through `--pv-c`.
 */
const A = (token: string) => `var(--piwin-artifact-${token})`;
const line = (strength: number) => `color-mix(in srgb, ${A('text')} ${strength}%, transparent)`;
const tint = (strength: number) => `color-mix(in srgb, var(--pv-c) ${strength}%, ${A('surface')})`;

const TONES = ['warn', 'accent', 'ok', 'risk', 'info', 'muted'] as const;

export function buildArtifactVizCss(): string {
  const tones = TONES.map((tone) => `[data-piwin-viz] [data-t="${tone}"] { --pv-c: ${A(tone)}; }`).join('\n');
  const series = [1, 2, 3, 4, 5, 6].map((n) => `[data-piwin-viz] [data-s="${n}"] { --pv-c: ${A(`series-${n}`)}; }`).join('\n');
  return `
:where(figure[data-piwin-viz]) { margin: 0 0 14px; min-width: 0; color: ${A('text')}; font: 14px/1.5 ${A('font')}; }
:where([data-piwin-viz] > script) { display: none; }
:where(figure[data-piwin-viz]:not([data-piwin-viz-ready]):not(:has(> script)))::before { content: ""; display: block; height: 140px; border-radius: 10px; background: ${line(3)}; }
:where([data-piwin-viz] figcaption) { margin-top: 8px; color: ${A('muted')}; font-size: 12px; line-height: 1.5; }
${tones}
${series}
.pv-stage { min-width: 0; overflow-x: auto; padding-block: 4px; }
.pv-svg { display: block; height: auto; overflow: visible; }
.pv-svg text { fill: ${A('text')}; font: 12px ${A('font')}; }
.pv-svg .pv-mono, .pv-mono { font-family: ${A('font-mono')}; }
.pv-svg .pv-muted { fill: ${A('muted')}; font-size: 11px; }
.pv-svg .pv-accent { fill: ${A('accent')}; font-weight: 600; }
.pv-svg .pv-risk { fill: ${A('risk')}; font-weight: 600; }
.pv-svg .pv-strong { font-weight: 600; }
.pv-svg .pv-msg { font-size: 11px; }
.pv-svg .pv-mid { text-anchor: middle; dominant-baseline: central; }
.pv-svg .pv-end { text-anchor: end; }
.pv-svg .pv-halo { paint-order: stroke; stroke: ${A('surface')}; stroke-width: 4px; stroke-linejoin: round; }
.pv-node, .pv-tile { fill: ${A('surface')}; stroke: ${line(34)}; stroke-width: 1.5; }
.pv-node[data-t], .pv-tile[data-t] { fill: ${tint(16)}; stroke: var(--pv-c); }
.pv-headnode { fill: ${A('surface-2')}; }
.pv-edge { fill: none; stroke: ${line(34)}; stroke-width: 1.5; }
.pv-edge[data-t] { stroke: var(--pv-c); stroke-width: 2.25; }
.pv-head { fill: ${line(34)}; }
.pv-head[data-t] { fill: var(--pv-c); }
.pv-sep, .pv-axis { stroke: ${line(34)}; stroke-width: 1.25; }
.pv-dot { fill: ${A('text')}; }
.pv-line { fill: none; stroke: ${A('accent')}; stroke-width: 2; stroke-linejoin: round; }
.pv-pt { fill: ${A('accent')}; }
.pv-pt[data-t] { fill: var(--pv-c); }
.pv-ico { color: ${A('text')}; }
.pv-zone { fill: color-mix(in srgb, ${A('accent')} 4%, transparent); stroke: ${A('border')}; stroke-dasharray: 5 4; }
.pv-link-line { stroke: ${line(34)}; stroke-width: 2; }
.pv-link-line.pv-wireless { stroke-dasharray: 4 4; }
.pv-link-line[data-t] { stroke: var(--pv-c); stroke-width: 3; }
.pv-packet { fill: ${A('accent')}; stroke: ${A('surface')}; stroke-width: 2; }
.pv-life { stroke: ${line(30)}; stroke-width: 1.25; stroke-dasharray: 3 4; }

.pv-cell { min-width: 36px; height: 36px; padding: 0 6px; display: grid; place-items: center; box-sizing: border-box; border: 1.5px solid ${line(34)}; border-radius: 6px; background: ${A('surface')}; font: 500 14px ${A('font-mono')}; font-variant-numeric: tabular-nums; }
.pv-cell[data-t] { background: ${tint(16)}; border-color: var(--pv-c); }
.pv-cell.pv-empty { border-style: dashed; border-color: ${line(18)}; }
.pv-cell.pv-sm { min-width: 32px; height: 28px; font-size: 12.5px; border-radius: 5px; }
.pv-arr { display: flex; gap: 6px; width: max-content; }
.pv-slot { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.pv-ptr { height: 18px; display: flex; flex-direction: column; align-items: center; color: ${A('accent')}; font: 600 11px ${A('font-mono')}; white-space: nowrap; }
.pv-ptr:not(:empty)::after { content: ""; margin-top: 1px; border: 4px solid transparent; border-top-color: currentColor; border-bottom: 0; }
.pv-idx { color: ${A('muted')}; font: 10.5px ${A('font-mono')}; }
.pv-stack { display: flex; flex-direction: column-reverse; gap: 4px; width: max-content; }
.pv-srow { display: flex; align-items: center; gap: 8px; }
.pv-srow .pv-cell { width: 72px; }
.pv-srow .pv-idx { width: 14px; text-align: right; }
.pv-sptr { width: 56px; color: ${A('accent')}; font: 600 11px ${A('font-mono')}; }
.pv-hash { display: flex; flex-direction: column; gap: 5px; }
.pv-hrow { display: flex; align-items: center; }
.pv-bucket { background: ${A('surface-2')}; color: ${A('muted')}; font-size: 11px; }
.pv-link { position: relative; flex: none; width: 18px; height: 1.5px; background: ${line(34)}; }
.pv-link::after { content: ""; position: absolute; right: -1px; top: -3.5px; border: 4px solid transparent; border-left: 6px solid ${line(34)}; border-right: 0; }
.pv-nil { margin-left: 8px; color: ${A('muted')}; font: 12px ${A('font-mono')}; }
.pv-win { position: relative; display: flex; gap: 4px; width: max-content; padding: 8px; --pv-cw: 34px; }
.pv-win .pv-cell { width: var(--pv-cw); min-width: 0; height: 34px; font-size: 12.5px; }
.pv-win .pv-na { color: ${A('muted')}; border-color: ${line(14)}; }
.pv-win .pv-usable { border-color: ${A('accent')}; border-style: dashed; }
.pv-wbox { position: absolute; top: 2px; bottom: 2px; left: calc(4px + var(--pv-ws) * (var(--pv-cw) + 4px)); width: calc(var(--pv-wn) * (var(--pv-cw) + 4px) + 4px); box-sizing: border-box; border: 2px solid ${A('accent')}; border-radius: 8px; pointer-events: none; }

.pv-bits { display: flex; gap: 3px; min-width: 0; }
.pv-bf { display: flex; flex-direction: column; flex-basis: 0; min-width: 38px; }
.pv-br { display: flex; justify-content: space-between; padding: 0 2px; color: ${A('muted')}; font: 10px ${A('font-mono')}; }
.pv-bv { display: grid; place-items: center; min-height: 30px; padding: 5px 4px; border: 1.5px solid var(--pv-c); border-radius: 5px; background: ${tint(13)}; font: 12px/1.3 ${A('font-mono')}; text-align: center; word-break: break-all; }
.pv-bn { margin-top: 3px; font-size: 11.5px; text-align: center; }
.pv-hdr { display: grid; gap: 3px; }
.pv-rl { display: flex; justify-content: space-between; color: ${A('muted')}; font: 10px ${A('font-mono')}; }
.pv-hf { min-width: 0; padding: 7px 1px; overflow: hidden; border: 1px solid ${line(34)}; border-radius: 4px; background: ${A('surface')}; font-size: 11.5px; text-align: center; white-space: nowrap; text-overflow: ellipsis; }
.pv-hf[data-t] { background: ${tint(16)}; border-color: var(--pv-c); }
.pv-hf.pv-flag { padding-inline: 0; font: 600 11px ${A('font-mono')}; }
.pv-dashed { border-style: dashed; color: ${A('muted')}; }

.pv-grid, .pv-table { width: auto; border-collapse: separate; border-spacing: 3px; font-size: 12px; }
.pv-table { margin-top: 6px; }
/* The inline-flow host stretches every table to 100% !important; viz tables are
   compact data strips sized by their cells, so they opt out with more weight. */
html[data-frame-mode] .piwin-artifact-root table.pv-table, html[data-frame-mode] .piwin-artifact-root table.pv-grid { width: auto !important; }
.pv-grid th, .pv-table th { padding: 0 4px; color: ${A('muted')}; font: 500 11px ${A('font-mono')}; text-align: center; white-space: nowrap; }
.pv-grid th.pv-rh, .pv-table th.pv-rh { padding-right: 8px; color: ${A('text')}; font-weight: 400; text-align: left; }
.pv-grid th.pv-now { color: ${A('accent')}; font-weight: 700; }
.pv-grid td, .pv-table td { min-width: 32px; height: 28px; border-radius: 5px; font: 500 11.5px ${A('font-mono')}; font-variant-numeric: tabular-nums; text-align: center; }
.pv-table td { height: 24px; min-width: 40px; }
.pv-grid td.pv-on { background: ${A('surface-2')}; }
.pv-grid td[data-t], .pv-table td[data-t] { background: ${tint(18)}; }
.pv-grid td.pv-bubble { background: repeating-linear-gradient(135deg, color-mix(in srgb, ${A('warn')} 30%, transparent) 0 3px, transparent 3px 7px); color: ${A('warn')}; }
.pv-grid td.pv-nowcell { box-shadow: inset 0 0 0 1.5px ${A('accent')}; }

/* Inline padding keeps the first and last axis labels inside the stage. */
.pv-scale { padding-inline: 10px; }
.pv-ticks { position: relative; height: 18px; }
.pv-gbar, .pv-mbar { position: relative; overflow: hidden; border: 1px solid ${A('border')}; border-radius: 6px; }
.pv-gbar { height: 34px; }
.pv-mbar { height: 48px; }
.pv-gseg, .pv-mblk { position: absolute; top: 0; bottom: 0; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; align-items: center; overflow: hidden; border-right: 1px solid ${A('surface')}; white-space: nowrap; }
.pv-gseg { background: ${tint(24)}; font: 600 12px ${A('font-mono')}; }
.pv-mblk { background: color-mix(in srgb, ${A('series-1')} 12%, ${A('surface')}); border-right-color: ${A('border')}; font-size: 11.5px; line-height: 1.25; }
.pv-mblk small { color: ${A('muted')}; font: 10.5px ${A('font-mono')}; }
.pv-mblk.pv-free { background: repeating-linear-gradient(135deg, ${line(7)} 0 4px, transparent 4px 9px); }
.pv-mblk.pv-fixed { background: ${A('surface-2')}; }
.pv-mblk[data-t] { background: ${tint(22)}; box-shadow: inset 0 0 0 2px var(--pv-c); }
.pv-off { opacity: 0.12; }
.pv-gseg.pv-off { opacity: 0; }
.pv-tick { position: absolute; top: 3px; transform: translateX(-50%); color: ${A('muted')}; font: 10.5px ${A('font-mono')}; }

.pv-layers { display: grid; gap: 5px 3px; align-items: center; min-width: 440px; }
.pv-lay { grid-column: 1; padding-right: 10px; font-size: 12px; white-space: nowrap; }
.pv-lay small { margin-left: 4px; color: ${A('muted')}; }
.pv-part { padding: 6px 4px; overflow: hidden; border: 1.5px solid var(--pv-c, ${line(34)}); border-radius: 4px; background: ${tint(14)}; font-size: 11.5px; text-align: center; white-space: nowrap; text-overflow: ellipsis; }
.pv-part:not([data-s]):not([data-t]) { --pv-c: ${line(34)}; background: ${A('surface')}; }

.pv-bar { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid ${line(8)}; }
.pv-btn { flex: none; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid ${A('border')}; border-radius: 6px; background: ${A('surface')}; color: ${A('text')}; cursor: pointer; }
.pv-btn:hover { background: ${A('surface-2')}; }
.pv-btn:focus-visible { outline: 2px solid ${A('accent')}; outline-offset: 1px; }
.pv-note { flex: 1; min-width: 0; padding-left: 4px; font-size: 12.5px; line-height: 1.4; }
.pv-count { color: ${A('muted')}; font: 11px ${A('font-mono')}; font-variant-numeric: tabular-nums; }
`;
}
