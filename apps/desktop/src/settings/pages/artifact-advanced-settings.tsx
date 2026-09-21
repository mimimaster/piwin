/**
 * Artifact security + size limits (the Artifact page's "Advanced" disclosure).
 *
 * Extracted so `ArtifactPage` stays under the 400-line review threshold.
 * Presentational: `ArtifactPage` owns the draft and the save flow.
 */
import type { ReactElement } from 'react';
import { NumberInput, Switch } from '@piwin/ui-kit';
import { FieldRow } from '../field-row';

export type ArtifactAdvancedSettingsProps = {
  isZh: boolean;
  blockExternalScripts: boolean;
  blockExternalResources: boolean;
  maxBytes: number;
  onBlockExternalScriptsChange: (value: boolean) => void;
  onBlockExternalResourcesChange: (value: boolean) => void;
  onMaxBytesChange: (value: number) => void;
};

export function ArtifactAdvancedSettings(props: ArtifactAdvancedSettingsProps): ReactElement {
  return (
    <details style={{ marginTop: 8 }} data-testid="artifact-advanced-section">
      <summary style={{ cursor: 'pointer', fontSize: '0.85em', opacity: 0.7 }}>
        {props.isZh ? '高级设置' : 'Advanced'}
      </summary>
      <div style={{ marginTop: 8 }}>
        <FieldRow
          label={props.isZh ? '拦截外部脚本' : 'Block external scripts'}
          description={
            props.isZh
              ? '拦截带外部 src 的 script。关闭后仍受沙箱 CSP 约束。'
              : 'Block <script src> to other origins. Off still keeps the sandbox CSP.'
          }
          testId="artifact-block-scripts-row"
        >
          <Switch
            checked={props.blockExternalScripts}
            onCheckedChange={(checked) => props.onBlockExternalScriptsChange(checked)}
            aria-label={props.isZh ? '拦截外部脚本' : 'Block external scripts'}
            testId="artifact-block-scripts-switch"
          />
        </FieldRow>
        <FieldRow
          label={props.isZh ? '拦截外部资源' : 'Block external resources'}
          description={
            props.isZh
              ? '拦截图片、样式、媒体等外链。默认开启。关闭后仅按「拦截外部脚本」处理脚本。'
              : 'Block images, styles, and other remote URLs. Default on. When off, scripts still follow the script switch.'
          }
          testId="artifact-block-resources-row"
        >
          <Switch
            checked={props.blockExternalResources}
            onCheckedChange={(checked) => props.onBlockExternalResourcesChange(checked)}
            aria-label={props.isZh ? '拦截外部资源' : 'Block external resources'}
            testId="artifact-block-resources-switch"
          />
        </FieldRow>
        <FieldRow
          label={props.isZh ? '最大 Artifact 大小' : 'Max artifact size'}
          description={
            props.isZh
              ? 'Artifact 评估的安全字节上限（字节）。'
              : 'Security byte cap for artifact evaluation (in bytes).'
          }
          testId="artifact-max-bytes-row"
        >
          <NumberInput
            testId="artifact-max-bytes-input"
            aria-label={props.isZh ? '最大 Artifact 大小' : 'Max artifact size'}
            w={140}
            min={1024}
            step={1024}
            value={props.maxBytes}
            onChange={(value) => {
              if (typeof value === 'number' && value > 0) {
                props.onMaxBytesChange(value);
              }
            }}
          />
        </FieldRow>
      </div>
    </details>
  );
}
