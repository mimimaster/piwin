import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, StatusBadge, Switch } from '@piwin/ui-kit';
import {
  readAttentionPreferences,
  subscribeAttentionPreferences,
  writeAttentionPreferences,
} from '../../attention-preferences';
import {
  createDesktopAttentionOs,
  type AttentionAuthorization,
  type AttentionOsCapabilities,
  type DesktopAttentionOs,
} from '../../desktop-attention-os';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useConfirmDialog } from '../../use-confirm-dialog';
import { FieldRow } from '../field-row';
import { getNotificationsCopy, type NotificationsCopy } from '../notifications-copy';
import { PageTitle } from '../page-title';
import type { AttentionPreferences } from '@piwin/host-client';

export type NotificationsPageProps = {
  os?: DesktopAttentionOs;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};

type PreferenceField = {
  key: keyof AttentionPreferences;
  label: string;
  description: string;
  testId: string;
};

function preferenceFields(copy: NotificationsCopy): PreferenceField[] {
  return [
    {
      key: 'enabled',
      label: copy.enabledLabel,
      description: copy.enabledDescription,
      testId: 'attention-pref-enabled',
    },
    {
      key: 'onNeedsInput',
      label: copy.onNeedsInputLabel,
      description: copy.onNeedsInputDescription,
      testId: 'attention-pref-onNeedsInput',
    },
    {
      key: 'onComplete',
      label: copy.onCompleteLabel,
      description: copy.onCompleteDescription,
      testId: 'attention-pref-onComplete',
    },
    {
      key: 'onFailure',
      label: copy.onFailureLabel,
      description: copy.onFailureDescription,
      testId: 'attention-pref-onFailure',
    },
    {
      key: 'foregroundToast',
      label: copy.foregroundToastLabel,
      description: copy.foregroundToastDescription,
      testId: 'attention-pref-foregroundToast',
    },
    {
      key: 'badge',
      label: copy.badgeLabel,
      description: copy.badgeDescription,
      testId: 'attention-pref-badge',
    },
    {
      key: 'sound',
      label: copy.soundLabel,
      description: copy.soundDescription,
      testId: 'attention-pref-sound',
    },
    {
      key: 'bounceOnNeedsInput',
      label: copy.bounceOnNeedsInputLabel,
      description: copy.bounceOnNeedsInputDescription,
      testId: 'attention-pref-bounceOnNeedsInput',
    },
  ];
}

function AuthorizationControl(props: {
  copy: NotificationsCopy;
  os: DesktopAttentionOs;
  authorization: AttentionAuthorization | null;
  capabilities: AttentionOsCapabilities | null;
  onAuthorization: (next: AttentionAuthorization) => void;
}): ReactElement {
  const { copy, os, authorization, capabilities, onAuthorization } = props;

  if (authorization === null || capabilities === null) {
    return <span data-testid="attention-authorization-status" />;
  }

  if (!capabilities.nativeCenter || authorization === 'unsupported') {
    return (
      <StatusBadge
        tone="neutral"
        label={copy.statusUnsupported}
        testId="attention-authorization-status"
      />
    );
  }

  if (!capabilities.authorizationReliable) {
    return (
      <Button
        data-testid="attention-open-system-settings"
        onClick={() => {
          void os.openSystemSettings();
        }}
      >
        {copy.openSystemSettings}
      </Button>
    );
  }

  if (authorization === 'granted') {
    return (
      <StatusBadge
        tone="success"
        label={copy.statusGranted}
        testId="attention-authorization-status"
      />
    );
  }

  if (authorization === 'denied') {
    return (
      <>
        <StatusBadge
          tone="neutral"
          label={copy.statusDenied}
          testId="attention-authorization-status"
        />
        <Button
          data-testid="attention-open-system-settings"
          onClick={() => {
            void os.openSystemSettings();
          }}
        >
          {copy.openSystemSettings}
        </Button>
      </>
    );
  }

  return (
    <Button
      variant="primary"
      data-testid="attention-enable-authorization"
      onClick={() => {
        void os.requestAuthorization().then(onAuthorization);
      }}
    >
      {copy.enableAuthorization}
    </Button>
  );
}

export function NotificationsPage(props: NotificationsPageProps = {}): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getNotificationsCopy(locale);
  const os = useMemo(() => props.os ?? createDesktopAttentionOs(), [props.os]);
  const storage = props.storage;
  const [preferences, setPreferences] = useState(() => readAttentionPreferences(storage));
  const [authorization, setAuthorization] = useState<AttentionAuthorization | null>(null);
  const [capabilities, setCapabilities] = useState<AttentionOsCapabilities | null>(null);
  const { confirm, dialog } = useConfirmDialog();

  useEffect(() => {
    setPreferences(readAttentionPreferences(storage));
    return subscribeAttentionPreferences(setPreferences);
  }, [storage]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([os.getAuthorization(), os.getCapabilities()]).then(([nextAuth, nextCaps]) => {
      if (!cancelled) {
        setAuthorization(nextAuth);
        setCapabilities(nextCaps);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [os]);

  async function handlePreferenceChange(
    key: keyof AttentionPreferences,
    checked: boolean,
  ): Promise<void> {
    if (key === 'onNeedsInput' && preferences.onNeedsInput && !checked) {
      const confirmed = await confirm({
        title: copy.onNeedsInputConfirmTitle,
        description: copy.onNeedsInputConfirmBody,
        confirmLabel: copy.confirm,
        cancelLabel: copy.cancel,
        tone: 'default',
      });
      if (!confirmed) {
        return;
      }
    }
    writeAttentionPreferences({ ...preferences, [key]: checked }, storage);
  }

  return (
    <div className="settings-card" data-testid="settings-notifications">
      {dialog}
      <div className="settings-section settings-section-card">
        <PageTitle title={copy.title} description={copy.description} />
        <FieldRow
          label={copy.authorizationLabel}
          description={
            capabilities && capabilities.nativeCenter && !capabilities.authorizationReliable
              ? copy.authorizationDescriptionManaged
              : copy.authorizationDescription
          }
          testId="attention-authorization-row"
        >
          <AuthorizationControl
            copy={copy}
            os={os}
            authorization={authorization}
            capabilities={capabilities}
            onAuthorization={setAuthorization}
          />
        </FieldRow>
        {preferenceFields(copy).map((field) => (
          <FieldRow
            key={field.key}
            label={field.label}
            description={field.description}
            testId={`attention-pref-row-${field.key}`}
          >
            <Switch
              checked={preferences[field.key]}
              onCheckedChange={(checked) => {
                void handlePreferenceChange(field.key, checked);
              }}
              aria-label={field.label}
              testId={field.testId}
            />
          </FieldRow>
        ))}
      </div>
    </div>
  );
}
