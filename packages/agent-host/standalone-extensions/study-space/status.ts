import type { Mode, Preferences, Topic } from './model.js';

export type Shown = { mode: Mode; topic: Topic | undefined } | undefined;
const MODES: Record<Mode, string> = { learn: '学习', review: '复习与回炉', save: '沉淀' };

export function modeLabel(shown: Shown): string {
  if (!shown) return '未开启';
  return shown.topic ? `${MODES[shown.mode]} · ${shown.topic.topic}` : MODES[shown.mode];
}
/** Progress is counted from recorded concepts only; there is deliberately no mastery percentage. */
export function topicLine(topic: Topic): string {
  if (topic.concepts.length === 0) return `${topic.topic}：尚未规划概念`;
  const done = topic.concepts.filter(c => c.status === 'done').length;
  const weak = topic.concepts.reduce((sum, c) => sum + c.weak.length, 0);
  const next = topic.concepts.find(c => c.status !== 'done');
  return `${topic.topic}：${done}/${topic.concepts.length} 个概念已写入 wiki${weak ? ` · ${weak} 个薄弱点` : ''}${next ? ` · 下一个：${next.name}` : ' · 路径已走完'}`;
}
export function dashboard(shown: Shown, topics: Topic[], preferences: Preferences): string[] {
  const lines = [`Study Space · ${modeLabel(shown)}`];
  if (topics.length === 0) lines.push('还没有学习主题。/learn <主题> 开始第一个。');
  for (const topic of topics) lines.push(topicLine(topic));
  lines.push(`制卡：${preferences.cards === 'never' ? '已关闭' : '只为答错的点制卡，由 Host 弹窗确认'}`);
  lines.push('/learn 继续或新开主题 · /review 到期复习与回炉 · /study save 沉淀刚才的对话 · /study off 退出');
  return lines;
}
/** Shown right after a command: commands select the mode, the next message starts the turn. */
export function hint(shown: NonNullable<Shown>): string[] {
  const next = shown.mode === 'learn'
    ? (shown.topic?.concepts.length ? '发送“继续”接着学' : '发送“开始”，我会先查你的知识库和 wiki，再给出学习路径')
    : shown.mode === 'review' ? '发送“开始”查看到期卡片；或贴出一张没答上的卡，我来重讲'
      : '发送“好”，我会把刚才的对话整理成一页 wiki 概念';
  return [`Study Space · ${modeLabel(shown)}`, next];
}
