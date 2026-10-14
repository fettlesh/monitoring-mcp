# fettle-mcp

**Website:** [fettle.sh](https://fettle.sh) · **MCP docs:** [fettle.sh/docs/mcp](https://fettle.sh/docs/mcp) · **Dashboard:** [dashboard.fettle.sh](https://dashboard.fettle.sh) · **Support:** support@fettle.sh

MCP server for [Fettle](https://fettle.sh) — uptime monitoring you can drive from
Claude Code, Claude Desktop, Cursor, Windsurf or anything else that speaks the
[Model Context Protocol](https://modelcontextprotocol.io).

Ask your assistant to create a monitor, look up why one went down, acknowledge an
incident or pause checks before a deploy — it calls the same public API you would.

```
"Add an HTTP monitor for https://api.acme.dev, check it every minute from all regions."
"Which of my monitors had incidents this week?"
"Pause the checkout monitor — we're deploying for the next 20 minutes."
```

In the [official MCP registry](https://registry.modelcontextprotocol.io) this
server is `sh.fettle/mcp` — one entry covering both channels, for clients that
install from the registry rather than from a hand-edited config file.

## Requirements

- Node.js 20 or newer
- A Fettle account and an API key (Settings → API Keys at https://fettle.sh)

An API key belongs to one organization and carries either **read** or **write**
scope. Read-scope keys can list and inspect; the write tools below need a
write-scope key.

## Install

There is nothing to install — MCP clients run the package with `npx` on demand.
Add one entry to your client's config and restart it.

### Claude Code

```bash
claude mcp add fettle --env FETTLE_API_KEY=fettle_your_key_here -- npx -y fettle-mcp
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "fettle": {
      "command": "npx",
      "args": ["-y", "fettle-mcp"],
      "env": { "FETTLE_API_KEY": "fettle_your_key_here" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "fettle": {
      "command": "npx",
      "args": ["-y", "fettle-mcp"],
      "env": { "FETTLE_API_KEY": "fettle_your_key_here" }
    }
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "fettle": {
      "command": "npx",
      "args": ["-y", "fettle-mcp"],
      "env": { "FETTLE_API_KEY": "fettle_your_key_here" }
    }
  }
}
```

## Configuration

| Variable            | Required | Default                 | What it does                                                         |
| ------------------- | -------- | ----------------------- | -------------------------------------------------------------------- |
| `FETTLE_API_KEY`    | yes      | —                       | Your API key. The server refuses to start without it.                |
| `FETTLE_API_URL`    | no       | `https://api.fettle.sh` | Point the server at a different API. You will not normally set this. |
| `FETTLE_TIMEOUT_MS` | no       | `30000`                 | How long one tool call may take before it is abandoned.              |

## Tools

49 tools, grouped by what they work on. Read-scope keys can call the `read` ones; everything marked `write` needs a write-scope key.

Every tool carries the MCP hints `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`, so a client can tell reads from changes without parsing names and ask for confirmation only where it matters. Only the five `delete_*` tools are destructive. `preview_maintenance_window` and `check_target` are marked read-only although they need a write-scope key: they change nothing. `check_now` and `check_target` reach the target host, so they are open-world.

### Monitors

| Tool                       | Scope | What it does                                                                                  |
| -------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `list_monitors`            | read  | List monitors compactly (status, target, tags, SSL expiry), filtered by type, status, tags.   |
| `get_monitor`              | read  | Read one monitor's full configuration and current status by id.                               |
| `check_target`             | write | Probe a target once from one region before creating a monitor for it.                         |
| `create_monitor`           | write | Create a monitor that checks a URL, host or port on a schedule.                               |
| `bulk_create_monitors`     | write | Create up to 100 monitors in one call — all of them or none.                                  |
| `update_monitor`           | write | Change an existing monitor's settings.                                                        |
| `bulk_update_monitors`     | write | Set the same interval, regions, channels or thresholds on up to 100 monitors, all or nothing. |
| `pause_monitor`            | write | Stop checking a monitor without deleting it — use before planned downtime.                    |
| `bulk_pause_monitors`      | write | Pause up to 100 monitors in one call, all or nothing.                                         |
| `resume_monitor`           | write | Resume checks on a paused monitor.                                                            |
| `bulk_resume_monitors`     | write | Resume up to 100 paused monitors in one call, all or nothing.                                 |
| `delete_monitor`           | write | Soft-delete a monitor: it stops being checked and leaves the monitor list.                    |
| `check_now`                | write | Re-arm a monitor to run on the next scheduler tick instead of waiting out its interval.       |
| `get_exposed_ports_preset` | read  | Database and admin ports that should not be reachable from the internet.                      |

### Results and uptime

| Tool                          | Scope | What it does                                                                               |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| `get_uptime_summary`          | read  | Uptime, average response time and incident counts over 24h / 7d / 30d at once.             |
| `get_uptime_daily`            | read  | A monitor's uptime for each UTC day, oldest first.                                         |
| `get_response_time_by_region` | read  | A monitor's average response time over 24h, 7d or 30d, one series per region.              |
| `list_check_results`          | read  | Individual check results of a monitor, newest first, filtered by region, status or period. |

### Incidents

| Tool                   | Scope | What it does                                                             |
| ---------------------- | ----- | ------------------------------------------------------------------------ |
| `list_incidents`       | read  | List incidents, optionally filtered by monitor, status, cause or period. |
| `get_incident`         | read  | Read one incident with its cause and every alert attempt.                |
| `acknowledge_incident` | write | Acknowledge an open incident so repeat notifications stop.               |

### Heartbeats

| Tool               | Scope | What it does                                                                      |
| ------------------ | ----- | --------------------------------------------------------------------------------- |
| `list_heartbeats`  | read  | List heartbeat (cron / dead-man's-switch) monitors and when each was last pinged. |
| `get_heartbeat`    | read  | Read one heartbeat, including its ping URL and when it will be reported late.     |
| `create_heartbeat` | write | Create a heartbeat monitor and get the URL a scheduled job should ping.           |
| `update_heartbeat` | write | Change a heartbeat's name, period, grace, channels or tags.                       |
| `pause_heartbeat`  | write | Pause a heartbeat: it is not reported late and its pings are ignored.             |
| `resume_heartbeat` | write | Resume a paused heartbeat.                                                        |
| `delete_heartbeat` | write | Delete a heartbeat for good; its ping URL stops working.                          |

### Maintenance windows

| Tool                         | Scope | What it does                                                                        |
| ---------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `list_maintenance_windows`   | read  | List maintenance windows (one-time or recurring, organization-wide or per monitor). |
| `list_active_maintenance`    | read  | The maintenance windows in effect right now.                                        |
| `get_maintenance_window`     | read  | Read one maintenance window with its next three occurrences.                        |
| `preview_maintenance_window` | write | Show the next three occurrences a schedule would produce, without saving it.        |
| `create_maintenance_window`  | write | Create a window that silences alerts, once or on an iCal RRULE schedule.            |
| `update_maintenance_window`  | write | Change a maintenance window.                                                        |
| `delete_maintenance_window`  | write | Delete a maintenance window; alerts resume at once.                                 |

### Tags

| Tool                       | Scope | What it does                                                                       |
| -------------------------- | ----- | ---------------------------------------------------------------------------------- |
| `list_tags`                | read  | List every tag in the organization with how many monitors and heartbeats carry it. |
| `bulk_update_monitor_tags` | write | Add and/or remove tags across up to 300 monitors in one call.                      |
| `rename_tag`               | write | Rename a tag on every monitor and heartbeat that carries it.                       |
| `delete_tag`               | write | Remove a tag from every monitor and heartbeat that carries it.                     |

### Status pages

| Tool                          | Scope | What it does                                                                                  |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------------- |
| `list_status_pages`           | read  | List status pages, with each page's slug and whether it is published.                         |
| `get_status_page`             | read  | Read one status page with its groups and components.                                          |
| `list_status_page_incidents`  | read  | List a status page's incidents, posted by a person or opened by Fettle, with their timelines. |
| `create_status_page_incident` | write | Open an incident on a status page with a first message.                                       |
| `post_status_page_update`     | write | Add a message to a status page incident and set its status; RESOLVED closes it.               |
| `update_status_page_incident` | write | Rename a status page incident; subscribers are not notified.                                  |
| `delete_status_page_incident` | write | Remove an incident and its timeline from a status page.                                       |

### Organization and platform

| Tool             | Scope | What it does                                                                |
| ---------------- | ----- | --------------------------------------------------------------------------- |
| `get_plan_usage` | read  | The organization's plan, its limits, and how much of each is used.          |
| `list_channels`  | read  | List notification channels (id, type, label, verified) to bind to monitors. |
| `list_regions`   | read  | List the check regions and the codes the regions argument takes.            |

The list is not written by hand. It is generated in the Fettle backend from one
registry and served at
[`/public-api/mcp-tools.json`](https://api.fettle.sh/public-api/mcp-tools.json);
this package vendors that file and builds its tools from it at startup, so the
two MCP channels can never offer different tools.

## Agent guide

The server sends this guide to the client in `initialize` (`instructions`), so an
agent connected through either channel already has it. It is reproduced here for
humans and for clients that do not surface server instructions.

<!-- prettier-ignore-start -->
<!-- agent-guide:start -->
```text
Fettle is an uptime monitoring service. The tools see only the API key's organization: monitors, heartbeats, maintenance windows, incidents, status page incidents, tags, channels (read), regions. Channels, status pages, members, API keys and billing are managed only in the dashboard (https://dashboard.fettle.sh). Read a tool's description (arguments, limits, errors) before its first call.

FINDING THINGS
- list_monitors gives one short row per monitor; use it to find ids. Filters are JSON arrays. Broken now: status ["DOWN", "DEGRADED"]. Certificates expiring first: type ["SSL"], sort "ssl_expiry".
- tag filters lists; tag_match "all" (default) needs every tag, "any" one of them.
- Lists are paginated: page from 1, size 1..100 (default 25).

PLAN LIMITS
Call get_plan_usage before creating anything: limits (null means none) and usage. A broken limit or an unknown region is a 403 naming it: change the request or tell the user; never retry it unchanged.

CREATING MONITORS
- check_target probes a target once before create_monitor. list_regions names the region codes.
- bulk_create_monitors creates up to 100, all or nothing.
- type and target never change after create.
- channel_ids: ids from list_channels. Empty or omitted on create alerts every verified, active channel. Email is not a channel: every alert also goes to the account email of whoever created the monitor or heartbeat.
- update tools change only the fields you pass. Never send null; omit a field to keep it. A monitor's config is replaced whole: send every config field you want to keep.
- Exposed ports on a server: follow get_exposed_ports_preset.

MANY MONITORS AT ONCE
Find ids with list_monitors, then bulk_pause_monitors, bulk_resume_monitors or bulk_update_monitors (interval, timeout, regions, channels, threshold, cooldown) for up to 100 ids, all or nothing. bulk_update_monitor_tags adds or removes tags on up to 300. There is no bulk delete.

TAGS
Call list_tags first and reuse names. Tags are flat labels such as env:prod, trimmed, lowercased and deduplicated; at most 10 per item. rename_tag and delete_tag act on every monitor and heartbeat.

HEARTBEATS
A job calls ping_url when it succeeds. Job every N seconds, alert after T seconds of silence: period_seconds = N, grace_seconds = T - N. Never late before its first success ping. ping_url + "/start" restarts the clock, ping_url + "/fail" marks it DOWN at once.

MAINTENANCE
Before a deploy or reboot, create_maintenance_window (scope ORG or MONITOR) instead of pausing monitors: checks keep running, but no incident opens and no alert goes out. Not for heartbeats. preview_maintenance_window shows a schedule's next occurrences; list_active_maintenance shows what is silenced now.

OUTAGES
list_monitors status ["DOWN"] -> list_check_results (status code, error, region per check) -> get_incident. acknowledge_incident stops repeat alerts; the recovery alert still goes out. create_status_page_incident and post_status_page_update can email the page's subscribers: confirm the text with the user first.

ERRORS (start of a failed call's text)
- "Authentication failed": the key is missing, revoked or expired, the address is not allowed, or its creator lost access. Do not retry; tell the user.
- "This tool requires/needs an API key with write scope": the key is read-only; tell the user.
- "Invalid argument(s)": names each failing field. "Invalid request:": the rule broken. Fix, retry.
- "Forbidden:": a plan limit, an unknown region, or the key's user lacks the permission; the reason says which.
- "Not found:": no such id in this organization.
- "Rate limited": wait the seconds given, then retry. All API key calls share the organization's per-minute budget.
- "Tool '<name>' failed: the API returned 5xx": server fault, retry once later.
- "Tool '<name>' does not accept argument(s)": drop the ones named.
- "Request failed with status N": read the reason, do not retry unchanged.

```
<!-- agent-guide:end -->
<!-- prettier-ignore-end -->

## The other channel: remote MCP

If your client supports remote MCP servers over HTTP, you do not need this
package at all — point it at `https://api.fettle.sh/mcp` with the same API key
as a Bearer token. Same tools, same behaviour, nothing to install or update.

Claude Code adds the remote channel from the command line — a different flag
set from the stdio one above, with the key as a header rather than an
environment variable:

```bash
claude mcp add fettle --transport http https://api.fettle.sh/mcp \
  --header "Authorization: Bearer fettle_your_key_here"
```

Clients configured through a JSON file take the same two fields:

```json
{
  "mcpServers": {
    "fettle": {
      "url": "https://api.fettle.sh/mcp",
      "headers": { "Authorization": "Bearer fettle_your_key_here" }
    }
  }
}
```

Use this package when your client speaks only stdio, or when you would rather
the credential stayed in a local config file than in a client's cloud
configuration.

There is no OAuth on either channel yet; both authenticate with an API key.

## Rate limits and plans

Tool calls spend the same per-organization request budget as the REST API — the
plan's limit, not a separate one. A rate-limited call comes back saying how many
seconds to wait. `check_now` also has its own cap of 10 calls per minute per
calling address. `get_plan_usage` shows the organization's request budget as
`limits.api_rate_limit_per_minute`. Plan limits are listed at
https://fettle.sh/pricing.

## Troubleshooting

**`FETTLE_API_KEY is not set`** — the client started the server without the
variable. Check the `env` block of the config above, then fully restart the
client: most clients read MCP config only at launch.

**`Authentication failed`** — the key is wrong, revoked, or from a deleted
organization. Create a fresh one in Settings → API Keys.

**`This tool requires an API key with write scope`** — the key is read-only. Create
a write-scoped key; there is no way to widen an existing key's scope.

**The assistant does not see the tools** — restart the client, then confirm
Node.js 20+ with `node -v`. Run `npx -y fettle-mcp` in a terminal: it should
print the missing-key message and exit, which proves the package itself runs.

## Development

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run contract:check        # vendored contract vs. production
```

Adding a tool is a change in the **backend's** registry, not here: regenerate
the contract there, then re-vendor it with
`pnpm run contract:check -- --write` and commit the result. No source file in
this package describes a tool.

`server.json` is the entry the [official MCP registry](https://registry.modelcontextprotocol.io)
serves, and it repeats the version — a test fails if it stops matching
`package.json`, so bump both together.

A release is a version tag: pushing `vX.Y.Z` runs `.github/workflows/publish.yml`,
which tests, builds and publishes the package to npm with provenance.

## License

MIT © Fettle
