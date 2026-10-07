import type { AppleHealthReadResultV1, HealthDigestCadence } from '@piwin/contracts';
import { formatHealthModelOutput } from './health-read-context-tool.js';

export function healthDigestSessionName(cadence: HealthDigestCadence, today: string): string {
  return cadence === 'weekly' ? `健康周报 ${today}` : `健康晨报 ${today}`;
}

/**
 * The single user turn of a digest session. The data block is the same
 * validated rendering the health tool gives a model, so a digest and a live
 * answer read the numbers identically.
 */
export function buildHealthDigestPrompt(input: {
  cadence: HealthDigestCadence;
  result: AppleHealthReadResultV1;
  today: string;
  syncedToday: boolean;
}): string {
  const scope =
    input.cadence === 'weekly'
      ? '请写一份本周健康周报：对比最近 7 天与此前 7 天，指出最明显的 2–3 个变化。'
      : '请写一份今天的健康晨报：先说昨晚的睡眠和今早的恢复状态，再说最近 7 天值得注意的变化。';
  const lines = [
    scope,
    '要求：',
    '- 只依据下面的数据，缺失的指标按「未知」处理，不要当成 0 或正常。',
    '- 用 baseline 行判断「对我来说是否正常」，偏离明显（|z| ≥ 1.5）的才值得单独提。',
    '- 标了 partial-day 的是当天尚未结束的累计值，不要与整天的基线比较高低。',
    '- 给出 1–2 条今天可以执行的具体建议；只做事实描述和生活方式建议，不做医学诊断。',
    '- 简短：不超过 200 字的正文加一个要点列表，开头直接给结论。',
    `今天是 ${input.today}（${input.result.timeZone}）。数据来自手机最近一次后台同步（${input.result.generatedAt}）。`,
  ];
  if (!input.syncedToday) {
    lines.push('注意：手机今天还没有同步过，最近一晚的睡眠可能尚未包含在内，请在开头说明这一点。');
  }
  lines.push('', formatHealthModelOutput(input.result));
  return lines.join('\n');
}
