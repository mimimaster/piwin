import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HostResponse,
  InstallSource,
  PiwinConfig,
  SkillSummary,
  SkillsInstallData,
  SkillsListData,
} from '@piwin/contracts';
import { WELL_KNOWN_SKILL_PATH_PRESETS } from '@piwin/contracts';

export type SkillsPanelProps = {
  projectPath: string | null;
  request: (command: {
    type: 'skills/list' | 'skills/set_enabled' | 'skills/install' | 'config/get' | 'config/set';
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
        setError('Local skill directory is required');
        return;
      }
      source = { kind: 'local', path };
    } else {
      const url = installGitUrl.trim();
      if (!url) {
        setError('Git URL is required');
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
    setInfo(`Installed ${data.skillId} → ${data.targetPath}`);
    setInstallPath('');
    setInstallGitUrl('');
    setInstallGitRef('');
    setInstallGitSubdir('');
    setInstallName('');
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
      setInfo(`Already mapped: ${pathValue}`);
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
    setInfo(`Mapped ${pathValue} (new sessions pick it up)`);
    await loadMappedPaths();
    await loadSkills();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>Skills</h3>
        <p className="muted">
          Enable/disable applies to <strong>new sessions</strong>. Install copies into
          ~/.piwin/skills.
        </p>
        <input
          className="text-input"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search skills…"
        />
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}
        <ul className="ext-list">
          {visible.length === 0 && !loading ? (
            <li className="muted">No skills found</li>
          ) : (
            visible.map((skill) => (
              <li key={skill.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{skill.name}</strong>
                    <span className="pill">{skill.source}</span>
                    <span className="pill">{skill.enabled ? 'on' : 'off'}</span>
                  </div>
                  <div className="muted ext-desc">{skill.description}</div>
                  <div className="muted ext-path">{skill.path}</div>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={busyId === skill.id}
                  onClick={() => void handleToggle(skill)}
                >
                  {skill.enabled ? 'Disable' : 'Enable'}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="settings-section">
          <h4>Map external skill roots</h4>
          <p className="muted">
            Adds paths to <code>config.skills.extraPaths</code> (Cursor / Claude / Codex).
          </p>
          <div className="provider-list" data-testid="skills-map-presets">
            {WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => {
              const mapped = mappedPaths.includes(preset.path);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className="btn"
                  style={{ marginRight: 8, marginBottom: 8 }}
                  disabled={mappingBusy || mapped}
                  data-testid={`skills-map-preset-${preset.id}`}
                  onClick={() => void handleMapPreset(preset.path)}
                >
                  {mapped ? `✓ ${preset.label}` : `Map ${preset.label}`}
                </button>
              );
            })}
          </div>
          {mappedPaths.length > 0 ? (
            <p className="muted">Mapped: {mappedPaths.join(', ')}</p>
          ) : null}
        </div>

        <div className="settings-section">
          <h4>Install skill</h4>
          <label className="field">
            Source
            <select
              value={installKind}
              onChange={(event) => setInstallKind(event.target.value as 'local' | 'git')}
            >
              <option value="local">Local directory (SKILL.md)</option>
              <option value="git">Git URL</option>
            </select>
          </label>
          {installKind === 'local' ? (
            <label className="field">
              Directory path
              <input
                value={installPath}
                onChange={(event) => setInstallPath(event.target.value)}
                placeholder="/path/to/my-skill"
              />
            </label>
          ) : (
            <>
              <label className="field">
                Git URL
                <input
                  value={installGitUrl}
                  onChange={(event) => setInstallGitUrl(event.target.value)}
                  placeholder="https://github.com/org/repo.git"
                />
              </label>
              <label className="field">
                Ref (optional)
                <input
                  value={installGitRef}
                  onChange={(event) => setInstallGitRef(event.target.value)}
                  placeholder="main"
                />
              </label>
              <label className="field">
                Subdir (optional)
                <input
                  value={installGitSubdir}
                  onChange={(event) => setInstallGitSubdir(event.target.value)}
                  placeholder="skills/my-skill"
                />
              </label>
            </>
          )}
          <label className="field">
            Name override (optional)
            <input
              value={installName}
              onChange={(event) => setInstallName(event.target.value)}
              placeholder="folder name under ~/.piwin/skills"
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={installing}
            onClick={() => void handleInstall()}
          >
            {installing ? 'Installing…' : 'Install'}
          </button>
        </div>

        <div className="manager-actions">
          <button type="button" className="btn" onClick={() => void loadSkills()}>
            Refresh
          </button>
          {props.variant !== 'inline' ? (
            <button type="button" className="btn" onClick={props.onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
