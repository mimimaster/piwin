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
  ContextMenuSeparator,
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
  ContextMenuProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubProps,
  DropdownMenuSubTriggerProps,
} from './menu.js';

export { Popover, PopoverContent, PopoverTrigger } from './popover.js';
export type { PopoverProps } from './popover.js';

export { ConfirmDialog } from './confirm-dialog.js';
export type { ConfirmDialogProps, ConfirmDialogTone } from './confirm-dialog.js';

export { Notice } from './notice.js';
export type { NoticeProps, NoticeTone } from './notice.js';

export { StatusBadge } from './status-badge.js';
export type { StatusBadgeProps, StatusTone } from './status-badge.js';

export { Surface } from './surface.js';
export type { SurfaceProps, SurfaceTone } from './surface.js';

export { ListRow } from './list-row.js';
export type { ListRowProps } from './list-row.js';

export { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs.js';
export type {
  TabsContentProps,
  TabsListProps,
  TabsProps,
  TabsTriggerProps,
} from './tabs.js';

export {
  Field,
  FieldCheckbox,
  FieldDescription,
  FieldError,
  FieldLabel,
} from './field.js';
export type { FieldCheckboxProps, FieldProps } from './field.js';
