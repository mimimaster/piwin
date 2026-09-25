import { useEffect, useRef, useState } from 'react';
import type { HostPush, SessionPlan, SessionTodoItem } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readSessionPlan } from '../../mobile-host-readers.js';

/**
 * The active session's plan and todo list, as the Host keeps them. Loaded once
 * per session, then followed through `plan/updated` / `todo/updated`.
 */
export interface SessionPlanTodo {
  plan: SessionPlan | null;
  todos: SessionTodoItem[];
}

export function useSessionPlanTodo(client: HostClient | undefined, sessionId: string | undefined): SessionPlanTodo {
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [todos, setTodos] = useState<SessionTodoItem[]>([]);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  useEffect(() => {
    setPlan(null);
    setTodos([]);
    if (client === undefined || sessionId === undefined) return;
    let cancelled = false;
    if (client.supportsCommand('plan/get')) {
      client
        .request({ type: 'plan/get', sessionId })
        .then((response) => {
          if (!cancelled) setPlan(readSessionPlan(response));
        })
        .catch((error: unknown) => console.warn('[mobile] plan/get failed', error));
    }
    if (client.supportsCommand('todo/get')) {
      client
        .request({ type: 'todo/get', sessionId })
        .then((response) => {
          if (!cancelled && response.success) setTodos(readTodoItems(response.data));
        })
        .catch((error: unknown) => console.warn('[mobile] todo/get failed', error));
    }
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  useEffect(() => {
    if (client === undefined) return undefined;
    return client.subscribePush((push: HostPush) => {
      if (push.type === 'plan/updated' && push.sessionId === sessionRef.current) {
        setPlan(push.plan);
      } else if (push.type === 'todo/updated' && push.sessionId === sessionRef.current) {
        setTodos(push.items);
      }
    });
  }, [client]);

  return { plan, todos };
}

/** `计划 2/4`: finished (done or skipped) over total; undefined when no plan. */
export function planProgressLabel(plan: SessionPlan | null): string | undefined {
  if (plan === null || plan.steps.length === 0) return undefined;
  const finished = plan.steps.filter((step) => step.status === 'done' || step.status === 'skipped').length;
  return `${finished}/${plan.steps.length}`;
}

export function todoProgressLabel(todos: readonly SessionTodoItem[]): string | undefined {
  const live = todos.filter((item) => item.status !== 'cancelled');
  if (live.length === 0) return undefined;
  return `${live.filter((item) => item.status === 'done').length}/${live.length}`;
}

function readTodoItems(data: unknown): SessionTodoItem[] {
  if (typeof data !== 'object' || data === null) return [];
  const items = (data as { items?: unknown }).items;
  return Array.isArray(items)
    ? items.filter(
        (item): item is SessionTodoItem =>
          typeof item === 'object' && item !== null && typeof (item as { content?: unknown }).content === 'string',
      )
    : [];
}
