import type { ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { ComposerPlusMenu } from './composer-plus-menu';
import { getAgentMode } from './agent-mode';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { RunModeControl } from './RunModeControl';
import { OrchestrationSchemeControl } from './OrchestrationSchemeControl';
import { IconClose, IconMic, IconPlus } from './shell-icons';
import { LiveComposerButton } from './live/LiveComposerButton.js';
import { ComposerActionSlot } from './composer-run-actions';
import { ComposerContextUsageControl } from './composer-context-controls';
import type { ComposerDockProps } from './composer-dock-types';
import type { getDesktopCopy } from './desktop-locale';
import type { useSpeechInput } from './hooks/use-speech-input.js';

type ComposerCopy = ReturnType<typeof getDesktopCopy>['composer'] & {
  send: string;
  sendShortcut: string;
};

export type ComposerCardToolbarProps = {
  props: ComposerDockProps;
  copy: ComposerCopy;
  locale: string;
  isStreamingRun: boolean;
  isPaused: boolean;
  hasContent: boolean;
  onlyFailedAttachments: boolean;
  isExtensionUiActive: boolean;
  canComposeText: boolean;
  showSpeechInput: boolean;
  speechInput: ReturnType<typeof useSpeechInput>;
  thinkingModels: Array<{
    key: string;
    label: string;
    protocol?: import('@piwin/contracts').ModelProtocol;
    thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
    reasoning?: boolean;
    supportsImage?: boolean;
    supportsImageGeneration?: boolean;
  }>;
  selectedModel: ComposerDockProps['modelOptions'][number] | undefined;
  triggerSend: () => void;
  triggerSteer: () => void;
};

export function ComposerCardToolbar({
  props,
  copy,
  locale,
  isStreamingRun,
  isPaused,
  hasContent,
  onlyFailedAttachments,
  isExtensionUiActive,
  canComposeText,
  showSpeechInput,
  speechInput,
  thinkingModels,
  selectedModel,
  triggerSend,
  triggerSteer,
}: ComposerCardToolbarProps): ReactElement {
  const agentModeDefinition = getAgentMode(props.agentMode);
  return (
    <div className="composer-v2-toolbar">
      <div className="composer-v2-toolbar-left">
        {/* Plus / attach button */}
        <div className="plus-anchor">
          <ComposerPlusMenu
            trigger={
              <IconButton
                className={`composer-v2-icon-btn${props.plusMenuOpen ? ' active' : ''}`}
                data-testid="composer-plus-btn"
                title={copy.attachFiles}
                label={copy.attachFiles}
              >
                <IconPlus />
              </IconButton>
            }
            open={props.plusMenuOpen}
            onOpenChange={(open) => {
              props.onPlusMenuOpenChange(open);
              props.onPlusSubmenuChange('none');
              if (open) {
                props.onRefreshComposerMenus();
              }
            }}
            submenu={props.plusSubmenu}
            onSubmenu={props.onPlusSubmenuChange}
            skills={props.menuSkills}
            onOpenSkillsPanel={props.onOpenSkillsPanel}
            mcpServers={props.menuMcp}
            onOpenMcpPanel={props.onOpenMcpPanel}
            onAttachFile={props.onAttachFile}
            onAttachImage={props.onAttachImage}
            onOpenKnowledge={props.onOpenKnowledge}
            onOpenCardsPanel={props.onOpenCardsPanel}
            hideAgentExtras={props.isConversationSession === true}
          />
        </div>

        {/* Thinking effort / Model control */}
        <ThinkingEffortControl
          disabled={isStreamingRun || !props.onThinkingLevelChange}
          modelLabel={selectedModel?.label ?? props.selectedModelLabel ?? copy.model}
          ultraEnabled={props.ultraThinkingEnabled ?? false}
          value={props.thinkingLevel ?? 'off'}
          onChange={(level) => props.onThinkingLevelChange?.(level)}
          models={thinkingModels}
          selectedModelKey={props.selectedModelKey}
          onSelectModel={props.onSelectModel}
        />

        <LiveComposerButton
          enabled={true}
          canStart={props.live?.canStart === true}
          starting={props.live?.starting === true}
          call={props.live?.call ?? null}
          error={props.live?.error ?? null}
          missing={props.live?.missing ?? []}
          isChinese={locale === 'zh-CN'}
          onStart={props.live?.onStart ?? (() => undefined)}
          onEnd={props.live?.onEnd ?? (() => undefined)}
        />

        {showSpeechInput ? (
          <>
            <IconButton
              className={`composer-v2-icon-btn${speechInput.status === 'listening' ? ' active' : ''}`}
              data-testid="composer-speech-btn"
              label={
                speechInput.status === 'listening'
                  ? 'Stop recording'
                  : speechInput.status === 'transcribing'
                    ? 'Transcribing'
                    : 'Voice input'
              }
              disabled={isStreamingRun || !canComposeText || speechInput.status === 'transcribing'}
              onClick={() => speechInput.toggle()}
            >
              <IconMic />
            </IconButton>
            {speechInput.error ? (
              <span className="composer-speech-status is-error" data-testid="composer-speech-error">
                {speechInput.error}
              </span>
            ) : speechInput.status === 'listening' ? (
              <span className="composer-speech-status" data-testid="composer-speech-status">
                Recording…
              </span>
            ) : speechInput.status === 'transcribing' ? (
              <span className="composer-speech-status" data-testid="composer-speech-status">
                Transcribing…
              </span>
            ) : null}
          </>
        ) : null}

        {/* Agent mode chip (non-default only) */}
        {props.isConversationSession !== true && props.agentMode !== 'agent' ? (
          <span
            className={`composer-v2-mode-chip mode-${props.agentMode}`}
            data-testid="agent-mode-chip"
            title={agentModeDefinition.description}
          >
            {agentModeDefinition.label}
            <button
              type="button"
              className="composer-v2-mode-dismiss"
              data-testid="agent-mode-dismiss"
              disabled={isStreamingRun}
              aria-label={copy.exitAgentMode(agentModeDefinition.label)}
              onClick={() => props.onAgentModeChange('agent')}
            >
              <IconClose width={12} height={12} />
            </button>
          </span>
        ) : null}
      </div>

      <div className="composer-v2-toolbar-right">
        {/* Run Mode pill (ADR 0024) */}
        {props.isConversationSession !== true && props.onRunModeChange && props.runModePreset ? (
          <RunModeControl
            disabled={isStreamingRun}
            value={props.runModePreset}
            onChange={props.onRunModeChange}
            {...(props.onRunModeSetDefault ? { onSetDefault: props.onRunModeSetDefault } : {})}
            {...(props.onOpenPermissionsSettings
              ? { onOpenSettings: props.onOpenPermissionsSettings }
              : {})}
            {...(props.runModeYoloDisabled ? { yoloDisabled: true } : {})}
          />
        ) : null}

        {/* Always visible: scheme is a mode picker, not a feature switch.
              Default `off` = freehand (no injection); Ultra Code etc. inject on send. */}
        {props.isConversationSession !== true &&
        props.onOrchestrationSchemeChange &&
        props.orchestrationSchemeOptions ? (
          <OrchestrationSchemeControl
            disabled={false}
            value={props.orchestrationSchemeId ?? 'off'}
            options={props.orchestrationSchemeOptions}
            onChange={props.onOrchestrationSchemeChange}
            delegationDisabled={props.delegationDisabled ?? false}
            {...(props.onDelegationDisabledChange
              ? { onDelegationDisabledChange: props.onDelegationDisabledChange }
              : {})}
            {...(props.onOpenOrchestrationSchemeSettings
              ? { onOpenSettings: props.onOpenOrchestrationSchemeSettings }
              : {})}
          />
        ) : null}

        {/* Context usage ring */}
        <ComposerContextUsageControl
          usage={props.contextUsage}
          {...(typeof props.modelContextWindow === 'number'
            ? { modelContextWindow: props.modelContextWindow }
            : {})}
          {...(props.onOpenModelSettings ? { onOpenModelSettings: props.onOpenModelSettings } : {})}
          isConversationSession={props.isConversationSession === true}
          locale={locale === 'en' ? 'en' : 'zh-CN'}
        />

        <ComposerActionSlot
          copy={copy}
          activeSessionId={props.activeSessionId}
          runPhase={props.runPhase}
          isStreamingRun={isStreamingRun}
          isPaused={isPaused}
          hasContent={hasContent}
          onlyFailedAttachments={onlyFailedAttachments}
          isExtensionUiActive={isExtensionUiActive}
          composerHasText={props.composer.trim().length > 0}
          onSend={triggerSend}
          onPause={props.onPause}
          {...(props.onResume ? { onResume: props.onResume } : {})}
          {...(props.onSteer ? { onSteer: triggerSteer } : {})}
          {...(props.mutationsEnabled === undefined
            ? {}
            : { mutationsEnabled: props.mutationsEnabled })}
        />
      </div>
    </div>
  );
}
