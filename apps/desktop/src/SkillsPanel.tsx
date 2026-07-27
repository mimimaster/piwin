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
import { Button, EmptyState, Field, Notice, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

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
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
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
  const [storeFilter, setStoreFilter] = useState('');

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
    const query = filter.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.source.toLowerCase().includes(query),
    );
  }, [filter, skills]);

  async function handleToggle(skill: SkillSummary): Promise<void> {
    setBusyId(skill.id);
    const response = await props.request({
      type: 'skills/set_enabled',
      skillId: skill.id,
      enabled: !skill.enabled,
    });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await loadSkills();
  }

  async function handleInstall(): Promise<void> {
    setError(null);
    setInfo(null);
    let source: InstallSource;
    if (installKind === 'local') {
      const path = installPath.trim();
      if (!path) {
        setError(isChinese ? '必须填写本地技能目录。' : 'Local skill directory is required.');
        return;
      }
      source = { kind: 'local', path };
    } else {
      const url = installGitUrl.trim();
      if (!url) {
        setError(isChinese ? '必须填写 Git URL。' : 'Git URL is required.');
        return;
      }
      source = { kind: 'git', url };
      if (installGitRef.trim()) {
        source = { ...source, ref: installGitRef.trim() };
      }
      if (installGitSubdir.trim()) {
        source = { ...source, subdir: installGitSubdir.trim() };
      }
    }
    setInstalling(true);
    const command: {
      type: 'skills/install';
      source: InstallSource;
      name?: string;
    } = { type: 'skills/install', source };
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
    setInfo(
      isChinese
        ? `已安装 ${data.skillId} → ${data.targetPath}`
        : `Installed ${data.skillId} → ${data.targetPath}`,
    );
    setInstallPath('');
    setInstallGitUrl('');
    setInstallGitRef('');
    setInstallGitSubdir('');
    setInstallName('');
    await loadSkills();
  }

  async function handleInstallStore(entry: SkillStoreEntry): Promise<void> {
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
    const data = response.data as SkillsInstallData;
    setInfo(
      isChinese
        ? `已从商店安装 ${data.skillId} → ${data.targetPath}`
        : `Installed ${data.skillId} from store → ${data.targetPath}`,
    );
    setMainTab('installed');
    await loadSkills();
  }

  async function handleMapPreset(pathValue: string): Promise<void> {
    setMappingBusy(true);
    setError(null);
    setInfo(null);
    const getResponse = await props.request({ type: 'config/get' });
    if (!getResponse.success) {
      setMappingBusy(false);
      setError(getResponse.error);
      return;
    }
    const data = getResponse.data as { config: PiwinConfig };
    const existing = data.config.skills?.extraPaths ?? [];
    if (existing.includes(pathValue)) {
      setInfo(isChinese ? `已映射：${pathValue}` : `Already mapped: ${pathValue}`);
      setMappingBusy(false);
      return;
    }
    const next: PiwinConfig = {
      ...data.config,
      skills: {
        extraPaths: [...existing, pathValue],
        disabledIds: data.config.skills?.disabledIds ?? [],
      },
    };
    const saveResponse = await props.request({ type: 'config/set', config: next });
    setMappingBusy(false);
    if (!saveResponse.success) {
      setError(saveResponse.error);
      return;
    }
    setInfo(
      isChinese
        ? `已映射 ${pathValue}（新会话将加载此路径）`
        : `Mapped ${pathValue} (new sessions pick it up)`,
    );
    await loadMappedPaths();
    await loadSkills();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>{isChinese ? '技能' : 'Skills'}</h3>
        <p className="muted">
          {isChinese ? (
            <>
              启用或停用只会影响<strong>新会话</strong>。安装会复制到 ~/.piwin/skills。商店列出推荐的 Git 来源。
            </>
          ) : (
            <>
              Enable/disable applies to <strong>new sessions</strong>. Install copies into
              ~/.piwin/skills. Store lists recommended sources (git).
            </>
          )}
        </p>
        <Tabs
          value={mainTab}
          onValueChange={(value) => setMainTab(value as 'installed' | 'store')}
          testId="skills-main-tabs"
        >
          <TabsList className="mcp-tabs" label={isChinese ? '技能视图' : 'Skills views'}>
            <TabsTrigger value="installed" className="mcp-tab" testId="skills-tab-installed">
              {isChinese ? '已安装' : 'Installed'}
            </TabsTrigger>
            <TabsTrigger value="store" className="mcp-tab" testId="skills-tab-store">
              {isChinese ? '商店' : 'Store'}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="installed" className="mcp-tab-content">
        <Field label={isChinese ? '搜索已安装的技能' : 'Search installed skills'}>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={isChinese ? '名称、ID 或描述…' : 'Name, id, or description…'}
            data-testid="skills-filter"
          />
        </Field>
        {loading ? <div className="panel-loading"><Spinner label={isChinese ? '正在加载技能' : 'Loading skills'} /><span className="muted">{isChinese ? '正在加载技能…' : 'Loading skills…'}</span></div> : null}
        {error ? <Notice tone="error" title={isChinese ? '技能操作失败' : 'Skills action failed'}>{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}
        <ul className="ext-list">
          {visible.length === 0 && !loading ? (
            <li className="skills-empty-wrap"><EmptyState title={isChinese ? '未找到技能' : 'No skills found'} description={isChinese ? '请从商店安装，或确认已安装随附的技能。' : 'Install from Store or ensure bundled skills are installed.'} testId="skills-empty" /></li>
          ) : (
            visible.map((skill) => (
              <li key={skill.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{skill.name}</strong>
                    <span className="pill">{skill.source}</span>
                    <span className="pill">{skill.enabled ? (isChinese ? '开启' : 'on') : (isChinese ? '关闭' : 'off')}</span>
                  </div>
                  <div className="muted ext-desc">{skill.description}</div>
                  <div className="muted ext-path">{skill.path}</div>
                </div>
                <Button
                  disabled={busyId === skill.id}
                  onClick={() => void handleToggle(skill)}
                >
                  {skill.enabled ? common.disable : common.enable}
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="settings-section">
          <h4>{isChinese ? '映射外部技能根目录' : 'Map external skill roots'}</h4>
          <p className="muted">
            {isChinese ? '将路径添加到 ' : 'Adds paths to '}
            <code>config.skills.extraPaths</code> (Cursor / Claude / Codex).
          </p>
          <div className="provider-list" data-testid="skills-map-presets">
            {WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => {
              const mapped = mappedPaths.includes(preset.path);
              return (
                <Button
                  key={preset.id}
                  style={{ marginRight: 8, marginBottom: 8 }}
                  disabled={mappingBusy || mapped}
                  data-testid={`skills-map-preset-${preset.id}`}
                  onClick={() => void handleMapPreset(preset.path)}
                >
                  {mapped ? `✓ ${preset.label}` : isChinese ? `映射 ${preset.label}` : `Map ${preset.label}`}
                </Button>
              );
            })}
          </div>
          {mappedPaths.length > 0 ? (
            <p className="muted">{isChinese ? '已映射：' : 'Mapped: '}{mappedPaths.join(', ')}</p>
          ) : null}
        </div>

        <div className="settings-section">
          <h4>{isChinese ? '安装技能' : 'Install skill'}</h4>
          <Field label={isChinese ? '来源' : 'Source'}>
            <select
              value={installKind}
              onChange={(event) => setInstallKind(event.target.value as 'local' | 'git')}
            >
              <option value="local">{isChinese ? '本地目录 (SKILL.md)' : 'Local directory (SKILL.md)'}</option>
              <option value="git">Git URL</option>
            </select>
          </Field>
          {installKind === 'local' ? (
            <Field label={isChinese ? '目录路径' : 'Directory path'} required>
              <input
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
                placeholder="/path/to/my-skill"
              />
            </Field>
          ) : (
            <>
              <Field label="Git URL" required>
                <input
                  value={installGitUrl}
                  onChange={(event) => setInstallGitUrl(event.target.value)}
                  placeholder="https://github.com/org/repo.git"
                />
              </Field>
              <Field label={isChinese ? '引用（可选）' : 'Ref (optional)'}>
                <input
                  value={installGitRef}
                  onChange={(event) => setInstallGitRef(event.target.value)}
                  placeholder="main"
                />
              </Field>
              <Field label={isChinese ? '子目录（可选）' : 'Subdir (optional)'}>
                <input
                  value={installGitSubdir}
                  onChange={(event) => setInstallGitSubdir(event.target.value)}
                  placeholder="skills/my-skill"
                />
              </Field>
            </>
          )}
          <Field label={isChinese ? '名称覆盖（可选）' : 'Name override (optional)'}>
            <input
              value={installName}
              onChange={(event) => setInstallName(event.target.value)}
              placeholder={isChinese ? '~/.piwin/skills 下的文件夹名称' : 'folder name under ~/.piwin/skills'}
            />
          </Field>
          <Button
            variant="primary"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? (isChinese ? '正在安装…' : 'Installing…') : common.install}
          </Button>
        </div>

        <div className="manager-actions">
          <Button onClick={() => void loadSkills()}>
            {common.refresh}
          </Button>
          {props.variant !== 'inline' ? (
            <Button onClick={props.onClose}>
              {common.close}
            </Button>
          ) : null}
        </div>

          </TabsContent>
          <TabsContent value="store" className="mcp-tab-content" testId="skills-store-panel">
            <Field label={isChinese ? '搜索技能商店' : 'Search skill store'}>
              <input
                value={storeFilter}
                onChange={(event) => setStoreFilter(event.target.value)}
                placeholder={isChinese ? '名称、ID 或描述…' : 'Name, id, or description…'}
                data-testid="skills-store-search"
              />
            </Field>
            {storeLoading ? <p className="muted">{isChinese ? '正在加载商店…' : 'Loading store…'}</p> : null}
            <ul className="ext-list" data-testid="skills-store-list">
              {storeEntries
                .filter((entry) => {
                  const q = storeFilter.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    entry.name.toLowerCase().includes(q) ||
                    entry.id.toLowerCase().includes(q) ||
                    entry.description.toLowerCase().includes(q)
                  );
                })
                .map((entry) => (
                  <li key={entry.id} className="ext-list-item" data-testid="skills-store-item">
                    <div className="ext-list-main">
                      <div className="ext-list-title">
                        <strong>{entry.name}</strong>
                        <span className="pill">{entry.source.kind}</span>
                      </div>
                      <div className="muted ext-desc">{entry.description}</div>
                    </div>
                    <Button
                      variant="primary"
                      disabled={installing}
                      data-testid="skills-store-install-btn"
                      onClick={() => void handleInstallStore(entry)}
                    >
                      {common.install}
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
