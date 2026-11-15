import {
  matchesKey,
  visibleWidth,
  type Focusable,
} from "@earendil-works/pi-tui";
import { calcHitRate, estimateSavings } from "./helpers.ts";
import type { HistoryPoint, PersistedStats } from "./types.ts";

export class CacheStatsOverlay implements Focusable {
  readonly width = 58;
  focused = false;
  private stats: PersistedStats;
  private aggregate?: PersistedStats & { sessionCount: number };
  private prefixBreaks = 0;
  private theme: any;
  private done: () => void;
  private modelId?: string;

  constructor(
    theme: any,
    stats: PersistedStats,
    done: () => void,
    aggregate?: PersistedStats & { sessionCount: number },
    prefixBreaks?: number,
    modelId?: string,
  ) {
    this.theme = theme;
    this.stats = stats;
    this.done = done;
    this.aggregate = aggregate;
    if (prefixBreaks !== undefined) this.prefixBreaks = prefixBreaks;
    if (modelId !== undefined) this.modelId = modelId;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return")) this.done();
  }

  private sectionBlock(
    title: string,
    s: PersistedStats,
    turnsLabel?: string,
  ): string[] {
    const th = this.theme;
    const inner = this.width - 2;
    const { cacheRead, input, cacheWrite, turns } = s;
    const hitRate = calcHitRate(cacheRead, input, cacheWrite).toFixed(1);
    const { saved } = estimateSavings(cacheRead, input, 0, this.modelId);
    const savedStr = saved >= 0.01 ? `$${saved.toFixed(2)}` : "< $0.01";
    const pad = (s: string) =>
      s + " ".repeat(Math.max(0, inner - visibleWidth(s)));
    const row = (s: string) =>
      th.fg("border", "│") + pad(s) + th.fg("border", "│");
    const label = (k: string, v: string) =>
      `  ${th.fg("dim", k.padEnd(18))}${th.fg("accent", v)}`;
    const showCacheWrite = cacheWrite > 0;
    const turnStr = turnsLabel ?? `${turns}`;

    const rows: string[] = [
      row(` ${th.fg("accent", title)}`),
      row(""),
      row(label("Hit rate", `${hitRate}%`)),
      row(label("Cache hits", `${cacheRead.toLocaleString()} tokens`)),
    ];

    if (showCacheWrite) {
      rows.push(
        row(label("Cache writes", `${cacheWrite.toLocaleString()} tokens`)),
      );
    }

    rows.push(
      row(label("Cache misses", `${input.toLocaleString()} tokens`)),
      row(label("Turns", turnStr)),
      row(label("Est. savings", `${th.fg("accent", savedStr)}`)),
    );

    return rows;
  }

  render(_width: number): string[] {
    const th = this.theme;
    const inner = this.width - 2;
    const pad = (s: string) =>
      s + " ".repeat(Math.max(0, inner - visibleWidth(s)));
    const row = (s: string) =>
      th.fg("border", "│") + pad(s) + th.fg("border", "│");

    const lines: string[] = [
      th.fg("border", `╭${"─".repeat(inner)}╮`),
      ...this.sectionBlock("⚡ This Session", this.stats),
    ];

    if (this.aggregate && this.aggregate.sessionCount > 1) {
      lines.push(row(""));
      lines.push(
        row(
          ` ${th.fg("dim", `─── All Sessions (${this.aggregate.sessionCount}) ───`)}`,
        ),
      );
      lines.push(
        ...this.sectionBlock(
          "📊 Aggregate",
          {
            cacheRead: this.aggregate.cacheRead,
            input: this.aggregate.input,
            cacheWrite: this.aggregate.cacheWrite,
            turns: this.aggregate.turns,
          },
          `${this.aggregate.turns}`,
        ),
      );
    }

    lines.push(row(""));
    if (this.prefixBreaks > 0) {
      lines.push(
        row(
          `  ${th.fg("dim", "Prefix breaks".padEnd(18))}${th.fg("accent", String(this.prefixBreaks))}`,
        ),
      );
    }
    lines.push(row(` ${th.fg("dim", "Esc / Enter to close")}`));
    lines.push(th.fg("border", `╰${"─".repeat(inner)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

export class CacheGraphOverlay implements Focusable {
  readonly width = 60;
  focused = false;
  private history: HistoryPoint[];
  private theme: any;
  private done: () => void;

  constructor(theme: any, history: HistoryPoint[], done: () => void) {
    this.theme = theme;
    this.history = history;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return")) this.done();
  }

  render(_width: number): string[] {
    const th = this.theme;
    const inner = this.width - 2;
    const pad = (s: string) =>
      s + " ".repeat(Math.max(0, inner - visibleWidth(s)));
    const row = (s: string) =>
      th.fg("border", "│") + pad(s) + th.fg("border", "│");

    if (this.history.length < 2) {
      return [
        th.fg("border", `╭${"─".repeat(inner)}╮`),
        row(` ${th.fg("accent", "⚡ Cache Hit Rate Trend")}`),
        row(""),
        row(`  ${th.fg("dim", "Need 2+ turns with cache data for a trend")}`),
        row(`  ${th.fg("dim", "Keep chatting and try again")}`),
        row(""),
        row(` ${th.fg("dim", "Esc to close")}`),
        th.fg("border", `╰${"─".repeat(inner)}╯`),
      ];
    }

    const rates = this.history.map((h) => h.hitRate);
    const maxRate = Math.max(...rates, 1);
    const minRate = Math.min(...rates, 0);
    const range = maxRate - minRate || 1;
    const chartH = 8;
    const maxW = 44;
    const step = Math.max(1, Math.floor(this.history.length / maxW));
    const data = this.history.filter((_, i) => i % step === 0).slice(-maxW);
    const chartW = data.length;

    // Build chart rows
    const chart: string[] = [];
    for (let r = chartH; r >= 0; r--) {
      const threshold = minRate + range * (r / chartH);
      let line =
        r === chartH
          ? `${maxRate.toFixed(0)}%`.padStart(4)
          : r === 0
            ? `${minRate.toFixed(0)}%`.padStart(4)
            : "    ";
      for (const p of data) {
        line += p.hitRate >= threshold ? "█" : " ";
      }
      chart.push(line);
    }

    // X axis
    chart.push("    " + "─".repeat(chartW));

    // X labels — first / mid / last
    const first = String(data[0].turn);
    const last = String(data[data.length - 1].turn);
    const midIdx = Math.floor(data.length / 2);
    const mid = data.length > 2 ? String(data[midIdx].turn) : "";
    const xChars = new Array(chartW).fill(" ");

    for (let i = 0; i < first.length && i < chartW; i++) xChars[i] = first[i];
    if (mid) {
      const start = Math.floor((chartW - mid.length) / 2);
      for (let i = 0; i < mid.length; i++) {
        const pos = start + i;
        if (pos >= 0 && pos < chartW) xChars[pos] = mid[i];
      }
    }
    for (let i = 0; i < last.length; i++) {
      const pos = chartW - last.length + i;
      if (pos >= 0 && pos < chartW) xChars[pos] = last[i];
    }
    chart.push("    " + xChars.join(""));
    chart.push("    Turn →");

    const lines = [
      th.fg("border", `╭${"─".repeat(inner)}╮`),
      row(
        ` ${th.fg("accent", `⚡ Cache Hit Rate Trend (${this.history.length} points)`)}`,
      ),
      row(""),
    ];
    for (const c of chart) lines.push(row(`  ${c}`));
    lines.push(row(""));
    lines.push(row(` ${th.fg("dim", "Esc to close")}`));
    lines.push(th.fg("border", `╰${"─".repeat(inner)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

