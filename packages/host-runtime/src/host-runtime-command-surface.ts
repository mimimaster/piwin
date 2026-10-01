import type {
  AgentEvent,
  ExtensionDeploymentRecord,
  HostCommand,
  HostResponse,
  PermissionDecision,
  PermissionMode,
  PromptInput,
} from '@piwin/contracts';
import type { SessionAllowlist } from './session-allowlist.js';
import type {
  ExtensionApplyCommand,
  ExtensionDeploymentPatch,
} from './host-runtime-types.js';
import {
  recoverInterruptedExtensionDeployments,
  blockUntilExtensionRecoverySettled,
  executeExtensionApply,
  activateExtensionApply,
  finishExtensionApplyInBackground,
  writeExtensionDeployment,
  updateExtensionDeployment,
} from './host-runtime-extension-apply.js';
import {
  trustProject,
  requestPermission,
  getOrCreateSessionAllowlist,
  rememberSessionPermission,
  clearSessionAllowlist,
  setSessionPermissionOverride,
  clearSessionPermissionOverride,
  getSessionPermissionOverride,
  waitForPermission,
  requestExtensionUi,
  settlePendingExtensionUiForSession,
  rememberProjectPermission,
} from './host-runtime-permissions.js';
import { validatePromptAttachments, buildModelPromptInput } from './host-runtime-prompt.js';
import {
  getNotesServices,
  getCardStore,
  getStudyService,
  getFolderRag,
  dispatchHooksForAgentEvent,
  runCronJob,
} from './host-runtime-services.js';
import { HostRuntimeFields } from './host-runtime-fields.js';

export class HostRuntimeCommandSurface extends HostRuntimeFields {


  async recoverInterruptedExtensionDeployments(): Promise<void> {
    return recoverInterruptedExtensionDeployments(this.asKernel());
  }


  async blockUntilExtensionRecoverySettled(
    requestId: string | undefined,
    commandType: HostCommand['type'],
  ): Promise<HostResponse | null> {
    return blockUntilExtensionRecoverySettled(this.asKernel(), requestId, commandType);
  }


  async executeExtensionApply(
    command: ExtensionApplyCommand,
    requestId: string | undefined,
  ): Promise<HostResponse> {
    return executeExtensionApply(this.asKernel(), command, requestId);
  }


  async activateExtensionApply(
    command: ExtensionApplyCommand,
    requestId: string | undefined,
    deployment: ExtensionDeploymentRecord,
    expectedSettingsRevision: string,
  ): Promise<HostResponse> {
    return activateExtensionApply(
      this.asKernel(),
      command,
      requestId,
      deployment,
      expectedSettingsRevision,
    );
  }


  async finishExtensionApplyInBackground(
    command: ExtensionApplyCommand,
    deployment: ExtensionDeploymentRecord,
    expectedSettingsRevision: string,
  ): Promise<void> {
    return finishExtensionApplyInBackground(
      this.asKernel(),
      command,
      deployment,
      expectedSettingsRevision,
    );
  }


  async writeExtensionDeployment(record: ExtensionDeploymentRecord): Promise<void> {
    return writeExtensionDeployment(this.asKernel(), record);
  }


  async updateExtensionDeployment(
    record: ExtensionDeploymentRecord,
    patch: ExtensionDeploymentPatch,
  ): Promise<ExtensionDeploymentRecord> {
    return updateExtensionDeployment(this.asKernel(), record, patch);
  }


  async trustProject(projectPath: string): Promise<unknown> {
    return trustProject(this.asKernel(), projectPath);
  }


  requestPermission(input: {
    sessionId: string;
    projectPath?: string;
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  }): Promise<PermissionDecision> {
    return requestPermission(this.asKernel(), input);
  }


  getOrCreateSessionAllowlist(sessionId: string): SessionAllowlist {
    return getOrCreateSessionAllowlist(this.asKernel(), sessionId);
  }


  rememberSessionPermission(
    sessionId: string,
    action: string,
    detail: string,
    grant?: import('./session-allowlist.js').SessionWorkspaceGrant,
  ): void {
    return rememberSessionPermission(this.asKernel(), sessionId, action, detail, grant);
  }


  clearSessionAllowlist(sessionId: string): void {
    return clearSessionAllowlist(this.asKernel(), sessionId);
  }


  setSessionPermissionOverride(sessionId: string, mode: PermissionMode): void {
    return setSessionPermissionOverride(this.asKernel(), sessionId, mode);
  }


  clearSessionPermissionOverride(sessionId: string): void {
    return clearSessionPermissionOverride(this.asKernel(), sessionId);
  }


  getSessionPermissionOverride(sessionId: string): PermissionMode | undefined {
    return getSessionPermissionOverride(this.asKernel(), sessionId);
  }


  waitForPermission(requestId: string): Promise<PermissionDecision> {
    return waitForPermission(this.asKernel(), requestId);
  }


  requestExtensionUi(
    input: import('@piwin/agent-host').ExtensionUiRequest & { sessionId: string },
  ): Promise<import('@piwin/agent-host').ExtensionUiResponse> {
    return requestExtensionUi(this.asKernel(), input);
  }


  settlePendingExtensionUiForSession(sessionId: string): void {
    return settlePendingExtensionUiForSession(this.asKernel(), sessionId);
  }


  async rememberProjectPermission(
    sessionId: string,
    action: string,
    detail: string,
    scope: 'project' = 'project',
    pendingProjectPath?: string,
  ): Promise<void> {
    return rememberProjectPermission(
      this.asKernel(),
      sessionId,
      action,
      detail,
      scope,
      pendingProjectPath,
    );
  }


  validatePromptAttachments(input: PromptInput): void {
    return validatePromptAttachments(this.asKernel(), input);
  }


  async buildModelPromptInput(input: PromptInput, signal?: AbortSignal): Promise<PromptInput> {
    return buildModelPromptInput(this.asKernel(), input, signal);
  }


  async getNotesServices(): Promise<{
    store: import('@piwin/notes').NoteStore;
  }> {
    return getNotesServices(this.asKernel());
  }


  async getCardStore(): Promise<import('@piwin/flashcards').CardStore> {
    return getCardStore(this.asKernel());
  }


  async getStudyService(): Promise<import('@piwin/flashcards').StudyService> {
    return getStudyService(this.asKernel());
  }


  async getFolderRag(): Promise<import('@piwin/doc-rag').FolderRag> {
    return getFolderRag(this.asKernel());
  }


  async dispatchHooksForAgentEvent(sessionId: string, event: AgentEvent): Promise<void> {
    return dispatchHooksForAgentEvent(this.asKernel(), sessionId, event);
  }


  async runCronJob(job: import('@piwin/contracts').CronJob): Promise<{
    ok: boolean;
    message?: string;
  }> {
    return runCronJob(this.asKernel(), job);
  }

}
