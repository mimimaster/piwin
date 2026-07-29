import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
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
  const [imgError, setImgError] = useState(false);
  const LucideIcon = iconMap[props.source.lucideName] ?? Loader2;

  useEffect(() => {
    setImgError(false);
  }, [props.source.imgSrc, props.source.lucideName]);

  if (props.source.imgSrc && !imgError) {
    return (
      <img
        className={props.className}
        src={props.source.imgSrc}
        alt=""
        aria-hidden
        data-testid={props['data-testid']}
        onError={() => setImgError(true)}
      />
    );
  }

  return <LucideIcon className={props.className} aria-hidden data-testid={props['data-testid']} />;
}
