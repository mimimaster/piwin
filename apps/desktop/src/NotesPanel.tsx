import { useCallback, useEffect, useState } from 'react';
import type {
  HostResponse,
  NoteRecord,
  NoteSearchHit,
  NoteSearchMode,
  RecallEvalReport,
} from '@piwin/contracts';

export type NotesPanelProps = {
  request: (command:
    | { type: 'notes/list'; collection?: string }
    | { type: 'notes/read'; noteId: string }
    | { type: 'notes/search'; query: { query: string; limit?: number; mode?: NoteSearchMode } }
    | { type: 'notes/write'; input: { title: string; content: string; collection?: string; tags?: string[] } }
    | { type: 'notes/update'; input: { id: string; title?: string; content?: string } }
    | { type: 'notes/delete'; noteId: string }
    | { type: 'notes/reindex' }
    | { type: 'notes/eval-run'; k?: number }
    | { type: 'notes/eval-history' }
  ) => Promise<HostResponse>;
};

/**
 * Notes library panel (ADR 0018 S6): list / hybrid search with channel badges /
 * view / edit / create / delete / reindex / retrieval-quality report.
 */
export function NotesPanel(props: NotesPanelProps) {
  const [records, setRecords] = useState<NoteRecord[]>([]);
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const [selected, setSelected] = useState<NoteRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<NoteSearchMode>('auto');
  const [evalReports, setEvalReports] = useState<RecallEvalReport[] | null>(null);
  const [evalHistory, setEvalHistory] = useState<RecallEvalReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    const response = await props.request({ type: 'notes/list' });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { records: NoteRecord[] };
    setRecords(data.records ?? []);
  }, [props]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  async function handleSearch(): Promise<void> {
    setError(null);
    const query = searchQuery.trim();
    if (!query) {
      setHits(null);
      return;
    }
    const response = await props.request({
      type: 'notes/search',
      query: { query, limit: 20, mode: searchMode },
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { hits: NoteSearchHit[] };
    setHits(data.hits ?? []);
  }

  async function handleOpen(noteId: string): Promise<void> {
    setError(null);
    const response = await props.request({ type: 'notes/read', noteId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { record: NoteRecord };
    setSelected(data.record);
    setEditing(false);
    setCreating(false);
  }

  async function handleSave(input: { title: string; content: string }): Promise<void> {
    setBusy(true);
    setError(null);
    const response = creating
      ? await props.request({ type: 'notes/write', input })
      : await props.request({
          type: 'notes/update',
          input: { id: selected?.id ?? '', ...input },
        });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { record: NoteRecord };
    setSelected(data.record);
    setEditing(false);
    setCreating(false);
    setInfo(creating ? 'Note created' : 'Note saved');
    await loadNotes();
  }

  async function handleDelete(noteId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'notes/delete', noteId });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setSelected(null);
    setInfo('Note deleted');
    await loadNotes();
  }

  async function handleReindex(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'notes/reindex' });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo('Index rebuilt');
  }

  async function handleEvalRun(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await props.request({ type: 'notes/eval-run', k: 5 });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { reports: RecallEvalReport[] };
    setEvalReports(data.reports ?? []);
  }

  async function handleEvalHistory(): Promise<void> {
    if (evalHistory !== null) {
      setEvalHistory(null); // toggle off
      return;
    }
    setError(null);
    const response = await props.request({ type: 'notes/eval-history' });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { runs: RecallEvalReport[] };
    setEvalHistory(data.runs ?? []);
  }

  const displayList = hits !== null ? hits.map((hit) => hit.note) : records;

  return (
    <div className="settings-section" data-testid="notes-panel">
      <div className="settings-card-heading">
        <div>
          <h4>Notes</h4>
          <p>Local-first notes under ~/.piwin/notes (markdown is truth; index is cache).</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {info ? <p className="muted">{info}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSearch();
          }}
          placeholder="Search notes… (CJK-aware, hybrid when embedding configured)"
          data-testid="notes-search-input"
          style={{ flex: 1 }}
        />
        <select
          value={searchMode}
          onChange={(event) => setSearchMode(event.target.value as NoteSearchMode)}
          data-testid="notes-search-mode"
          title="Retrieval mode"
        >
          <option value="auto">auto</option>
          <option value="fts">fts</option>
          <option value="vector">vector</option>
          <option value="hybrid">hybrid</option>
        </select>
        <button type="button" className="btn" onClick={() => void handleSearch()}>
          Search
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setHits(null);
            setSearchQuery('');
            void loadNotes();
          }}
        >
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          data-testid="notes-new"
          onClick={() => {
            setSelected(null);
            setCreating(true);
            setEditing(true);
          }}
        >
          New note
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void handleReindex()}>
          Rebuild index
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void handleEvalRun()}>
          Run recall eval
        </button>
        <button type="button" className="btn" onClick={() => void handleEvalHistory()}>
          {evalHistory !== null ? 'Hide history' : 'Eval history'}
        </button>
      </div>

      {evalHistory !== null ? (
        <div data-testid="notes-eval-history" style={{ marginTop: 10 }}>
          <strong>Eval run history</strong>
          {evalHistory.length === 0 ? (
            <p className="muted">No runs yet — run a recall eval first.</p>
          ) : (
            <ul className="muted">
              {evalHistory.map((run, index) => (
                <li key={`${run.runAt}-${index}`}>
                  {run.runAt.slice(0, 16).replace('T', ' ')} · {run.mode} · recall@{run.k}{' '}
                  {run.recallAtK.toFixed(3)} · mrr {run.mrr.toFixed(3)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {evalReports ? (
        <div data-testid="notes-eval-report" style={{ marginTop: 10 }}>
          <strong>Retrieval quality (recall@5 / MRR)</strong>
          <ul className="muted">
            {evalReports.map((report) => (
              <li key={report.mode}>
                {report.mode}: recall {report.recallAtK.toFixed(3)} · mrr {report.mrr.toFixed(3)} ·{' '}
                {report.cases} case(s)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <NoteEditor
          initialTitle={creating ? '' : selected?.title ?? ''}
          initialContent={creating ? '' : selected?.content ?? ''}
          busy={busy}
          onSave={(input) => void handleSave(input)}
          onCancel={() => {
            setEditing(false);
            setCreating(false);
          }}
        />
      ) : selected ? (
        <div className="settings-card" data-testid="notes-detail" style={{ marginTop: 10 }}>
          <strong>{selected.title}</strong>
          <span className="muted">
            {' '}
            · {selected.collection} · {(selected.tags ?? []).join(', ')}
          </span>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{selected.content}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void handleDelete(selected.id)}
            >
              Delete
            </button>
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : displayList.length === 0 ? (
        <p className="muted">
          No notes yet. Create one here, via chat (note_write), or drop .md files into
          ~/.piwin/notes/.
        </p>
      ) : (
        <ul className="provider-list" data-testid="notes-list" style={{ marginTop: 10 }}>
          {displayList.map((record, index) => {
            const hit = hits?.[index];
            return (
              <li key={record.id}>
                <button
                  type="button"
                  className="btn ghost"
                  style={{ textAlign: 'left', width: '100%' }}
                  onClick={() => void handleOpen(record.id)}
                >
                  <strong>{record.title}</strong>
                  <span className="muted"> · {record.collection}</span>
                  {hit ? (
                    <span className="pill" style={{ marginLeft: 6 }}>
                      {hit.channels.join('+')}
                    </span>
                  ) : null}
                  <br />
                  <span className="muted">
                    {(hit?.snippet ?? record.content).slice(0, 140)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function NoteEditor(props: {
  initialTitle: string;
  initialContent: string;
  busy: boolean;
  onSave: (input: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(props.initialTitle);
  const [content, setContent] = useState(props.initialContent);
  return (
    <div className="settings-card" data-testid="notes-editor" style={{ marginTop: 10 }}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
        data-testid="notes-editor-title"
        style={{ width: '100%', marginBottom: 8 }}
      />
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Markdown content…"
        data-testid="notes-editor-content"
        rows={10}
        style={{ width: '100%' }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn primary"
          disabled={props.busy || !title.trim() || !content.trim()}
          data-testid="notes-editor-save"
          onClick={() => props.onSave({ title: title.trim(), content })}
        >
          Save
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
