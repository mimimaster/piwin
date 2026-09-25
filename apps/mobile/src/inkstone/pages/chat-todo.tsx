import { useState, type ReactElement } from 'react';
import type { SessionTodoItem } from '@piwin/contracts';
import { Icon } from '../icons.js';
import { todoProgressLabel } from '../host/use-session-plan-todo.js';

const STATUS_MARK: Record<SessionTodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  done: '●',
  cancelled: '–',
};

/** The agent's working checklist (Host `todo/*`), collapsed to the live item. */
export function ChatTodoStrip({ todos }: { todos: readonly SessionTodoItem[] }): ReactElement {
  const [open, setOpen] = useState(false);
  const current = todos.find((item) => item.status === 'in_progress') ?? todos.find((item) => item.status === 'pending');
  return (
    <div className="todo-strip">
      <button className="todo-head" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="check" />
        <b>待办 {todoProgressLabel(todos)}</b>
        <span className="todo-current">{current?.content ?? '全部完成'}</span>
        <Icon name="chevd" extra="chev" />
      </button>
      {open ? (
        <ul className="todo-list">
          {todos.map((item) => (
            <li key={item.id} className={item.status}>
              <span aria-hidden="true">{STATUS_MARK[item.status]}</span>
              {item.content}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
