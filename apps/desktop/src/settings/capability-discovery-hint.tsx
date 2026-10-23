/**
 * Settings manage what is installed; discovery happens in conversation
 * (`capability_search` / `capability_install` via find-skill) or on the
 * sidebar marketplace page. One shared line so the three panels agree.
 */
import type { ReactElement } from 'react';
import { useDesktopLocale } from '../i18n/desktop-locale-context';

export function CapabilityDiscoveryHint(props: { kind: 'skill' | 'mcp' }): ReactElement {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const what = zh
    ? { skill: '技能', mcp: 'MCP 服务' }[props.kind]
    : { skill: 'skills', mcp: 'MCP servers' }[props.kind];
  return (
    <p className="muted capability-discovery-hint" data-testid={`capability-discovery-hint-${props.kind}`}>
      {zh
        ? `想添加新的${what}？直接在对话里说“帮我装个能……的${what}”，Agent 会查找${props.kind === 'skill' ? '精选目录和 skills.sh 社区' : '精选目录'}，你在权限弹窗里批准即可安装；也可以在侧栏「扩展市场」浏览。`
        : `Want new ${what}? Ask in chat (“install ${what} that can …”): the agent searches ${props.kind === 'skill' ? 'the curated catalog and the skills.sh community' : 'the curated catalog'} and installs once you approve the permission prompt. Or browse the Marketplace in the sidebar.`}
    </p>
  );
}
