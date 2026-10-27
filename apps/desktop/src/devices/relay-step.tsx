/**
 * Guided phone access, step "reach it from anywhere" (ADR 0101 relay). Unset:
 * the address form is open. Set: one summary line with an on/off switch and
 * Edit; the form comes back only when asked for.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { RemoteAccessStatusData } from '@piwin/contracts';
import {
  Button,
  Collapse,
  Field,
  GuideStep,
  Notice,
  PasswordInput,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { getConnectionGuideCopy } from '../i18n/desktop-locale-connection-guide.js';
import { getRemoteAccessCopy } from '../i18n/desktop-locale-remote-access.js';
import { useRemoteAccessCommand, type RemoteAccessSend } from './use-remote-access-command.js';

export function RelayStep(props: {
  index: number;
  remote: RemoteAccessStatusData;
  locale: string;
  send: RemoteAccessSend;
  onChanged: () => void;
}): ReactElement {
  const copy = getRemoteAccessCopy(props.locale);
  const guide = getConnectionGuideCopy(props.locale);
  const relay = props.remote.relay;
  const configured = relay.url !== undefined;
  const { busy, error, run } = useRemoteAccessCommand(props.send, props.onChanged);
  const [editing, setEditing] = useState(false);
  const [relayUrl, setRelayUrl] = useState(relay.url ?? '');
  const [enrollToken, setEnrollToken] = useState('');
  const [tokenOpen, setTokenOpen] = useState(false);

  // Without a saved address the form is the only thing this step can show.
  const formOpen = editing || !configured;
  // Follow the Host while nothing is being edited.
  useEffect(() => {
    if (!formOpen) setRelayUrl(relay.url ?? '');
  }, [formOpen, relay.url]);

  const ready = relay.enabled && relay.state === 'ready';
  const stateLabel = copy.relayState[relay.enabled ? relay.state : 'off'];
  const trimmedUrl = relayUrl.trim();
  const dirty =
    trimmedUrl.length > 0 &&
    (trimmedUrl !== relay.url || !relay.enabled || enrollToken.trim().length > 0);
  const closeHint =
    relay.enabled && relay.state === 'error' && relay.lastCloseCode !== undefined
      ? copy.relayCloseHint(relay.lastCloseCode)
      : undefined;

  async function save(): Promise<void> {
    const token = enrollToken.trim();
    const applied = await run({
      type: 'host/remote-access-configure',
      relay: {
        enabled: true,
        url: trimmedUrl,
        ...(token.length === 0 ? {} : { enrollToken: token }),
      },
    });
    if (applied) {
      setEnrollToken('');
      setTokenOpen(false);
      setEditing(false);
    }
  }

  const showSummaryControls = !formOpen;
  return (
    <GuideStep
      index={props.index}
      title={guide.stepRelay}
      tag={guide.optional}
      state={ready ? 'done' : formOpen ? 'active' : 'todo'}
      summary={
        showSummaryControls && relay.url !== undefined
          ? guide.stepRelaySummary(relay.url, stateLabel)
          : guide.stepRelayIdle
      }
      trailing={
        showSummaryControls ? (
          <>
            <Button
              variant="ghost"
              size="compact"
              disabled={busy}
              onClick={() => setEditing(true)}
              data-testid="remote-access-relay-edit"
            >
              {guide.relayEdit}
            </Button>
            <Switch
              checked={relay.enabled}
              disabled={busy}
              onCheckedChange={(checked) => {
                void run({
                  type: 'host/remote-access-configure',
                  relay: checked ? { enabled: true, url: relay.url ?? null } : { enabled: false },
                });
              }}
              testId="remote-access-relay"
              aria-label={copy.relayLabel}
            />
          </>
        ) : undefined
      }
      testId="remote-access-relay-step"
    >
      {formOpen ? (
        <div className="remote-access-field">
          <Field label={copy.relayUrlLabel}>
            <TextInput
              value={relayUrl}
              onChange={(event) => setRelayUrl(event.currentTarget.value)}
              placeholder={copy.relayUrlPlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              testId="remote-access-relay-url"
            />
          </Field>
          <Collapse expanded={tokenOpen} testId="remote-access-enroll">
            <Field label={copy.enrollTokenLabel} description={copy.enrollTokenHint}>
              <PasswordInput
                value={enrollToken}
                onChange={(event) => setEnrollToken(event.currentTarget.value)}
                autoComplete="off"
                disabled={busy}
                testId="remote-access-enroll-token"
              />
            </Field>
          </Collapse>
          <div className="remote-access-row">
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() => {
                void save();
              }}
              data-testid="remote-access-relay-save"
            >
              {guide.relaySaveAndOn}
            </Button>
            {configured ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setEnrollToken('');
                  setTokenOpen(false);
                }}
              >
                {guide.relayCancel}
              </Button>
            ) : null}
            {!tokenOpen ? (
              <Button
                variant="ghost"
                size="compact"
                onClick={() => setTokenOpen(true)}
                data-testid="remote-access-enroll-toggle"
              >
                {guide.relayNeedsToken}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {closeHint !== undefined ? <Notice tone="warning">{closeHint}</Notice> : null}
      {error !== undefined ? <Notice tone="error">{error}</Notice> : null}
    </GuideStep>
  );
}
