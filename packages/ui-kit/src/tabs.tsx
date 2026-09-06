import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ReactElement, ReactNode } from 'react';

export type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function Tabs(props: TabsProps): ReactElement {
  return (
    <TabsPrimitive.Root
      value={props.value}
      onValueChange={props.onValueChange}
      className={props.className ? `ui-tabs ${props.className}` : 'ui-tabs'}
      data-testid={props.testId}
    >
      {props.children}
    </TabsPrimitive.Root>
  );
}

export type TabsListProps = {
  children: ReactNode;
  className?: string;
  label?: string;
};

export function TabsList(props: TabsListProps): ReactElement {
  return (
    <TabsPrimitive.List
      className={props.className ? `ui-tabs-list ${props.className}` : 'ui-tabs-list'}
      aria-label={props.label}
    >
      {props.children}
    </TabsPrimitive.List>
  );
}

export type TabsTriggerProps = {
  value: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  disabled?: boolean;
  /** A panel mounted by a separate lifecycle owner (for example a terminal). */
  controlsId?: string;
};

export function TabsTrigger(props: TabsTriggerProps): ReactElement {
  return (
    <TabsPrimitive.Trigger
      value={props.value}
      className={props.className ? `ui-tabs-trigger ${props.className}` : 'ui-tabs-trigger'}
      data-testid={props.testId}
      disabled={props.disabled}
      {...(props.controlsId ? { 'aria-controls': props.controlsId } : {})}
    >
      {props.children}
    </TabsPrimitive.Trigger>
  );
}

export type TabsContentProps = {
  value: string;
  children: ReactNode;
  className?: string;
  testId?: string;
};

export function TabsContent(props: TabsContentProps): ReactElement {
  return (
    <TabsPrimitive.Content
      value={props.value}
      className={props.className ? `ui-tabs-content ${props.className}` : 'ui-tabs-content'}
      data-testid={props.testId}
    >
      {props.children}
    </TabsPrimitive.Content>
  );
}
