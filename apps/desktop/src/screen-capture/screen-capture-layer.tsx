import type { ReactElement } from 'react';
import { Modal } from '@piwin/ui-kit';
import { ScreenshotEditor } from './ScreenshotEditor.js';
import { wholeImage } from './selection-geometry.js';
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
    // Linux: the OS already picked the region, so the editor starts at step 2.
    return (
      <Modal
        open
        onOpenChange={(open) => {
          if (!open) controller.close();
        }}
        fullScreen
        withCloseButton={false}
        className="screen-capture-editor"
        testId="screen-capture-editor"
        closeOnClickOutside={false}
        closeOnEscape={false}
      >
        <div className="screen-capture-frame">
          <ScreenshotEditor
            key={phase.imageUrl}
            imageUrl={phase.imageUrl}
            image={phase.image}
            initialSelection={wholeImage(phase.image)}
            locale={controller.locale}
            doneLabel={controller.locale === 'zh-CN' ? '添加到对话' : 'Add to chat'}
            onCancel={controller.close}
            onDone={controller.confirm}
            onPin={controller.pin}
            onExportFailed={controller.exportFailed}
          />
        </div>
      </Modal>
    );
  }
  return null;
}
