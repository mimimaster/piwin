const KNOWN: ReadonlyArray<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/Archived session must be restored/i, () => '这个会话已归档，先用 /unarchive 恢复再发送。发出的文字已放回输入框'],
  [/Unknown session: (\S+)/i, () => '这个会话已经不存在了（可能在别处被删除），用 /new 开始新会话'],
  [/transport is not open/i, () => '和 Host 的连接断开了，正在重连。发出的文字已放回输入框，连上后再发送'],
  [/Host client (?:has been )?closed/i, () => '和 Host 的连接已关闭，请重新启动 piwin tui'],
  [/Host request timed out: (\S+)/i, (match) => `Host 没有及时回应（${match[1]}），稍后再试`],
  [/subscription update timed out/i, () => 'Host 没有及时回应订阅更新，稍后再试'],
  [/ECONNREFUSED|ECONNRESET|socket hang up/i, () => '连不上 Host，请确认它还在运行'],
];

/** A transport or timeout failure in words a person can act on; anything else is shown as the Host said it. */
export function describeHostFailure(message: string): string {
  for (const [pattern, describe] of KNOWN) {
    const match = message.match(pattern);
    if (match !== null) return describe(match);
  }
  return message;
}
