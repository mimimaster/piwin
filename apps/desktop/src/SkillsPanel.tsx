import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HostResponse,
  InstallSource,
  PiwinConfig,
  SkillSummary,
  SkillsInstallData,
  SkillsListData,
  SkillStoreEntry,
} from '@piwin/contracts';
import { WELL_KNOWN_SKILL_PATH_PRESETS } from '@piwin/contracts';
import { Button, EmptyState, Field, Notice, SegmentedControl, Spinner, Switch, Tabs, TabsContent, TabsList, TabsTrigger, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

export type SkillsPanelProps = {
  projectPath: string | null;
  request: (command: {
    type:
      | 'skills/list'
      | 'skills/set_enabled'
      | 'skills/install'
      | 'skills/store-list'
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
  const [mappedPaths, setMappedPaths] = useState<string[]>([]);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [mainTab, setMainTab] = useState<'installed' | 'store'>('installed');
  const [storeEntries, setStoreEntries] = useState<SkillStoreEntry[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);

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
      setError(response.error);
      return;
    }
    const data = response.data as SkillsListData;
    setSkills(data.skills ?? []);
  }, [props]);

  const loadStore = useCallback(async () => {
    setStoreLoading(true);
    setError(null);
    const response = await props.request({ type: 'skills/store-list' });
    setStoreLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { entries?: SkillStoreEntry[] };
    setStoreEntries(data.entries ?? []);
  }, [props]);

  const loadMappedPaths = useCallback(async () => {
    const response = await props.request({ type: 'config/get' });
    if (!response.success) return;
    const data = response.data as { config: PiwinConfig };
    setMappedPaths(data.config.skills?.extraPaths ?? []);
  }, [props]);

  useEffect(() => {
    void loadSkills();
    void loadMappedPaths();
  }, [loadSkills, loadMappedPaths]);

  useEffect(() => {
    if (mainTab === 'store') {
      void loadStore();
    }
  }, [mainTab, loadStore]);

  const visible = useMemo(() => {
    if (!filter) return skills;
    const lower = filter.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower) ||
        s.description?.toLowerCase().includes(lower),
    );
  }, [skills, filter]);

  async function handleToggle(skill: SkillSummary) {
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
    setInfo(isChinese ? `已${skill.enabled ? '关闭' : '开启'}技能：${skill.name}` : `${skill.enabled ? 'Disabled' : 'Enabled'} skill: ${skill.name}`);
    void loadSkills();
  }

  async function handleInstallLocal() {
    if (!installPath.trim()) return;
    setInstalling(true);
    setError(null);
    setInfo(null);
    const command: any = {
      type: 'skills/install',
      source: { kind: 'local', path: installPath.trim() },
    };
    if (installName.trim()) {
      command.name = installName.trim();
    }
    const response = await props.request(command);
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as SkillsInstallData;
    setInfo(isChinese ? `已安装技能到：${data.targetPath}` : `Installed skill to: ${data.targetPath}`);
    setInstallPath('');
    setInstallName('');
    void loadSkills();
  }

  async function handleInstallGit() {
    if (!installGitUrl.trim()) return;
    setInstalling(true);
    setError(null);
    setInfo(null);
    const source: any = {
      kind: 'git',
      url: installGitUrl.trim(),
    };
    if (installGitRef.trim()) source.ref = installGitRef.trim();
    if (installGitSubdir.trim()) source.subdir = installGitSubdir.trim();

    const command: any = {
      type: 'skills/install',
      source,
    };
    if (installName.trim()) {
      command.name = installName.trim();
    }

    const response = await props.request(command);
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as SkillsInstallData;
    setInfo(isChinese ? `已从 Git 安装技能到：${data.targetPath}` : `Installed skill from Git to: ${data.targetPath}`);
    setInstallGitUrl('');
    setInstallGitRef('');
    setInstallGitSubdir('');
    setInstallName('');
    void loadSkills();
  }

  async function handleInstallStore(entry: SkillStoreEntry) {
    setInstalling(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'skills/install',
      source: entry.source,
      name: entry.name,
    });
    setInstalling(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已安装：${entry.name}` : `Installed: ${entry.name}`);
    setMainTab('installed');
    void loadSkills();
  }

  async function handleMapPreset(path: string) {
    setMappingBusy(true);
    setError(null);
    const getResp = await props.request({ type: 'config/get' });
    if (!getResp.success) {
      setMappingBusy(false);
      setError(getResp.error);
      return;
    }
    const data = getResp.data as { config: PiwinConfig };
    const config = data.config;
    const extraPaths = config.skills?.extraPaths ?? [];
    if (extraPaths.includes(path)) {
      setMappingBusy(false);
      return;
    }
    const nextConfig: PiwinConfig = {
      ...config,
      skills: {
        extraPaths: [...extraPaths, path],
        disabledIds: config.skills?.disabledIds ?? [],
      },
    };
    const setResp = await props.request({ type: 'config/set', config: nextConfig });
    setMappingBusy(false);
    if (!setResp.success) {
      setError(setResp.error);
      return;
    }
    setInfo(isChinese ? `已映射路径：${path}` : `Mapped path: ${path}`);
    void loadMappedPaths();
    void loadSkills();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <Tabs
          value={mainTab}
          onValueChange={(value) => setMainTab(value as 'installed' | 'store')}
          testId="skills-main-tabs"
        >
          <TabsList className="segmented-control">
            <TabsTrigger value="installed" className="segmented-control-item" testId="skills-tab-installed">
              {isChinese ? '已安装' : 'Installed'}
            </TabsTrigger>
            <TabsTrigger value="store" className="segmented-control-item" testId="skills-tab-store">
              {isChinese ? '商店' : 'Store'}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="installed" className="mcp-tab-content">
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: 20 }}>
                <div style={{ flex: 1 }}>
                  <Field label={isChinese ? '搜索技能' : 'Search skills'}>
                    <TextInput
                      value={filter}
                      onChange={(event) => setFilter(event.currentTarget.value)}
                      placeholder={isChinese ? '名称、ID 或描述…' : 'Search...'}
                      data-testid="skills-filter"
                    />
                  </Field>
                </div>
                <Button size="compact" onClick={() => void loadSkills()}>{isChinese ? '刷新' : 'Refresh'}</Button>
              </div>

              {loading && <div style={{ padding: '20px 0', textAlign: 'center' }}><Spinner /></div>}
              {error ? <Notice tone="error">{error}</Notice> : null}
              {info ? <Notice tone="info">{info}</Notice> : null}

              <ul className="ext-list">
                {visible.length === 0 && !loading ? (
                  <li className="muted" style={{ textAlign: 'center', padding: '40px' }}>
                    <EmptyState title={isChinese ? '未找到技能' : 'No skills found'} description="" />
                  </li>
                ) : (
                  visible.map((skill) => (
                    <li key={skill.id} className="ext-list-item">
                      <div className="ext-list-main">
                        <div className="ext-list-title">
                          <strong>{skill.name}</strong>
                          <span className="pill" style={{ opacity: 0.6 }}>{skill.source}</span>
                        </div>
                        <div className="muted ext-desc">{skill.description}</div>
                      </div>
                      <Switch
                        checked={skill.enabled}
                        onChange={() => void handleToggle(skill)}
                        aria-label={isChinese ? `启用 ${skill.name}` : `Enable ${skill.name}`}
                      />
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="settings-section">
              <PageTitle
                title={isChinese ? '映射外部路径' : 'Map External Paths'}
                description={isChinese ? '从 Cursor 或 Claude 映射已有的技能根目录。' : 'Map skill roots from Cursor or Claude.'}
              />
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => {
                  const mapped = mappedPaths.includes(preset.path);
                  return (
                    <Button
                      key={preset.id}
                      size="compact"
                      disabled={mappingBusy || mapped}
                      onClick={() => void handleMapPreset(preset.path)}
                    >
                      {mapped ? `✓ ${preset.label}` : isChinese ? `映射 ${preset.label}` : `Map ${preset.label}`}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="settings-section">
              <PageTitle
                title={isChinese ? '手动安装' : 'Install Manually'}
                description={isChinese ? '通过本地目录或 Git 仓库安装。' : 'Install via local directory or Git.'}
              />
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ flex: 0, minWidth: '140px' }}>
                  <SegmentedControl
                    value={installKind}
                    onChange={(value) => setInstallKind(value as 'local' | 'git')}
                    data={[
                      { value: 'local', label: isChinese ? '本地' : 'Local' },
                      { value: 'git', label: 'Git' },
                    ]}
                    fullWidth
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <Field label={installKind === 'local' ? (isChinese ? '本地路径' : 'Local Path') : 'Git URL'}>
                    <TextInput
                      value={installKind === 'local' ? installPath : installGitUrl}
                      onChange={(event) => installKind === 'local' ? setInstallPath(event.currentTarget.value) : setInstallGitUrl(event.currentTarget.value)}
                      placeholder={installKind === 'local' ? (isChinese ? '路径...' : 'Path...') : 'https://github.com/...'}
                    />
                  </Field>
                </div>
                <Button
                  disabled={installing || (installKind === 'local' ? !installPath : !installGitUrl)}
                  onClick={() => installKind === 'local' ? handleInstallLocal() : handleInstallGit()}
                >
                  {isChinese ? '安装' : 'Install'}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="store" className="mcp-tab-content">
            <div className="mcp-marketplace-header">
              <PageTitle
                title={isChinese ? '技能商店' : 'Skills Store'}
                description={isChinese ? '浏览社区推荐的技能集。' : 'Browse recommended skills from the community.'}
              />
            </div>
            {storeLoading && <div style={{ padding: '40px', textAlign: 'center' }}><Spinner /></div>}
            <ul className="ext-list">
              {storeEntries.map((entry) => (
                <li key={entry.id} className="ext-list-item">
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{entry.name}</strong>
                    </div>
                    <div className="muted ext-desc">{entry.description}</div>
                  </div>
                  <Button
                    variant="primary"
                    size="compact"
                    disabled={installing}
                    onClick={() => void handleInstallStore(entry)}
                  >
                    {isChinese ? '安装' : 'Install'}
                  </Button>
                </li>
              ))}
            </ul>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
