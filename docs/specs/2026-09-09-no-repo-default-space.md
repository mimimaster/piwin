# No Repo default space

| Field | Value |
|---|---|
| Status | Implemented in Desktop |
| Date | 2026-09-09 |

## Decision

Desktop presents the product-owned General session scope as a permanent `No Repo`
folder at the top of the Projects section. It is the default scope on startup;
its sessions use the existing Host-owned `~/.piwin/workspace` directory.

`No Repo` is a navigation item, not a registered or trusted `ProjectRecord`.
It must not be removable, must not inherit project instructions or permissions,
and must continue to use the existing `{ kind: 'general' }` session contract.

Opening a real project still switches to its project scope. Selecting `No Repo`
returns to General and hydrates the existing General session list. New sessions
created from its plus action also use the General scope.

The separate top-level repository picker bar is not part of this design.

No Repo is a compact default-space entry with a folder icon and a new-session
action. General history remains in the independent Conversations section below
Projects, with its original date grouping, full resident list, collapse control,
and new-conversation action. Selecting No Repo or collapsing Projects must not
hide Conversations. General sessions are not duplicated beneath No Repo.
