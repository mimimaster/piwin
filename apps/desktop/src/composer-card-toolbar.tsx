import type { ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { ComposerPlusMenu } from './composer-plus-menu';
import { GoalModeChip } from './goal';
import { ThinkingEffortControl } from './ThinkingEffortControl';
import { RunModeControl } from './RunModeControl';
import { OrchestrationSchemeControl } from './OrchestrationSchemeControl';
import { IconMic, IconPlus } from './shell-icons';
import { LiveComposerButton } from './live/LiveComposerButton.js';
import { ComposerActionSlot } from './composer-run-actions';
import { ComposerContextUsageControl } from './composer-context-controls';
import type { ComposerDockProps } from './composer-dock-types';
import type { getDesktopCopy } from './desktop-locale';
import type { useSpeechInput } from './hooks/use-speech-input.js';
import { isReservedComposerSlashCommand } from './slash';

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
}: ComposerCardToolbarProps): ReactElement {
  const reservedCommand = isReservedComposerSlashCommand(props.composer);
  return (
    <div className="bar composer-v2-toolbar">
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

      </div>

      <div className="composer-v2-toolbar-right">
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

        {/* Goal is entered via `/goal`; the toolbar only shows the way out. */}
        {props.agentMode === 'goal' ? (
          <GoalModeChip
            disabled={isStreamingRun}
            onExit={() => props.onAgentModeChange('agent')}
          />
        ) : null}

        {/* Context usage ring */}
        {props.contextRingView ? (
          <ComposerContextUsageControl
            view={props.contextRingView}
            {...(props.onOpenModelSettings
              ? { onOpenModelSettings: props.onOpenModelSettings }
              : {})}
          />
        ) : null}

        <ComposerActionSlot
          copy={copy}
          activeSessionId={props.activeSessionId}
          runPhase={props.runPhase}
          isStreamingRun={isStreamingRun}
          isPaused={isPaused}
          hasContent={hasContent}
          onlyFailedAttachments={onlyFailedAttachments}
          isExtensionUiActive={isExtensionUiActive}
          onSend={triggerSend}
          onPause={props.onPause}
          {...(props.onResume ? { onResume: props.onResume } : {})}
          {...(props.mutationsEnabled === undefined && !reservedCommand
            ? {}
            : { mutationsEnabled: reservedCommand || props.mutationsEnabled !== false })}
        />
      </div>
    </div>
  );
}
