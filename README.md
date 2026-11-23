# dsh-plugin-subagent-tree

A **subagent tree** tab for every DeepSeek Harness (DSH) Session: detached subagents, a read-only Session tree, and a seat ledger, in one place.

> 中文说明见 [README.zh.md](README.zh.md).

## Why "detached"

A native DSH subagent is recorded in its parent Session's log as a `subagent/catalog` event — an append-only projection. That entry can be neither edited nor removed, and deleting the child's Session file leaves a dangling row in the parent window.

This plugin decouples at creation time instead: a subagent is a standalone Session (no `parentSession` header) whose ownership lives only in the plugin ledger at `~/.dsh/subagent-admin.json`. Deleting, renaming, or stopping it touches the ledger and that Session only — never another window's structure.

## Install

```bash
plugin_manager install_bundle target=/path/to/subagent-tree
```

Or point **Plugins → Add plugin** at the local directory. Open a new Session afterwards; the Session header gains a `subagent tree` tab.

Requires DSH `>=0.2.2-rc.3`.

## Use

### Panel

- **Spawn**: type a task in the box and press the button. The child cannot see this conversation, so make the task self-contained.
- **Per row**: open (jump to that Session) / preview (inline transcript) / stop (current turn only) / rename / hide (soft delete: ledger plus archive, files untouched) / restore.
- **Right-click menu**: the same actions plus copy Session id and copy last answer.
- **Collapsible sections**: click a section header to fold it; the state is kept in the browser.
- **Seat ledger**: add, remove, retire, revive — a ledger only, it never touches Sessions.
- **Status table**: only "active" statuses render (running/idle/done by default); stopped or archived rows vanish on refresh unless you tick "显示已停".
- **Status bar**: on a detached subagent's page only, a bar under the tabs shows the badge and returns to the parent Session.

### Tools

| Tool | Purpose |
|---|---|
| `spawn_agent` | Start a detached subagent. `task` required; `label`; `start=false` for an idle seat; `wait` (default true) returns the final answer; `timeout_ms` |
| `manage_subagents` | `list` / `stop` / `rename` / `hide` / `restore` — ledger and child Session only |
| `subagent_tree` | Read-only native Session tree for this Session (or all), plus the detached list |
| `subagent_seat` | Seat ledger: `list` / `bind` / `rename` / `retire` / `revive` / `remove` |

When a child finishes, its final answer is posted back to the owning Session as a message (`notifyOnComplete` turns this off).

## Configuration

Set it in the profile's `cordis.patch.yml`; reload the plugin to apply:

```yaml
- insert:
    - id: subagent-tree
      name: dsh-plugin-subagent-tree
      config:
        ledgerPath: ''          # ledger file; default $DSH_HOME/subagent-admin.json
        sessionRoot: ''         # sessions directory; default $DSH_HOME/sessions
        maxDepth: 3
        defaultTimeoutMs: 600000
        maxWaitMs: 1800000
        notifyOnComplete: true
        renderStatuses: [running, idle, done]
        allowPreview: true
        allowOpen: true
```

Invalid values never throw: wrong types fall back to defaults and numbers are clamped.

Every path is derived, never hard-coded: defaults follow `DSH_HOME` (or `~/.dsh`), and `ledgerPath` / `sessionRoot` move the data anywhere you like. Relative values resolve against the process working directory, so the same package works from any profile or drive.

## Limits and known trade-offs

- **Never rewrites DSH Session logs**: no `subagent/catalog` events, no structural writes to any window.
- **Soft delete**: `hide` marks the ledger and archives the Session via `workspaceRegistry`; files stay and `restore` brings it back.
- Detached subagents are not attached to a workspace (they do not appear in the sidebar); the panel manages them.
- **The HTTP routes serve the local page only**: loopback Host, same-origin `Origin`, and an `x-subagent-admin: 1` header. That blocks cross-site pages; another local process is assumed trusted.
- **The status bar is the one element mounted on `document.body`**: no full-width slot exists below the tab row and the header slot clips overlays, so this bar is portaled there and removed with the component. Every other control is a slot registration.
- Native subagents still cannot be removed from a window's catalog — that projection is append-only by design; the plugin offers a read-only tree and "stop" only.
- Disabling the plugin removes the tab, tools and routes; existing child Sessions and the ledger stay on disk and running children are not killed.
- Panel copy is zh/en; plugin metadata ships eight locales in `locale/`.

## Layout

```
index.js            Host entry: tools, HTTP routes, completion watcher
client.js           Browser entry: Session view and status bar
lib/config.mjs      Config normalization
lib/guard.mjs       Route guard
lib/manage.mjs      Spawn, stop, rename, hide, restore
lib/registry.mjs    Subagent ledger
lib/seats.mjs       Seat ledger
lib/paths.mjs       Ledger and session-root resolution ($DSH_HOME plus config)
lib/scan.mjs        Session-header scan and tree build
lib/shape.mjs       Tree presentation shape
docs/               Plugin detail document and preview image
locale/             Eight-locale plugin metadata
test/               Node self-tests (no DSH required)
```

## Tests

```bash
node test/scan.test.mjs
node test/registry.test.mjs
node test/config.test.mjs
node test/guard.test.mjs
```

## License

MIT, see [LICENSE](LICENSE).
