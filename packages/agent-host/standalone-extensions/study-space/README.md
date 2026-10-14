# Study Space (optional standalone extension)

Canonical source: [mimimaster/piwin-study-space](https://github.com/mimimaster/piwin-study-space). Marketplace id: `mimimaster/piwin-study-space`. This tree is only the Host integration-test fixture; it is not bundled, auto-enabled, or the install path.

Original, dependency-free-at-runtime teaching extension for **Pi 0.84.2** in piwin. The Host supplies Pi's Extension API and `typebox` 1.1.38. There is no server, custom scheduler/FSRS, native-store access, application import, install script, or automatic enablement.

## What it is

A tutor that sits on the knowledge flywheel piwin already has. The unit of learning is a **wiki concept**, and each store keeps one job:

| Store | Job | Role while studying |
| --- | --- | --- |
| Knowledge bases (RAG) | raw sources | grounds explanations, cited as `[n]` |
| Wiki | what I have understood | every finished concept becomes a concept page |
| Flashcards | what I must retain | cards only for points actually answered wrong, pointing back at the concept page |
| Study Space | where I am | one thin progress file per topic |

The extension itself only selects a mode, adds mode rules to the system prompt, and keeps the progress file. The model does the work with the Host's own tools (`knowledge_search`, `wiki_read`, `wiki_write`, `flashcard_batch_create`, `flashcard_study_read`), directly or through `piwin_toolbox`.

## Commands

- `/learn [topic]`: start a topic, or continue a saved one with the same name. Without a topic it offers saved topics (most recent first) and "new topic".
- `/review`: due cards and re-teaching. Rating stays in the native flashcards panel; here the tutor re-explains cards rated Again/Hard.
- `/study`: dashboard above the composer: per topic, concepts written to the wiki, weak points, next concept.
- `/study save`: for the next turn only, distil the conversation so far into one wiki concept page.
- `/study off`: leave study mode. Progress, wiki pages and cards are kept.

A command selects the mode; the next message starts the turn (the widget above the composer says what to send). The 0.1 `/teacher*` commands are gone.

### The learn loop

1. No path yet: search the knowledge bases and read the wiki index, propose 3-7 concepts marked "wiki 已有 / 待建 / 无资料", save the path, begin the first concept.
2. Per concept: short grounded explanation, exactly one question, then feedback on what the user actually wrote. Where the sources have nothing, the tutor teaches from general knowledge and says so.
3. Closing a concept: `wiki_write` the page (with a "曾经的误解" section only for real mistakes), then mark it done with its page title and weak points.
4. Cards: at most 3 per concept, only for points answered wrong, with `deck` = topic name and `sourceFolder`/`sourceFile`/`sourceExcerpt` pointing at the concept page.

## Rules the extension enforces

- **Off by default.** Loading never activates anything; `study_space` rejects every call while off.
- **One confirmation for cards.** The Host asks for approval on every card-creating call (unless the user put the Host in bypass mode). The extension adds no dialog of its own.
- **`cards: never` is a hard stop.** After the user turns cards off, card-creating calls are blocked while study mode is on. Turning them back on needs a confirmation dialog.
- **Review is native.** `flashcard_study_write` is blocked while study mode is on; the flashcards panel owns rating and scheduling.
- **No mastery claims.** The dashboard counts concepts written and weak points recorded; there is no percentage.
- Everything else (reads, wiki, knowledge, unrelated tools, all tools while off) is untouched. The active toolset is never changed and no turn is started behind the Host.

## Own data

Only `${PIWIN_ROOT}/study-space` (fallback `~/.piwin/study-space`). One JSON file per topic: `topicId` (UUID), `topic`, `deck` (the topic name), ordered `concepts` (`name`, `status: planned|learning|done`, `wiki` page title, `weak` points) and `updatedAt`. `preferences.json` holds `cards: ask|never`. The extension never reads or writes the wiki or the card library.

`study_space` actions: `get`, `plan` (`concepts`), `concept` (`name`, optional `status`/`wiki`/`weak`), `preference` (`cards`). The schema is one flat top-level object, and unknown fields are rejected. A concept cannot be marked done without its wiki page title. Re-planning keeps concepts already in progress or done.

Writes take an exclusive cross-process `.write-lock` directory plus revision CAS, an exclusive temp file, fsync, atomic rename and directory fsync. Malformed JSON, unknown versions, symlinks and injected ids fail instead of being reset. A lock left by a crashed process is never taken over: confirm no writer is running, back up, then remove `.write-lock` / `.tmp-*` by hand.

0.1 course files (schemaVersion 1) are left on disk and ignored; nothing is migrated. A 0.1 `preferences.json` is treated as `ask` until rewritten.

## Known limits

- Study mode does not survive a rebuilt runtime: the Host gives each rebuilt Pi session a new identity, so the mode starts off and `/learn` resumes the topic by name.
- A command cannot start the turn itself; that needs a Host capability.
- `/review` cannot open the flashcards panel for the user.

## Development / verification

With the declared dev tools available:

```sh
pnpm test
pnpm typecheck
```

No parent tsconfig, main-repo runtime import, vendor code, node_modules or lockfile is part of this directory. Unit tests use a mock Pi API and disposable data roots, including real parallel child-process lock/CAS writers. piwin's host-runtime integration test runs this same extension under the real Pi SDK and a spawned RPC worker with a scripted local model wire and real native cards. Neither proves real-model teaching quality or Desktop visuals.
