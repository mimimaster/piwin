import type { PetLocalImportPreview } from '@piwin/contracts';
import { Button, FieldCheckbox, TextInput } from '@piwin/ui-kit';
import { PageTitle } from './settings/page-title';

export type PetLocalImportSectionProps = {
  isChinese: boolean;
  installPath: string;
  preview: PetLocalImportPreview | null;
  selectedPaths: string[];
  busy: boolean;
  onPathChange: (sourcePath: string) => void;
  onScan: () => void;
  onInstallDirect: () => void;
  onTogglePath: (sourcePath: string, checked: boolean) => void;
  onToggleAll: () => void;
  onInstallBatch: () => void;
};

export function PetLocalImportSection(props: PetLocalImportSectionProps) {
  const importableCandidates =
    props.preview?.candidates.filter((candidate) => candidate.valid) ?? [];
  const allImportableSelected =
    importableCandidates.length > 0 &&
    importableCandidates.every((candidate) => props.selectedPaths.includes(candidate.sourcePath));

  return (
    <div className="settings-section">
      <PageTitle
        title={props.isChinese ? '导入本地伙伴' : 'Import Local Companions'}
        description={
          props.isChinese
            ? '输入单个资源包路径可直接安装；输入包含多个资源包的目录后先扫描，再选择一个或多个导入。'
            : 'Install one package directly, or scan a directory and choose one or more packages to import.'
        }
      />
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <TextInput
            value={props.installPath}
            disabled={props.busy}
            onChange={(event) => props.onPathChange(event.target.value)}
            placeholder={
              props.isChinese
                ? '~/.codex/pets 或具体宠物包目录...'
                : '~/.codex/pets or a specific package directory...'
            }
            aria-label={props.isChinese ? '本地伙伴路径' : 'Local companion path'}
          />
        </div>
        <Button
          variant="ghost"
          disabled={props.busy || !props.installPath.trim()}
          onClick={props.onScan}
          data-testid="pet-local-scan"
        >
          {props.isChinese ? '扫描' : 'Scan'}
        </Button>
        <Button
          disabled={props.busy || !props.installPath.trim()}
          onClick={props.onInstallDirect}
          data-testid="pet-local-install"
        >
          {props.isChinese ? '直接安装' : 'Install Directly'}
        </Button>
      </div>
      {props.preview ? (
        <div
          data-testid="pet-local-preview"
          style={{
            marginTop: '14px',
            padding: '12px',
            border: '1px solid var(--line-soft)',
            borderRadius: '8px',
            background: 'var(--surface-inset)',
          }}
        >
          {props.preview.candidates.length > 0 ? (
            <>
              <FieldCheckbox
                label={
                  props.isChinese
                    ? `全选可导入伙伴（已选 ${props.selectedPaths.length} 个）`
                    : `Select all importable companions (${props.selectedPaths.length} selected)`
                }
                checked={allImportableSelected}
                disabled={props.busy || importableCandidates.length === 0}
                onCheckedChange={props.onToggleAll}
                testId="pet-local-select-all"
              />
              <ul className="ext-list" style={{ marginTop: '8px', marginBottom: 0 }}>
                {props.preview.candidates.map((candidate) => (
                  <li key={candidate.sourcePath} className="ext-list-item">
                    <FieldCheckbox
                      label={`${candidate.displayName}${candidate.petId ? ` · ${candidate.petId}` : ''}`}
                      description={
                        candidate.valid
                          ? candidate.sourcePath
                          : `${candidate.issues.join('; ')} · ${candidate.sourcePath}`
                      }
                      checked={
                        candidate.valid && props.selectedPaths.includes(candidate.sourcePath)
                      }
                      disabled={props.busy || !candidate.valid}
                      onCheckedChange={(checked) =>
                        props.onTogglePath(candidate.sourcePath, checked)
                      }
                      inputAriaLabel={candidate.displayName}
                      testId="pet-local-candidate"
                    />
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                <Button
                  disabled={props.busy || props.selectedPaths.length === 0}
                  onClick={props.onInstallBatch}
                  data-testid="pet-local-batch-install"
                >
                  {props.isChinese
                    ? `导入选中的 ${props.selectedPaths.length} 个`
                    : `Import ${props.selectedPaths.length} selected`}
                </Button>
              </div>
            </>
          ) : (
            <div className="muted">
              {props.isChinese
                ? '该目录下没有可供选择的伙伴资源包。'
                : 'No companion packages were found in this directory.'}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
