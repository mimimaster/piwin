# Session cold storage (ADR 0044)

Manual backup, offload, and restore of archived session payloads.

This is **not** ADR 0040 runtime cold. Runtime cold means the chat history is
still on the Host and opening it does not start a Pi worker. Storage offload
means the transcript and media have left `~/.piwin` and live in a verified
external pack.

## What stays local

Offload moves only:

```text
transcript.sqlite3 (+ wal/shm)
media/<sessionId>/**
```

`plan.json`, walkthroughs, exports, and other non-payload files remain under
`~/.piwin/sessions/<sessionId>/`. The session stays in list/search as a stub.

Piwin **never** auto-deletes the external pack. Drive / NAS / Finder cleanup is
yours.

## Archive first

```text
archive the main session
        ↓
create / verify a pack   (optional backup, no mutation)
        ↓
plan + confirm offload   (only after a verified publish)
        ↓
restore from pack        (before any resume / prompt / export)
```

Cold storage does not archive for you. Live, pinned, side-chat, or unarchived
sessions are not eligible.

## Host path semantics

`packOutputDir` and every `--pack` / `--out` / `--dir` argument is a **Host**
filesystem path.

- Local sidecar: a path on this machine.
- Remote Host: a path on the Host machine, not the Desktop/CLI client.
- Must be absolute.
- Must **not** sit under `~/.piwin` (or the configured piwin root).

Desktop Settings → Agent → **冷存储 / Cold storage** labels this as the Host
output directory. Browse… talks to the Host, not the client disk.

Treat iCloud / Drive / NAS folders as untrusted until **both** the
`.piwin-pack` and its `.sha256` sidecar exist and verify. A half-synced file
must not be used to authorize offload or restore.

## Desktop

Settings → Agent → **冷存储**:

| Control | Role |
|---------|------|
| Enable | Required before plan/execute |
| Host output directory | External publish directory |
| Minimum archived age | Planner default (explicit session plans skip it) |
| Local budget | Status only; never auto-offloads |

Save the config before execute. Execute stays disabled until the saved config
is valid and the current Host plan digest is present. There is no schedule,
dry-run toggle, include-media toggle, or force-replace control.

Session list badges:

- **已卸载 / Offloaded** — restore before open
- **缺包 / Missing pack** — choose a matching pack first

Clicking an offloaded row does **not** call `session/resume`. A restore dialog
runs first so an empty local transcript is never created.

## CLI

Talk to the same Host. Do not point a second `HostRuntime` at the same
`~/.piwin` while Desktop or `piwin host serve` is using it.

```bash
# Non-destructive backup (payload stays local)
piwin session pack create <sessionId> --out /Volumes/Backup/piwin-packs
piwin session pack verify /Volumes/Backup/piwin-packs/<pack>.piwin-pack
piwin session pack list --dir /Volumes/Backup/piwin-packs

# Status / plan / confirm
piwin session cold status
piwin session cold plan
piwin session cold plan --session <sessionId>
piwin session cold execute --plan <plan-id> --confirm <digest>

# Restore / import / crash recovery
piwin session cold restore <sessionId>
piwin session cold restore <sessionId> --pack /Volumes/Backup/piwin-packs/<pack>.piwin-pack
piwin session cold import --pack /Volumes/Backup/piwin-packs/<pack>.piwin-pack
piwin session cold reconcile
```

`plan` lives only in that Host process for about 10 minutes. A Host restart
invalidates it. Re-run `plan` and use the new digest. Execute re-checks that
the local payload still matches the planned hashes (after a WAL checkpoint).

## Missing pack

`missing-pack` means the index stub still exists, but the recorded pack is
gone or unreadable.

1. Put the matching `.piwin-pack` **and** `.sha256` sidecar on a Host path.
2. Restore with that path (`--pack` or Desktop “Choose pack and restore”).
3. If the index stub itself is gone, `import` recreates the record from a
   **validated** manifest. It does not invent an empty transcript.

If restore reports `session-storage-conflict`, a local body already exists. R1
will not overwrite it.

## Residual journals and doctor

Journals live at:

```text
~/.piwin/cold-storage/transactions/<tx-id>/journal.json
```

Quarantined payload (mid-move) sits next to the journal under `payload/`.
Host startup recovers journaled transactions only:

| Journal phase | Startup action |
|---------------|----------------|
| published, payload still local | leave local as authority |
| payload-moved, index still local | move quarantine back |
| indexed, quarantine remains | delete quarantine; pack is authority |
| unknown split-brain | report only |

```bash
piwin doctor
```

Doctor prints a `session cold storage` block: enabled flag, Host output dir,
residual journals, and missing-pack session ids. It does **not** mutate.
Use `piwin session cold reconcile` (or Desktop 对账) to recover leftover
journals and recheck packs.

## What R1 will not do

- Automatically offload on a schedule
- Archive for you (`archiveFirst`)
- Offload from an older pack (`--from-pack`)
- Force-replace a local transcript
- Permanently delete the index stub
- Delete the external pack
- Create an empty `transcript.sqlite3` so the session “looks openable”

## Related

- ADR: [`0044-safe-session-cold-storage.md`](../adr/0044-safe-session-cold-storage.md)
- Runtime cold (different): [`session-runtime-residency.md`](./session-runtime-residency.md)
- Plan: [`2026-08-12-session-cold-storage-r1.md`](../plans/2026-08-12-session-cold-storage-r1.md)
