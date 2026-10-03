import { useEffect, useRef, useState } from 'react';
import type { HostPush, SessionPlan, SessionTodoItem } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { readSessionPlan } from '../../mobile-host-readers.js';

/**
 * The active session's plan and todo list, as the Host keeps them. Loaded once
 * per connection/session, then followed through plan/todo and execution pushes.
 */
export interface SessionPlanTodo {
  plan: SessionPlan | null;
  todos: SessionTodoItem[];
  planLoaded: boolean;
  planError: string | undefined;
  refreshPlan: () => Promise<void>;
}

export function useSessionPlanTodo(client: HostClient | undefined, sessionId: string | undefined): SessionPlanTodo {
  const ownerRef = useRef({ client, sessionId, refresh: undefined as (() => Promise<void>) | undefined });
  if (ownerRef.current.client !== client || ownerRef.current.sessionId !== sessionId) {
    ownerRef.current = { client, sessionId, refresh: undefined };
  }
  const owner = ownerRef.current;
  const [snapshot, setSnapshot] = useState({ owner, plan: null as SessionPlan | null,
    todos: [] as SessionTodoItem[], planLoaded: false, planError: undefined as string | undefined });

  useEffect(() => {
    const empty = { owner, plan: null, todos: [], planLoaded: false, planError: undefined };
    setSnapshot(empty);
    if (client === undefined || sessionId === undefined) return;
    let active = true;
    let connected = false;
    let connection = 0;
    let planOrder = 0;
    let todoOrder = 0;
    let pending: Promise<void> | undefined;
    let queued = false;
    let plan: SessionPlan | null = null;
    const current = () => active && connected && ownerRef.current === owner;
    const acceptPlan = (next: SessionPlan | null) => {
      if (next !== null && next.sessionId !== sessionId) return;
      if (next !== null && plan?.id === next.id && next.revision < plan.revision) return;
      plan = next;
      setSnapshot((state) => ({ ...state, plan, planLoaded: true, planError: undefined }));
    };
    const refresh = (): Promise<void> => {
      if (!current()) return Promise.resolve();
      const order = ++planOrder;
      if (!client.supportsCommand('plan/get')) {
        setSnapshot((state) => ({ ...state, planLoaded: true, planError: '当前 Host 未开放计划读取。' }));
        return Promise.resolve();
      }
      if (pending !== undefined) { queued = true; return pending; }
      const generation = connection;
      const task = client.request({ type: 'plan/get', sessionId })
        .then((response) => {
          if (!current() || generation !== connection || order !== planOrder) return;
          if (response.success) acceptPlan(readSessionPlan(response));
          else setSnapshot((state) => ({ ...state, planLoaded: true, planError: response.error }));
        })
        .catch((error: unknown) => {
          console.warn('[mobile] plan/get failed', error);
          if (current() && generation === connection && order === planOrder) {
            setSnapshot((state) => ({ ...state, planLoaded: true,
              planError: error instanceof Error ? error.message : '读取计划失败。' }));
          }
        })
        .finally(() => {
          if (pending !== task) return;
          pending = undefined;
          if (current() && queued) { queued = false; void refresh(); }
        });
      pending = task;
      return task;
    };
    owner.refresh = refresh;
    const unsubscribePush = client.subscribePush((push: HostPush) => {
      if (!current()) return;
      if (push.type === 'plan/updated' && push.sessionId === sessionId) {
        planOrder += 1;
        queued = false;
        acceptPlan(push.plan);
      } else if (push.type === 'plan/execution-updated' && push.state.sessionId === sessionId) {
        void refresh();
      } else if (push.type === 'todo/updated' && push.sessionId === sessionId) {
        todoOrder += 1;
        setSnapshot((state) => ({ ...state, todos: push.items }));
      }
    });
    const unsubscribeState = client.subscribeState((state) => {
      if (!active || ownerRef.current !== owner) return;
      const ready = state.kind === 'ready';
      if (connected === ready) return;
      connected = ready;
      connection += 1;
      planOrder += 1;
      todoOrder += 1;
      pending = undefined;
      queued = false;
      plan = null;
      setSnapshot(empty);
      if (!ready) return;
      void refresh();
      if (!client.supportsCommand('todo/get')) return;
      const generation = connection;
      const order = todoOrder;
      void client.request({ type: 'todo/get', sessionId }).then((response) => {
        if (current() && generation === connection && order === todoOrder && response.success) {
          setSnapshot((value) => ({ ...value, todos: readTodoItems(response.data) }));
        }
      }).catch((error: unknown) => console.warn('[mobile] todo/get failed', error));
    });
    return () => {
      active = false;
      owner.refresh = undefined;
      unsubscribePush();
      unsubscribeState();
    };
  }, [client, sessionId, owner]);

  const value = snapshot.owner === owner ? snapshot :
    { plan: null, todos: [], planLoaded: false, planError: undefined };
  return { plan: value.plan, todos: value.todos, planLoaded: value.planLoaded,
    planError: value.planError, refreshPlan: () => owner.refresh?.() ?? Promise.resolve() };
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
