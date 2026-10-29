import type { ThinkingLevel } from '@piwin/contracts';

/** One-line explanation of each thinking level for the phone effort popover. */
const ZH: Record<ThinkingLevel, string> = {
  off: '不思考，直接回答，最快',
  minimal: '只做极少思考，几乎和直接回答一样快',
  low: '简单想一下，适合日常问题',
  medium: '速度与质量平衡，默认推荐',
  high: '深入思考，适合复杂问题，较慢',
  xhigh: '更长的推理，适合难题，明显更慢',
  max: '用尽可用的思考预算，最慢',
  ultra: '最深入的推理，最慢',
};

const EN: Record<ThinkingLevel, string> = {
  off: 'No thinking, answers right away',
  minimal: 'Barely thinks, nearly as fast as off',
  low: 'A quick think, good for everyday asks',
  medium: 'Balanced speed and quality',
  high: 'Thinks deeply, for hard problems; slower',
  xhigh: 'Longer reasoning for tough problems; much slower',
  max: 'Uses the full thinking budget; slowest',
  ultra: 'Deepest reasoning; slowest',
};

export function describeThinkingLevel(level: ThinkingLevel, isZh: boolean): string {
  return (isZh ? ZH : EN)[level] ?? '';
}
