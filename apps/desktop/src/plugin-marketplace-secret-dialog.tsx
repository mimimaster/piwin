import { useState, type ReactElement } from 'react';
import { Button, Dialog, Field, PasswordInput } from '@piwin/ui-kit';
import type { PluginMarketplaceCard, PluginMarketplaceSecret } from './plugin-marketplace-catalog.js';

export type PluginMarketplaceSecretDialogProps = {
  card: PluginMarketplaceCard;
  isChinese: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (secrets: Record<string, string>) => void;
};

export function PluginMarketplaceSecretDialog(
  props: PluginMarketplaceSecretDialogProps,
): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const requiredReady = props.card.secrets
    .filter((secret) => secret.required)
    .every((secret) => (values[secret.name] ?? '').trim().length > 0);

  return (
    <Dialog
      open
      label={props.isChinese ? `配置 ${props.card.name}` : `Configure ${props.card.name}`}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onClose();
      }}
      closeOnInteractOutside={!props.busy}
      testId="plugin-market-secret-dialog"
    >
      <div className="plugin-market-secret-dialog">
        <h3>
          {props.isChinese ? `添加 ${props.card.name}` : `Add ${props.card.name}`}
        </h3>
        <p className="muted">
          {props.isChinese
            ? '先填你自己的密钥，装完不会自动替你授权。'
            : 'Provide your own credentials. Nothing is installed until you confirm.'}
        </p>
        {props.card.secrets.map((secret) => (
          <SecretField
            key={secret.name}
            secret={secret}
            isChinese={props.isChinese}
            value={values[secret.name] ?? ''}
            onChange={(value) =>
              setValues((current) => ({ ...current, [secret.name]: value }))
            }
          />
        ))}
        <div className="plugin-market-secret-actions">
          <Button variant="ghost" disabled={props.busy} onClick={props.onClose}>
            {props.isChinese ? '取消' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            disabled={props.busy || !requiredReady}
            onClick={() => props.onConfirm(values)}
            data-testid="plugin-market-secret-confirm"
          >
            {props.isChinese ? '添加' : 'Add'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SecretField(props: {
  secret: PluginMarketplaceSecret;
  isChinese: boolean;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const label = props.isChinese ? props.secret.displayNameZh : props.secret.displayNameEn;
  const description = props.isChinese ? props.secret.descriptionZh : props.secret.descriptionEn;
  return (
    <Field label={label} description={description} required={props.secret.required}>
      <PasswordInput
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        testId={`plugin-market-secret-${props.secret.name}`}
      />
    </Field>
  );
}
