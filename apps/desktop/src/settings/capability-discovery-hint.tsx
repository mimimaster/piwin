/**
 * Settings manage what is installed; discovery happens in conversation
 * (`capability_search` / `capability_install` via find-skill) or on the
 * sidebar marketplace page. One shared line so the three panels agree.
 */
import type { ReactElement } from 'react';
import { useDesktopLocale } from '../desktop-locale-context';

export function CapabilityDiscoveryHint(props: { kind: 'skill' | 'mcp' | 'plugin' }): ReactElement {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const what = zh
    ? { skill: '技能', mcp: 'MCP 服务', plugin: '插件' }[props.kind]
    : { skill: 'skills', mcp: 'MCP servers', plugin: 'plugins' }[props.kind];
  return (
    <p className="muted capability-discovery-hint" data-testid={`capability-discovery-hint-${props.kind}`}>
      {zh
        ? `想添加新的${what}？直接在对话里说“帮我找个能……的${what}”，Agent 会从精选目录查找，经你确认后安装；也可以在侧栏「扩展市场」浏览。`
        : `Want new ${what}? Ask in chat (“find me ${what} that can …”): the agent searches the curated catalog and installs with your approval. Or browse the Marketplace in the sidebar.`}
    </p>
  );
}
