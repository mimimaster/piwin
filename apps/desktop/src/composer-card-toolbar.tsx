import type { ReactElement } from 'react';
import { IconButton } from '@piwin/ui-kit';
import { ComposerPlusMenu } from './composer-plus-menu';
import { DraftAgentPicker } from './draft-agent-picker';
import { BackendComposerControls } from './backend-composer-controls';
import { agentDisplayName } from './agent-backend-state';
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
  isPauseContinueDraft?: boolean;
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
  onResumeCheckpoint?: () => void;
};

export function ComposerCardToolbar({
  props,
  copy,
  locale,
  isStreamingRun,
  isPaused,
  hasContent,
  isPauseContinueDraft = false,
  onlyFailedAttachments,
  isExtensionUiActive,
  canComposeText,
  showSpeechInput,
  speechInput,
  thinkingModels,
  selectedModel,
  triggerSend,
  onResumeCheckpoint,
}: ComposerCardToolbarProps): ReactElement {
  const reservedCommand = isReservedComposerSlashCommand(props.composer);
  const resumeHandler = onResumeCheckpoint ?? props.onResume;
  // ADR 0082: an external agent owns its own model/mode catalog, so Pi's
  // provider-backed picker is replaced rather than merged.
  const backendOptions = props.backendOptions ?? null;
  const showBackendControls = backendOptions !== null;
  // ADR 0082: never offer an operation the backend cannot run.
  const supports = props.capabilities?.supports;
  const pauseSupported = supports ? supports('pause') : true;
  const imagesSupported = supports ? supports('images') : true;
  const imageDisabledReason = imagesSupported
    ? undefined
    : props.capabilities?.unsupportedReason('images');
  // The draft picker only appears when a second agent actually exists;
  // a Pi-only install keeps today's composer unchanged (spec §2).
  const draftAgentOptions = props.draftAgentOptions ?? [];
  const showDraftAgentPicker =
    draftAgentOptions.length > 1 && props.activeSessionId === null && props.embedded !== true;
  return (
    <div className="bar composer-v2-toolbar">
      <div className="composer-v2-toolbar-left">
        {props.embedded === true ? null : (
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
              {...(props.menuMcpSwitches ? { mcpSwitches: props.menuMcpSwitches } : {})}
              onOpenMcpPanel={props.onOpenMcpPanel}
              extensionCommands={props.menuExtensionCommands}
              onSelectExtensionCommand={(name) => {
                props.onComposerChange(`/${name} `);
                props.onPlusMenuOpenChange(false);
              }}
              {...(props.onOpenExtensionsPanel ? { onOpenExtensionsPanel: props.onOpenExtensionsPanel } : {})}
              {...(props.onOpenMarketplace ? { onOpenMarketplace: props.onOpenMarketplace } : {})}
              onAttachFile={props.onAttachFile}
              {...(imagesSupported ? { onAttachImage: props.onAttachImage } : {})}
              {...(imageDisabledReason ? { attachImageDisabledReason: imageDisabledReason } : {})}
              hideAgentExtras={props.isConversationSession === true}
            />
          </div>
        )}

        {/* Thinking effort / Model control */}
        {showBackendControls ? (
          <BackendComposerControls
            options={backendOptions}
            agentLabel={agentDisplayName(backendOptions.agentId)}
            disabled={isStreamingRun || !props.onBackendModelChange}
            onSelectModel={(modelId) => props.onBackendModelChange?.(modelId)}
            onSelectEffort={(effortId) => props.onBackendEffortChange?.(effortId)}
            onSelectMode={(modeId) => props.onBackendModeChange?.(modeId)}
          />
        ) : (
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
        )}

        {showDraftAgentPicker ? (
          <DraftAgentPicker
            value={props.draftAgentId ?? 'pi'}
            options={draftAgentOptions}
            disabled={isStreamingRun}
            onChange={(agentId) => props.onDraftAgentChange?.(agentId)}
          />
        ) : null}

        {props.embedded === true || props.liveSupported === false ? null : (
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
        )}
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
          isPauseContinueDraft={isPauseContinueDraft}
          onlyFailedAttachments={onlyFailedAttachments}
          isExtensionUiActive={isExtensionUiActive}
          onSend={triggerSend}
          onPause={props.onPause}
          pauseSupported={pauseSupported}
          {...(props.embedded === true ? { embedded: true, onAbort: props.onAbort } : {})}
          {...(props.stopOnly === true ? { stopOnly: true, onAbort: props.onAbort } : {})}
          {...(resumeHandler ? { onResume: resumeHandler } : {})}
          {...(props.mutationsEnabled === undefined && !reservedCommand
            ? {}
            : { mutationsEnabled: reservedCommand || props.mutationsEnabled !== false })}
        />
      </div>
    </div>
  );
}
