/**
 * Desktop UI preferences (localStorage). Cursor-like tool density etc.
 * Not product config under ~/.piwin — pure presentation.
 */

export type ToolCallDensity = 'compact' | 'comfortable' | 'detailed';

const TOOL_DENSITY_KEY = 'piwin.desktop.toolCallDensity';

export function loadToolCallDensity(): ToolCallDensity {
  try {
    const raw = localStorage.getItem(TOOL_DENSITY_KEY);
    if (raw === 'compact' || raw === 'comfortable' || raw === 'detailed') {
      return raw;
    }
  } catch {
    // private mode / SSR
  }
  return 'comfortable';
}

export function saveToolCallDensity(density: ToolCallDensity): void {
  try {
    localStorage.setItem(TOOL_DENSITY_KEY, density);
  } catch {
    // ignore
  }
}

export function densityToSliderValue(density: ToolCallDensity): number {
  if (density === 'compact') return 0;
  if (density === 'detailed') return 2;
  return 1;
}

export function sliderValueToDensity(value: number): ToolCallDensity {
  if (value <= 0) return 'compact';
  if (value >= 2) return 'detailed';
  return 'comfortable';
}
