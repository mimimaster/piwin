import {
  ScrollView,
  VStack,
  isViewportTUI,
  type Component,
  type TUI,
} from '@earendil-works/pi-tui';

/** The transcript scrolls independently; the composer stays at the viewport bottom. */
export function mountTuiLayout(
  tui: TUI,
  slots: {
    transcript: Component;
    activity: Component;
    editor: Component;
    status: Component;
  },
): ScrollView | undefined {
  if (!isViewportTUI(tui)) {
    for (const component of [slots.transcript, slots.activity, slots.editor, slots.status])
      tui.addChild(component);
    return undefined;
  }
  const transcript = new ScrollView(slots.transcript, {
    follow: 'end',
    primary: true,
    overscroll: 'contain',
  });
  tui.setLayoutRoot(
    new VStack([
      { component: transcript, basis: 0, grow: 1, minSize: 0 },
      { component: slots.activity, shrink: 0, visible: (viewport) => viewport.height >= 6 },
      // On very short terminals pi-tui crops around the editor's cursor.
      { component: slots.editor, shrink: 1, minSize: 1 },
      { component: slots.status, shrink: 0, visible: (viewport) => viewport.height >= 4 },
    ]),
  );
  return transcript;
}
