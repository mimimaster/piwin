# ADR 0077: Community extensions ship through a GitHub registry repository

| Field | Value |
|-------|-------|
| Status | **Accepted** |
| Date | 2026-09-27 |
| Extends | [ADR 0047](./0047-managed-pi-extension-activation.md), [ADR 0060](./0060-pi-native-package-follow.md) |
| Supersedes | [marketplace-capability-delivery §2](../specs/marketplace-capability-delivery.md) non-goal "no piwin hosted market" |
| Guide | [Publishing to the extension registry](../guides/extension-registry.md) |

## Context

Owner direction (2026-09-27): users must be able to publish their own Pi
Extensions — including modified copies of other people's extensions — and the
marketplace search must find and install them directly. Only extensions are in
scope; Skills and MCP stay on their existing channels.

A hosted service would need accounts, upload storage, moderation tooling and
an operator. A GitHub repository already provides identity (GitHub accounts),
review (pull requests), audit history (git), CI (Actions) and a CDN (Pages).

## Decision

### 1. The registry is a GitHub repository, not a service

Default registry: `mimimaster/piwin-extensions`. Contributors add or update one
file per extension through a pull request:

```
extensions/<owner>/<name>.json
```

`<owner>` is the publisher's GitHub user or organization (lowercase). The
extension id is `<owner>/<name>`. On merge, CI builds `index.json` and deploys
it to GitHub Pages. piwin reads only that generated index.

piwin never stores accounts. GitHub identity is the only identity.

### 2. Entries point at source; they never contain source

An entry names a repository, an optional subdirectory and a list of versions.
Each version pins a **full 40-hex commit SHA**. Tags and branches are refused
because they can move. The commit is the integrity pin: Host fetches exactly
that commit and verifies `HEAD` before staging.

Code stays in the author's repository. If the author deletes it, installs of
that version fail loudly; nothing is silently substituted.

### 3. Ownership and forks are CI rules

The registry CI runs on `pull_request_target`, checks out **only the base
branch**, and reads the PR's changed files through the GitHub API as data. No
file from the PR is executed. It reports through a PR comment and the check
status, and enforces:

| Change | Rule |
|---|---|
| New entry | PR author equals `<owner>`, or is a public member of org `<owner>`; PR author is in `owners` |
| Edit entry | PR author is in the base entry's `owners` |
| Versions | Append-only; a published `version → commit` pair never changes. Yank is the only mutation. `build-index` sorts versions newest first |
| Fork | A new entry under the forker's own `<owner>`, with `forkOf: { id, version }` that is not the entry itself; the base entry and version must exist and its license must permit modification. The CI comment links the original and the modified commit |
| Paths | A PR may only touch `extensions/**` |
| Source shape | The pinned tree has `index.ts` (or the subdir is a `.ts` file), no symlinks, no `package.json` `dependencies`, no install lifecycle scripts |

Maintainers merge new extensions by hand. Owner version bumps with green CI
may be merged without further review.

### 4. piwin consumes the index as a third search source

- `@piwin/contracts` defines `ExtensionRegistryIndex`/`ExtensionRegistryEntry`
  and `ExtensionInstallSource = InstallSource | { kind: 'registry'; id; version? }`.
- `@piwin/marketplace` parses the untrusted index (fail closed per entry),
  searches it, and resolves `id@version` to a pinned Git source. Registry hits
  come first in `marketplace/search` and hide npm/GitHub duplicates of the same
  repository.
- `extensions/install` accepts `{ kind: 'registry' }`. Host resolves it to
  `{ url, subdir, commit }` and stages it through the existing immutable
  revision store (ADR 0047). There is no generic `marketplace/install`.
- Installed id is `<owner>-<name>` so an original and its fork never overwrite
  each other's revisions.
- Registry URL: `PIWIN_EXTENSION_REGISTRY_URL` overrides the default. A team can
  fork the registry repository and point piwin at its own Pages URL.

Registry installs are managed extensions, never `pi install`: no npm, no
lifecycle scripts, no writes to `~/.pi/agent/settings.json`.

### 5. Web front end and submission

GitHub Pages serves a static site (`site/`, no framework) next to
`index.json`. It lists and searches the index in the browser and shows an
extension's owners, license, versions, pinned commits, fork base and install
command. Publishing has two routes.

**One-click upload (primary).** The author signs in with GitHub, drops the
extension folder, a zip, or a single `.ts` file, confirms the metadata the
page read from `package.json`, and presses publish. With the author's own
token the page:

1. creates `<author>/piwin-<slug>` (public, topics `pi-package`,
   `piwin-extension`) and pushes the upload as one commit (Git Data API; text
   files inline in the tree, binaries as blobs; a README and, for MIT, a
   LICENSE are added when missing);
2. forks the registry, syncs the fork, creates a branch, writes
   `extensions/<author>/<slug>.json` pinned to that commit;
3. opens the PR upstream.

A new version is the same from the extension page: the upload replaces the
source (inside `subdir` when the entry has one; README, LICENSE and
`.github/` survive at the root) and the PR adds the version. Before anything
is written, the page runs the CI's own rule modules (`entry.mjs`,
`source-rules.mjs`) on the upload. The registry owner cannot fork their own
repository, so for them the page branches upstream.

Every write carries the author's identity, so **the PR author is the
submitter** and the CI ownership rules keep their meaning. The code still
lives in the author's account (§2); the registry still stores only entries.

**Sign-in.** A GitHub OAuth App with scope `public_repo`. The page sends the
user to GitHub's authorize page with a random `state` and a PKCE challenge,
both kept in `sessionStorage`, and checks `state` on return. The code is
exchanged by a Cloudflare Worker (`worker/`), because the exchange needs the
client secret and GitHub's token endpoint does not allow browser CORS. The
Worker answers only the Pages origin, forwards only the code (and PKCE
verifier), stores nothing and logs nothing. The token lives in the tab's
`sessionStorage` only; the page explains the scope and links GitHub's
revocation page. CSP limits the page to GitHub's API, raw content and
`*.workers.dev`.

Scope trade-off: `public_repo` lets the page write any of the user's public
repositories, which is more than publishing needs. It is the narrowest OAuth
scope that can create a repository, fork, push and open a PR. We accept it
because the token never leaves the user's browser tab except for GitHub.

Why not a GitHub App: its user tokens act only where the app is installed.
Creating a repository in the author's account and pushing to their fork would
require every author to install the app on their account first, an extra
consent screen with a repository picker, for no narrower effective access in
this flow. The OAuth App is one consent screen.

**Fallback without sign-in.** The manual form (`#/submit/manual`) builds the
entry for code already on GitHub, validates it with the same rules, and opens
GitHub's new-file page prefilled:

```
https://github.com/mimimaster/piwin-extensions/new/main/extensions/<github-user>
  ?filename=<name>.json&value=<URL-encoded entry JSON>
```

GitHub forks and opens the PR as the submitter. When the URL would be too
long, the page copies the JSON and opens the new-file page with only the
filename. Organization namespaces use this route.

### 6. Trust wording

Registry entries passed structural CI checks and a human merge. That is not a
security review. Desktop shows the owner, the pinned commit and a fork's base,
and the confirmation dialog states that the extension runs with the Host
user's OS privileges.

## Consequences

- Publishing costs one PR; there is no service to operate.
- Removal works by yanking a version (`yanked: { reason }`); yanked versions are
  hidden from search and refused on install.
- Entry rules live in two repositories: the strict CI validator
  (`scripts/lib/entry.mjs`, also served to the web front end) and the lenient
  untrusted-input parser in `@piwin/marketplace`. They share
  `schema/fixtures/` (copied to `packages/marketplace/src/registry/fixtures/entries/`):
  both accept `valid/`, both reject `invalid/`, and only the CI rejects
  `invalid-strict/`. The parser's tests also read real `build-index.mjs`
  output. A rule change on either side fails a test until both agree.
- A deleted upstream repository breaks installs of its versions. Mirroring
  artifacts into registry Releases is deferred until that happens in practice.

## Alternatives rejected

| Option | Why rejected |
|---|---|
| Hosted registry with accounts | Operator burden; GitHub already provides identity and review |
| Single hand-edited `index.json` | Every PR conflicts with every other PR |
| Pin tags or branches | Mutable; a force-push swaps the code under a reviewed entry |
| Registry installs via `pi install` | Runs npm lifecycle scripts as the Host user |
| Tarballs attached by authors | Author-supplied hashes prove nothing; the commit pin already does |
| A bot account opens PRs for web submissions | The PR author would always be the bot, so "PR author owns `<owner>`" stops identifying anyone; it also needs a stored token and a server |
| GitHub App instead of an OAuth App | Every author would have to install it on their own account before publishing; no narrower access for this flow (§5) |
| Upload the code into the registry repository | Turns the registry into a code host with its own size, moderation and deletion problems; code stays in the author's account |
| CI on `pull_request` with the head checked out | A PR could change the scripts that judge it; `pull_request_target` with base-only checkout keeps the rules out of the submitter's reach while still allowing PR comments |
