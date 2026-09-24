import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HostResponse,
  InstallSource,
  PiwinConfig,
  SkillSummary,
  SkillsInstallData,
  SkillsListData,
} from '@piwin/contracts';
import {
  canToggleSkill,
  canUninstallSkill,
  groupSkillsBySource,
  resourceSourceLabel,
  WELL_KNOWN_SKILL_PATH_PRESETS,
} from '@piwin/contracts';
import { catalogDescription } from './catalog-display-copy.js';
import { isRemoteCommandGapError } from './remote-command-gap.js';
import {
  Button,
  Collapse,
  Notice,
  SegmentedControl,
  Spinner,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import { CapabilityDiscoveryHint } from './settings/capability-discovery-hint';
import { skillInstalledEffectMessage } from './settings-effect-copy.js';
import { nextSkillsConfigForMapping } from './skill-path-mapping.js';
import { notifySkillsChanged } from './skills-changed.js';

export type SkillsPanelProps = {
  projectPath: string | null;
  request: (command: {
    type:
      | 'skills/list'
      | 'skills/set_enabled'
      | 'skills/install'
      | 'skills/uninstall'
      | 'config/get'
      | 'config/set';
    projectPath?: string;
    skillId?: string;
    enabled?: boolean;
    source?: InstallSource;
    name?: string;
    config?: PiwinConfig;
  }) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
  readOnly?: boolean;
};

export function SkillsPanel(props: SkillsPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [installKind, setInstallKind] = useState<'local' | 'git'>('local');
  const [installPath, setInstallPath] = useState('');
  const [installGitUrl, setInstallGitUrl] = useState('');
  const [installGitRef, setInstallGitRef] = useState('');
  const [installGitSubdir, setInstallGitSubdir] = useState('');
  const [installName, setInstallName] = useState('');
  const [installing, setInstalling] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [mappedPaths, setMappedPaths] = useState<string[]>([]);
  const [mappingBusy, setMappingBusy] = useState(false);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    const command: { type: 'skills/list'; projectPath?: string } = { type: 'skills/list' };
    if (props.projectPath) {
      command.projectPath = props.projectPath;
    }
    const response = await props.request(command);
    setLoading(false);
    if (!response.success) {
      if (!isRemoteCommandGapError(response.error)) {
        setError(response.error);
      }
      return;
    }
    const data = response.data as SkillsListData;
    setSkills(data.skills ?? []);
  }, [props]);

  const loadMappedPaths = useCallback(async () => {
    if (props.readOnly) {
      setMappedPaths([]);
      return;
    }
    const response = await props.request({ type: 'config/get' });
    if (!response.success) return;
    const data = response.data as { config: PiwinConfig };
    setMappedPaths(data.config.skills?.extraPaths ?? []);
  }, [props]);

  useEffect(() => {
    void loadSkills();
    void loadMappedPaths();
  }, [loadSkills, loadMappedPaths]);

  const visible = useMemo(() => {
    const listed = skills.filter((s) => s.hidden !== true || s.source === 'bundled');
    if (!filter) return listed;
    const lower = filter.toLowerCase();
    return listed.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower) ||
        s.description?.toLowerCase().includes(lower),
    );
  }, [skills, filter]);
  const grouped = useMemo(() => groupSkillsBySource(visible), [visible]);
  const sourceLocale = isChinese ? 'zh-CN' : 'en';

  async function handleToggle(skill: SkillSummary) {
    if (!canToggleSkill(skill.source)) {
      return;
    }
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'skills/set_enabled',
      skillId: skill.id,
      enabled: !skill.enabled,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(
      isChinese
        ? `已${skill.enabled ? '关闭' : '开启'}技能：${skill.name}`
        : `${skill.enabled ? 'Disabled' : 'Enabled'} skill: ${skill.name}`,
    );
    setSkills((prev) => prev.map((s) => (s.id === skill.id ? { ...s, enabled: !s.enabled } : s)));
    notifySkillsChanged();
  }

  async function handleUninstall(skill: SkillSummary) {
    if (!canUninstallSkill(skill.source)) {
      setError(isChinese ? '应用内置技能不能删除' : 'Bundled skills cannot be uninstalled');
      return;
    }
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'skills/uninstall',
      skillId: skill.id,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(
      isChinese ? `已删除技能：${skill.name}` : `Removed skill: ${skill.name}`,
    );
    setSkills((prev) => prev.filter((entry) => entry.id !== skill.id));
    notifySkillsChanged();
  }

  async function handleInstallLocal() {
    if (!installPath.trim()) return;
    setInstalling(true);
    setError(null);
    setInfo(null);
    const command = {
      type: 'skills/install' as const,
      source: { kind: 'local' as const, path: installPath.trim() },
      ...(installName.trim() ? { name: installName.trim() } : {}),
    };
    const response = await props.request(command);
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as SkillsInstallData;
    setInfo(skillInstalledEffectMessage(locale, data.skillId, data.targetPath));
    setInstallPath('');
    setInstallName('');
    notifySkillsChanged();
    void loadSkills();
  }

  async function handleInstallGit() {
    if (!installGitUrl.trim()) return;
    setInstalling(true);
    setError(null);
    setInfo(null);
    const source = {
      kind: 'git' as const,
      url: installGitUrl.trim(),
      ...(installGitRef.trim() ? { ref: installGitRef.trim() } : {}),
      ...(installGitSubdir.trim() ? { subdir: installGitSubdir.trim() } : {}),
    };
    const command = {
      type: 'skills/install' as const,
      source,
      ...(installName.trim() ? { name: installName.trim() } : {}),
    };

    const response = await props.request(command);
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as SkillsInstallData;
    setInfo(skillInstalledEffectMessage(locale, data.skillId, data.targetPath));
    setInstallGitUrl('');
    setInstallGitRef('');
    setInstallGitSubdir('');
    setInstallName('');
    notifySkillsChanged();
    void loadSkills();
  }

  /**
   * Map or unmap an external skill root. `config/set` goes through the
   * desktop adapter, which diffs the draft into a CAS-checked settings/apply.
   */
  async function handleSetMapping(path: string, mapped: boolean) {
    setMappingBusy(true);
    setError(null);
    try {
      const getResp = await props.request({ type: 'config/get' });
      if (!getResp.success) {
        setError(getResp.error);
        return;
      }
      const { config } = getResp.data as { config: PiwinConfig };
      const nextSkills = nextSkillsConfigForMapping(config.skills, path, mapped);
      if (nextSkills) {
        const setResp = await props.request({
          type: 'config/set',
          config: { ...config, skills: nextSkills },
        });
        if (!setResp.success) {
          setError(setResp.error);
          return;
        }
      }
      setInfo(
        mapped
          ? isChinese
            ? `已映射路径：${path}`
            : `Mapped path: ${path}`
          : isChinese
            ? `已取消映射：${path}`
            : `Unmapped path: ${path}`,
      );
      notifySkillsChanged();
      await loadMappedPaths();
      await loadSkills();
    } finally {
      setMappingBusy(false);
    }
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div
        className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}
      >
          <div className="mcp-tab-content">
            <CapabilityDiscoveryHint kind="skill" />
            <div style={{ marginBottom: 24 }}>
              <div className="settings-toolbar" style={{ marginBottom: 16 }}>
                <TextInput
                  toolbar
                  value={filter}
                  onChange={(event) => setFilter(event.currentTarget.value)}
                  placeholder={isChinese ? '搜索技能…' : 'Search skills…'}
                  data-testid="skills-filter"
                  aria-label={isChinese ? '搜索技能' : 'Search skills'}
                />
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => void loadSkills()}
                  data-testid="skills-refresh"
                >
                  {isChinese ? '刷新' : 'Refresh'}
                </Button>
              </div>

              {loading ? (
                <div style={{ padding: '32px 0', textAlign: 'center' }}>
                  <Spinner />
                </div>
              ) : visible.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                  <p className="muted" style={{ fontSize: '14px', margin: 0 }}>
                    {filter
                      ? isChinese
                        ? '没有匹配的技能'
                        : 'No matching skills'
                      : isChinese
                        ? '未安装任何技能'
                        : 'No skills installed'}
                  </p>
                </div>
              ) : (
                <div data-testid="skills-list">
                  {grouped.map((group) => (
                    <section
                      key={group.source}
                      className="ext-list-group"
                      data-testid={`skills-group-${group.source}`}
                    >
                      <h3 className="muted ext-list-group-title">
                        {resourceSourceLabel(group.source, sourceLocale)}
                      </h3>
                      <ul className="ext-list">
                        {group.skills.map((skill) => (
                          <li key={skill.id} className="ext-list-item">
                            <div className="ext-list-main">
                              <div className="ext-list-title">
                                <strong>{skill.name}</strong>
                                <span className="pill muted">
                                  {resourceSourceLabel(skill.source, sourceLocale)}
                                </span>
                                {canToggleSkill(skill.source) && skill.enabled ? (
                                  <span className="pill ok">{isChinese ? '已启用' : 'on'}</span>
                                ) : null}
                              </div>
                              <div className="muted ext-desc">
                                {catalogDescription(skill.id, skill.description, sourceLocale)}
                              </div>
                            </div>
                            {canUninstallSkill(skill.source) || canToggleSkill(skill.source) ? (
                              <div className="ext-list-actions">
                                {canUninstallSkill(skill.source) ? (
                                  <Button
                                    size="compact"
                                    variant="ghost"
                                    disabled={props.readOnly}
                                    onClick={() => void handleUninstall(skill)}
                                    data-testid={`skill-uninstall-${skill.id}`}
                                  >
                                    {isChinese ? '删除' : 'Remove'}
                                  </Button>
                                ) : null}
                                {canToggleSkill(skill.source) ? (
                                  <Switch
                                    checked={skill.enabled}
                                    disabled={props.readOnly}
                                    onCheckedChange={() => void handleToggle(skill)}
                                    aria-label={isChinese ? `启用 ${skill.name}` : `Enable ${skill.name}`}
                                    testId={`skill-toggle-${skill.id}`}
                                  />
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}

              {error || info ? (
                <div className="ui-feedback-host" aria-live="polite" style={{ marginTop: 16 }}>
                  {error ? <Notice tone="error">{error}</Notice> : null}
                  {info ? <Notice tone="info">{info}</Notice> : null}
                </div>
              ) : null}
            </div>

            <div
              className="settings-section"
              style={{ paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}
            >
              <PageTitle
                title={isChinese ? '映射外部路径' : 'Map External Paths'}
                description={
                  isChinese
                    ? '从 Cursor 或 Claude 映射已有的技能根目录。'
                    : 'Map skill roots from Cursor or Claude.'
                }
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => {
                  const mapped = mappedPaths.includes(preset.path);
                  return (
                    <Button
                      key={preset.id}
                      size="compact"
                      variant={mapped ? 'ghost' : 'secondary'}
                      disabled={mappingBusy || props.readOnly}
                      onClick={() => void handleSetMapping(preset.path, !mapped)}
                      title={preset.path}
                      data-testid={`skill-map-${preset.id}`}
                    >
                      {mapped
                        ? isChinese
                          ? `✓ ${preset.label}（点击取消）`
                          : `✓ ${preset.label} (click to unmap)`
                        : isChinese
                          ? `映射 ${preset.label}`
                          : `Map ${preset.label}`}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div
              className="settings-section"
              style={{ paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}
            >
              <button
                type="button"
                className="settings-collapsible-trigger"
                disabled={props.readOnly}
                onClick={() => setInstallOpen((v) => !v)}
                aria-expanded={installOpen}
                data-testid="skills-install-toggle"
              >
                <div className="settings-card-heading" style={{ marginBottom: 0 }}>
                  <div>
                    <h4>{isChinese ? '手动安装' : 'Install Manually'}</h4>
                    <p>
                      {isChinese
                        ? '通过本地目录或 Git 仓库安装。'
                        : 'Install via local directory or Git.'}
                    </p>
                  </div>
                </div>
                <svg
                  className={`settings-collapsible-chevron ${installOpen ? 'open' : ''}`}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <Collapse expanded={installOpen} testId="skills-install-collapse">
                <div
                  className="settings-toolbar settings-toolbar--install"
                  style={{ marginTop: 16 }}
                >
                  <SegmentedControl
                    value={installKind}
                    onChange={(value) => setInstallKind(value as 'local' | 'git')}
                    data={[
                      { value: 'local', label: isChinese ? '本地' : 'Local' },
                      { value: 'git', label: 'Git' },
                    ]}
                    className="settings-install-kind"
                  />
                  <TextInput
                    toolbar
                    value={installKind === 'local' ? installPath : installGitUrl}
                    onChange={(event) =>
                      installKind === 'local'
                        ? setInstallPath(event.currentTarget.value)
                        : setInstallGitUrl(event.currentTarget.value)
                    }
                    placeholder={
                      installKind === 'local'
                        ? isChinese
                          ? '本地路径…'
                          : 'Local path…'
                        : 'https://github.com/…'
                    }
                    aria-label={
                      installKind === 'local' ? (isChinese ? '本地路径' : 'Local Path') : 'Git URL'
                    }
                    data-testid="skills-install-source"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        installKind === 'local' ? handleInstallLocal() : handleInstallGit();
                      }
                    }}
                  />
                  <Button
                    disabled={
                      installing ||
                      props.readOnly ||
                      (installKind === 'local' ? !installPath : !installGitUrl)
                    }
                    onClick={() =>
                      installKind === 'local' ? handleInstallLocal() : handleInstallGit()
                    }
                    data-testid="skills-install-submit"
                  >
                    {isChinese ? '安装' : 'Install'}
                  </Button>
                </div>
              </Collapse>
            </div>
          </div>
      </div>
    </div>
  );
}
