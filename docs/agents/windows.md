# Working on this repo from Windows

- Search with `git grep -n -E`; `rg` is not on the `pwsh` PATH.
- PowerShell 5.1 rejects `&&`; chain dependent commands with `; if ($LASTEXITCODE -eq 0) { ... }`.
- Git worktrees share `node_modules` through a directory junction. Teardown order: stop any subagent using the worktree -> `cmd /c rmdir "<worktree>\node_modules"` -> `git worktree remove "<worktree>"` -> `git branch -d <branch>`. Run `bun install` / `bun add` only in the main checkout, never through a junction.
- Multi-line `gh issue create` bodies: write the Markdown to a scratch file and pass `--body-file <file>` rather than bash heredocs.
- Run at most 2 heavy implementation subagents at once, to stay clear of `429 RESOURCE_EXHAUSTED` quota errors.
- Vite sometimes reads a file mid-save and serves it empty or stale ("does not provide an export named X", or an edit that doesn't show). Bump the file's `LastWriteTime` and reload.
- Screenshots: `bun scripts/shots.ts "http://localhost:5173/..."` (positional URL, `localhost` not `127.0.0.1` — Vite binds `::1`; see `--help`).
- Deploy: `scripts/deploy.ps1` (production; only after the owner says "ship").
