import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, PetRuntimeSnapshot, PetSummary } from '@piwin/contracts';

export type PetPanelProps = {
  request: (command: {
    type: 'pet/list' | 'pet/get-active' | 'pet/set-active' | 'pet/install-local' | 'pet/import-codex';
    petId?: string;
    sourcePath?: string;
  }) => Promise<HostResponse>;
  onActiveChanged: (pet: PetRuntimeSnapshot) => void;
  onClose?: () => void;
  variant?: 'inline' | 'modal';
};

export function PetPanel(props: PetPanelProps) {
  const [pets, setPets] = useState<PetSummary[]>([]);
  const [activeId, setActiveId] = useState('piwin-default');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [installPath, setInstallPath] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    const listed = await props.request({ type: 'pet/list' });
    if (!listed.success) {
      setError(listed.error);
      return;
    }
    const data = listed.data as { pets: PetSummary[]; activePetId: string };
    setPets(data.pets);
    setActiveId(data.activePetId);
  }, [props]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleActivate(petId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/set-active', petId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const pet = (response.data as { pet: PetRuntimeSnapshot }).pet;
    props.onActiveChanged(pet);
    setInfo(`Active pet: ${pet.displayName}`);
    await reload();
  }

  async function handleInstall(): Promise<void> {
    const sourcePath = installPath.trim();
    if (!sourcePath) {
      setError('Provide a local directory containing pet.json + spritesheet');
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/install-local', sourcePath });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { petId: string; path: string };
    setInfo(`Installed ${data.petId}`);
    setInstallPath('');
    await reload();
  }

  async function handleImportCodex(): Promise<void> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({ type: 'pet/import-codex' });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as {
      imported: string[];
      skipped: string[];
      errors: string[];
    };
    setInfo(
      `Imported ${data.imported.length}, skipped ${data.skipped.length}, errors ${data.errors.length}`,
    );
    if (data.errors.length > 0) {
      setError(data.errors.slice(0, 3).join('; '));
    }
    await reload();
  }

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <h3>Pets</h3>
        <p className="muted">
          Codex-compatible packages (pet.json + spritesheet). Stored under ~/.piwin/pets. Import from
          ~/.codex/pets is copy-only.
        </p>
        {error ? <div className="error-banner">{error}</div> : null}
        {info ? <p className="muted">{info}</p> : null}

        <ul className="ext-list">
          {pets.map((pet) => (
            <li key={pet.id} className="ext-list-item">
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{pet.displayName}</strong>
                  <span className="pill">{pet.source}</span>
                  {pet.active || pet.id === activeId ? (
                    <span className="pill ok">active</span>
                  ) : null}
                  {!pet.valid ? <span className="pill">invalid</span> : null}
                </div>
                <div className="muted ext-path">{pet.id}</div>
                {pet.issues.length > 0 ? (
                  <div className="muted">{pet.issues.join('; ')}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !pet.valid || pet.id === activeId}
                onClick={() => void handleActivate(pet.id)}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>

        <h4>Install local pet</h4>
        <input
          className="text-input"
          value={installPath}
          onChange={(event) => setInstallPath(event.target.value)}
          placeholder="Absolute path to pet directory (pet.json + spritesheet)"
        />
        <div className="row-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void handleInstall()}>
            Install
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void handleImportCodex()}
          >
            Import ~/.codex/pets
          </button>
        </div>

        <div className="manager-actions">
          <button type="button" className="btn" onClick={() => void reload()}>
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
