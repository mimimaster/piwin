/** @piwin/ui-kit — Shared UI primitives. */
export const packageName = '@piwin/ui-kit' as const;

export { Button } from './button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button.js';

export { PiwinUiProvider, buildMantineTheme } from './piwin-ui-provider.js';
export type { PiwinUiProviderProps } from './piwin-ui-provider.js';

export { IconButton } from './icon-button.js';
export type { IconButtonProps } from './icon-button.js';

export { Dialog } from './dialog.js';
export type { DialogProps } from './dialog.js';

export { EmptyState } from './empty-state.js';
export type { EmptyStateProps } from './empty-state.js';

export { Spinner } from './spinner.js';
export type { SpinnerProps } from './spinner.js';

export {
  ContextMenu,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './menu.js';
export type {
  ContextMenuItemProps,
  ContextMenuLabelProps,
  ContextMenuProps,
  ContextMenuSubContentProps,
  ContextMenuSubProps,
  ContextMenuSubTriggerProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
} from './menu.js';

export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  PopoverVirtualAnchor,
  virtualAnchorFromRange,
} from './popover.js';
export type { PopoverProps, PopoverContentProps, VirtualAnchorRect } from './popover.js';

export { restoreSelectionRanges, snapshotSelectionRanges } from './selection-ranges.js';

export { ConfirmDialog } from './confirm-dialog.js';
export type { ConfirmDialogProps, ConfirmDialogTone } from './confirm-dialog.js';

export { Notice } from './notice.js';
export type { NoticeProps, NoticeTone } from './notice.js';

export {
  hideUiNotification,
  showErrorNotification,
  showInfoNotification,
  showSuccessNotification,
  showUiNotification,
  showWarningNotification,
} from './notifications.js';
export type { UiNotificationInput, UiNotificationTone } from './notifications.js';

export { StatusBadge } from './status-badge.js';
export type { StatusBadgeProps, StatusTone } from './status-badge.js';

export { Surface } from './surface.js';
export type { SurfaceProps, SurfaceTone } from './surface.js';

export { ListRow } from './list-row.js';
export type { ListRowProps } from './list-row.js';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';
export type { TabsContentProps, TabsListProps, TabsProps, TabsTriggerProps } from './tabs.js';

export { Field, FieldCheckbox, FieldDescription, FieldError, FieldLabel } from './field.js';
export type { FieldCheckboxProps, FieldProps } from './field.js';

export { Switch } from './switch.js';
export type { SwitchProps } from './switch.js';

export { Collapse } from './collapse.js';
export type { CollapseProps } from './collapse.js';

export { Slider } from './slider.js';
export type { SliderProps } from './slider.js';

export { Modal } from './modal.js';
export type { ModalProps } from './modal.js';

export { TextInput, PasswordInput } from './text-input.js';
export type { TextInputProps, PasswordInputProps } from './text-input.js';

export { TextArea } from './textarea.js';
export type { TextAreaProps } from './textarea.js';

export { Select } from './select.js';
export type { SelectProps } from './select.js';

export { SegmentedControl } from './segmented-control.js';
export type { SegmentedControlProps } from './segmented-control.js';

export { ColorInput } from './color-input.js';
export type { ColorInputProps } from './color-input.js';

export { Card } from './card.js';
export type { CardProps } from './card.js';

export { FlashcardFace } from './flashcard-face.js';
export type { FlashcardFaceProps } from './flashcard-face.js';
export {
  FLIP_CLICK_MAX_DISTANCE_PX,
  hasSelectionInside,
  isInteractiveClickTarget,
  shouldFlipOnClick,
} from './flashcard-face-click.js';
export type { FlipClickFacts } from './flashcard-face-click.js';

export { TearDeckSurface, FLASHCARD_TEAR_DURATION_MS } from './tear-deck-surface.js';
export type { TearDeckSurfaceProps } from './tear-deck-surface.js';

/** Shared redesigned icons and file type badges. */
export * from './icons/index.js';

export { BreathDot, PulseBlock, SolidBars, ANIMATION_CATALOG } from './animations.js';
export type {
  AnimationSize,
  BreathDotProps,
  PulseBlockProps,
  SolidBarsProps,
  AnimationCatalogEntry,
} from './animations.js';
export {
  OrganicBlob,
  BreathMatrix,
  RadialBellow,
  CascadeRipple,
  AsteriskBreath,
} from './animations.js';
export type {
  OrganicBlobProps,
  BreathMatrixProps,
  RadialBellowProps,
  CascadeRippleProps,
  AsteriskBreathProps,
} from './animations.js';
