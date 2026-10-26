import type { ReactElement } from 'react';
import { AnnotationEditor } from './AnnotationEditor.js';
import { ScreenCapturePermissionDialog } from './screen-capture-permission-dialog.js';
import type { ScreenCaptureController } from './use-screen-capture.js';

/** Renders whichever screenshot surface the controller is in, if any. */
export function ScreenCaptureLayer({
  controller,
}: {
  controller: ScreenCaptureController;
}): ReactElement | null {
  const { phase } = controller;
  if (phase.kind === 'permission') {
    return (
      <ScreenCapturePermissionDialog
        locale={controller.locale}
        onAuthorize={controller.authorize}
        onRestart={controller.restart}
        onClose={controller.close}
      />
    );
  }
  if (phase.kind === 'editing') {
    return (
      <AnnotationEditor
        key={phase.imageUrl}
        imageUrl={phase.imageUrl}
        image={phase.image}
        initialTool={phase.initialTool}
        locale={controller.locale}
        onCancel={controller.close}
        onConfirm={controller.confirm}
        onExportFailed={controller.exportFailed}
      />
    );
  }
  return null;
}
