import type { MockHostBackend } from '../host/host-client-mock.js';

/**
 * Every shape the project tree has to lay out: a worktree group whose primary
 * shares the repository name, a detached linked worktree, standalone projects
 * on default and feature branches, and piwin sessions mixed with external
 * agent sessions. Only installed by the build-time E2E flag and query parameter.
 */
export function seedSidebarTreeHost(host: MockHostBackend): void {
  const createdAt = '2026-10-12T02:00:00.000Z';
  const projects: {
    path: string;
    gitRepositoryId?: string;
    isPrimaryWorktree?: true;
    branch?: string;
    missing?: true;
  }[] = [
    { path: '/mock/piwin', gitRepositoryId: 'repo-piwin', isPrimaryWorktree: true, branch: 'main' },
    { path: '/mock/piwin-release', gitRepositoryId: 'repo-piwin', branch: 'HEAD 98dc5a2f' },
    { path: '/mock/piwin-live-e2e-proj', gitRepositoryId: 'repo-e2e', isPrimaryWorktree: true, branch: 'master' },
    { path: '/mock/proj', gitRepositoryId: 'repo-proj', isPrimaryWorktree: true, branch: 'feat/usage' },
    { path: '/mock/nfsw' },
    { path: '/mock/old-playground', missing: true },
    { path: '/mock/retired-worker', missing: true },
  ];
  for (const project of projects) {
    host.mockProjects.set(project.path, {
      path: project.path,
      trust: 'trusted',
      createdAt,
      lastOpenedAt: createdAt,
      ...(project.gitRepositoryId ? { gitRepositoryId: project.gitRepositoryId } : {}),
      ...(project.isPrimaryWorktree ? { isPrimaryWorktree: true } : {}),
      ...(project.branch ? { currentBranch: project.branch } : {}),
      ...(project.missing ? { workspaceAvailability: 'missing' as const } : {}),
    });
    if (project.branch) {
      host.mockGitCurrentBranches.set(project.path, project.branch);
    }
  }
  const sessions: { id: string; projectPath: string; name: string; hoursAgo: number; grok?: true }[] = [
    { id: 'tree-teacher', projectPath: '/mock/piwin', name: 'Teacher Feature 方案设计与拆分', hoursAgo: 13, grok: true },
    { id: 'tree-sidebar', projectPath: '/mock/piwin', name: 'Fix sidebar remove 行为与墓碑记录', hoursAgo: 15, grok: true },
    { id: 'tree-ttft', projectPath: '/mock/piwin', name: '状态栏 TTFT 与缓存指标', hoursAgo: 18 },
    { id: 'tree-model', projectPath: '/mock/piwin', name: 'Set Conversation 默认模型', hoursAgo: 20, grok: true },
    { id: 'tree-oauth', projectPath: '/mock/piwin', name: 'Codex OAuth Mock 服务', hoursAgo: 23 },
    { id: 'tree-mcp', projectPath: '/mock/piwin', name: 'pi作者有说过不要mcp吗', hoursAgo: 30 },
    { id: 'tree-release', projectPath: '/mock/piwin-release', name: '发布前回归检查', hoursAgo: 70 },
    { id: 'tree-usage', projectPath: '/mock/proj', name: '用量统计分页修复', hoursAgo: 26 },
    { id: 'tree-subagent', projectPath: '/mock/proj', name: '子代理模型调用记录', hoursAgo: 40, grok: true },
  ];
  const now = Date.now();
  for (const session of sessions) {
    host.sessions.set(session.id, {
      projectPath: session.projectPath,
      scope: { kind: 'project', projectPath: session.projectPath },
      workingDirectory: session.projectPath,
      events: [],
      transcript: [],
      name: session.name,
      nameSource: 'user',
      updatedAt: new Date(now - session.hoursAgo * 3_600_000).toISOString(),
      ...(session.grok ? { backend: { agentId: 'grok' } } : {}),
    });
  }
}
