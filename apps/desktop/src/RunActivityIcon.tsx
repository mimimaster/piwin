import { type ComponentType, type ReactElement } from 'react';
import {
  Loader2,
  Settings,
  Wifi,
  Sparkles,
  Map,
  Code,
  Terminal,
  ShieldQuestion,
  Minimize2,
  Square,
  Circle,
  XCircle,
  CheckCircle2,
  type LucideProps,
} from 'lucide-react';
import type { ActivityIconSource } from './run-activity-types.js';

const iconMap: Record<string, ComponentType<LucideProps>> = {
  Loader2,
  Settings,
  Wifi,
  Sparkles,
  Map,
  Code,
  Terminal,
  ShieldQuestion,
  Minimize2,
  Square,
  Circle,
  XCircle,
  CheckCircle2,
};

export type RunActivityIconProps = {
  source: ActivityIconSource;
  className?: string;
  'data-testid'?: string;
};

export function RunActivityIcon(props: RunActivityIconProps): ReactElement {
  const LucideIcon = iconMap[props.source.lucideName] ?? Loader2;

  return <LucideIcon className={props.className} aria-hidden data-testid={props['data-testid']} />;
}
