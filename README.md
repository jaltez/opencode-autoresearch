# OpenCode Autoresearch

OpenCode Autoresearch is an OpenCode plugin for running benchmark-driven experiment loops. It gives an agent a structured way to create a session, run the canonical benchmark, parse `METRIC` output, keep or discard changes, preserve experiment memory, and split kept work into review branches.

This project is inspired by `pi-autoresearch`, but it is implemented as an OpenCode server and TUI plugin. The compatibility target is user-visible behavior and invariants rather than the original internal storage format.

## Status

- Runtime: Bun and TypeScript.
- NPM plugin package: `@jaltez/opencode-autoresearch`.
- Internal subpath exports: `@jaltez/opencode-autoresearch/server` and `@jaltez/opencode-autoresearch/tui`.
- Session source of truth: `autoresearch.jsonl` plus generated `autoresearch.state.json`.
- Current validation command: `bun run check`.

## Install And Build

```sh
bun install
bun run build
bun run check
```

The package exports built files from `dist`, so run `bun run build` before packing or loading the package from a built artifact. `prepack` also runs the build automatically.

## Install In OpenCode

Install into the current project:

```sh
cd /path/to/project
opencode plugin @jaltez/opencode-autoresearch
```

Install globally:

```sh
opencode plugin -g @jaltez/opencode-autoresearch
```

OpenCode writes the plugin spec into the matching config scope:

- Project install updates `.opencode/opencode.json` and `.opencode/tui.json`.
- Global install updates `~/.config/opencode/opencode.jsonc` and `~/.config/opencode/tui.json`.

If you are installing a very fresh publish and Bun is enforcing a package age policy, prefix the install command with `npm_config_min_release_age=0`:

```sh
npm_config_min_release_age=0 opencode plugin @jaltez/opencode-autoresearch
npm_config_min_release_age=0 opencode plugin -g @jaltez/opencode-autoresearch
```

## OpenCode Entry Points

Configure OpenCode to load the published package when you want the server tools plus the dashboard UI:

```json
{
  "plugin": [
    "@jaltez/opencode-autoresearch"
  ]
}
```

For local development from a checkout, point OpenCode at the package directory instead:

```json
{
  "plugin": [
    "file:."
  ]
}
```

OpenCode installs npm plugins by package name. Npm subpath entries such as `@jaltez/opencode-autoresearch/server` and `@jaltez/opencode-autoresearch/tui` are package exports, but they are not valid values in `opencode.json`.

The server plugin injects an `autoresearch` agent and these commands:

- `autoresearch` for status, pause, resume, backup, restore, export, clear, and mode control.
- `autoresearch-create` for scaffold creation.
- `autoresearch-finalize` for review branch planning and creation.
- `autoresearch-hooks` for hook scaffolding.

The TUI plugin adds a sidebar summary, prompt status, dashboard route, and command palette actions for common control operations.

## Session Files

Autoresearch keeps its own state in the target workspace or configured work directory:

- `autoresearch.jsonl`: append-only session log.
- `autoresearch.state.json`: regenerated state snapshot.
- `autoresearch.md`: session objective and rules.
- `autoresearch.ideas.md`: backlog for deferred hypotheses.
- `autoresearch.sh`: canonical benchmark entrypoint.
- `autoresearch.checks.sh`: optional backpressure checks.
- `autoresearch.config.json`: optional runtime config such as `maxIterations`.
- `autoresearch.hooks/before.sh` and `autoresearch.hooks/after.sh`: optional executable hooks.
- `.autoresearch.backups`: managed backups for recovery.

When `autoresearch.sh` exists, `run_experiment` requires the canonical entrypoint. Harmless wrappers such as `env`, `time`, `nice`, `nohup`, and `bash` are accepted; shell chaining and ad hoc benchmark commands are rejected.

## Experiment Loop

1. Create or initialize a session with `autoresearch-create` or `init_experiment`.
2. Run the benchmark with `run_experiment`.
3. Emit metrics from the benchmark using `METRIC name=value`, optionally followed by a unit or direction.
4. Run configured checks or `autoresearch.checks.sh`.
5. Decide with `log_experiment`: `keep`, `discard`, `retry`, or `pending`.
6. Let auto-resume continue while the session is active and below `maxIterations`.

Examples of accepted metric output:

```text
METRIC accuracy=0.91 higher
METRIC latency_ms=120 ms lower
METRIC total_us=15200 us lower
```

Benchmark timeouts default to 600 seconds and are recorded as `crashed` with exit code 124. Check timeouts default to 300 seconds and are recorded as `checks_failed` with exit code 124. Both can be overridden per run with `timeout_seconds` and `checks_timeout_seconds`.

Kept runs are committed when the work directory is inside a git repository. Commit messages include JSON trailers:

```text
Autoresearch-Result: {"runId":"...","iteration":1,"status":"kept","decision":"keep"}
Autoresearch-Metrics: [{"name":"accuracy","value":0.91,"higherIsBetter":true}]
```

If git is unavailable, keep decisions are still recorded without a commit. If git commit fails, the run remains pending so the issue can be fixed and retried.

## Hooks

Hooks are optional executable scripts. Non-executable hook files are skipped.

- `before` runs before the benchmark command.
- `after` runs after `log_experiment` applies the decision and git action.

Hooks receive JSON on stdin with the event name, cwd, session snapshot, and run details when available. Hook stdout and stderr are capped at 8KB with UTF-8-safe truncation. JSON stdout can provide a concise `message` field for agent steering.

## Finalize

`autoresearch-finalize` groups kept runs by overlapping changed files. With branch creation enabled, it creates review branches from the parent of the oldest kept commit, applies each group, commits it, verifies no autoresearch artifacts leaked, and checks that the union of created branches matches the final autoresearch branch.

Finalize handles modified, added, renamed, and deleted files. Dirty worktree state is stashed before branch creation and restored afterward.

## Durability And Recovery

Autoresearch blocks loop mutations when the source-of-truth JSONL is missing or invalid. Use:

- `autoresearch status` to inspect durability warnings.
- `autoresearch backup` to preserve current artifacts.
- `autoresearch backups` to list saved backups.
- `autoresearch restore` to restore the latest or requested backup.
- `autoresearch export` to write `autoresearch.dashboard.html`, including recovery warnings.

Backups are kept under `.autoresearch.backups` and are preserved by destructive clears.

## Development

```sh
bun run typecheck
bun test
bun run check
```

Keep changes focused and add tests around any behavior that affects session durability, git operations, hook execution, metrics parsing, or auto-resume semantics.

## License

MIT License. See [LICENSE](LICENSE).
