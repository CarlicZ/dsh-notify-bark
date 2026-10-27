# dsh-notify-bark

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

> **License:** MIT · **Requires:** Node ^22.19 · **DSH:** 0.2.1-rc.2 (`dsh-client-store` / Typert Remote era) · **Platform:** DSH Host + Web settings page

**[English](README.md) · [简体中文](README.zh-CN.md)**

A [Bark](https://github.com/Finb/Bark) push-notification plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): the **DSH Host** listens for events such as turn completion, waiting for your answer, and waiting for approval, asks the **current default model** for a compact phone-sized body, and pushes it to your iPhone through a Bark Server. Notifications are sent entirely from the Host — closing the browser, refreshing the page, or putting your computer to sleep does not affect delivery.

- **Host half** (`src/index.ts` + `lib/*.js`): session/event listener + model summarization + Bark HTTP sending + the plugin entry's own `Config` schema (volatile fields persisted and hot-applied through DSH's `ctx.settings` document) + the `barkNotify` Typert Remote served on the shared `/api` channel.
- **Browser half** (`src/client/` + `lib/client.js`): registers a `settings.section` slot; the form calls the mounted `barkNotify` Remote namespace. **The Bark URL never crosses the wire to the browser** — only a masked status is shown (configured: `••••••••3F82`).
- **Per-workspace presentation:** the notification icon and Bark group can come from the workspace's own `.env`, so two projects notify with different icons and groups.

<p align="center">
  <img width="900" alt="Settings page" src="docs/images/settings-page.png" />
</p>

<p align="center">
  <img width="480" alt="dsh-notify-bark" src="docs/images/plugin-card.jpg" />
</p>

<p align="center">
  <img width="300" alt="Bark notification" src="docs/images/bark-notification.jpg" />
</p>

## Notification events (9 switches)

| Event | Trigger | Default | Bark level |
| --- | --- | :-: | --- |
| ✅ Task completed | `turn/end` reason `completed` | On | `active` |
| ❌ Execution failed | `turn/end` reason `error` | On | `timeSensitive` |
| 🚫 Execution blocked | `turn/end` reason `blocked` | On | `timeSensitive` |
| ⏹ Aborted | `turn/end` reason `aborted` | Off | `passive` |
| ⚠️ Token limit reached | `turn/end` reason `max-tokens` | On | `timeSensitive` |
| ⏸ Interrupted | `turn/end` reason `interrupted` | On | `timeSensitive` |
| ❓ Awaiting your answer | `tool/call` `ask_user_question` | On | `timeSensitive` |
| 🔐 Awaiting your approval | `approval/asked` | On | `timeSensitive` |
| 📋 Plan awaiting confirmation | `tool/call` `exit_plan_mode` | Off | `timeSensitive` |

## Notification content

| Field | Default | Meaning |
| --- | :-: | --- |
| Title budget (`titleMaxChars`) | 20 | Title is the workspace name, fitted to this many user-perceived characters. |
| Body budget (`contentMaxChars`) | 50 | Body is written by the model, then hard-fitted to this budget. |
| Include the AI's last reply | On | Exposes the newest assistant reply to the summarizer as material; it is not appended verbatim. |
| Default Bark group | `DeepSeek Harness` | Used when the workspace `.env` sets no group. |

Every push is composed as:

- **Title** — the workspace name (last path segment of the session's cwd, else the session id), clipped to `titleMaxChars`. It stays deterministic so a short body still identifies the project.
- **Body** — one one-shot model call through `ctx.llm` using the Host's **current default model** (`ctx.agentDefaultModel.currentSelection()`): no model picker, no session history, no extra Agent. The call uses the route's lowest reasoning effort, an 8-second deadline, and a small token cap so the push stays fast and cheap.
- **Fallback** — when the model is unavailable, times out, returns an error, or returns empty text, the body falls back to `headline：detail` (still fitted to the budget). A notification is never dropped because summarization failed.

Model output is normalized to a single line (code fences, labels such as `正文：`, and wrapping quotes removed) and measured in grapheme clusters, so one CJK character, one Latin letter, and one emoji each count as one "字".

### Per-workspace `.env` (icon and group)

The listener reads `<workspace>/.env` on every notification, using the session's effective working directory. Two keys override the presentation:

```dotenv
DSH_BARK_ICON=https://example.com/project-icon.png
DSH_BARK_GROUP=Project Notifications
```

| Key | Effect | Fallback |
| --- | --- | --- |
| `DSH_BARK_ICON` (alias `BARK_ICON`) | `icon` field sent to Bark; must be an absolute `http(s)` URL the Bark server can fetch | no icon |
| `DSH_BARK_GROUP` (alias `BARK_GROUP`) | `group` field sent to Bark | the settings page's default group |

The `DSH_`-prefixed key wins when both are present. Local paths, `ftp:` URLs, and malformed icon values are ignored because Bark needs a fetchable URL. Only these four keys are read, values are never logged, and a missing `.env` is normal.

## Installation

Install directly from GitHub (the repo ships compiled output — clone and use, no build step required):

    dsh plugin --profile web add https://github.com/CarlicZ/dsh-notify-bark.git

Or from a local checkout (pack first — the profile records a `file:` dependency on the tarball, so keep it):

    pnpm install && pnpm run build && pnpm pack
    dsh plugin --profile web add ./dsh-notify-bark-0.3.1.tgz

A directory install (`dsh plugin add /path/to/dsh-notify-bark`) links the checkout instead of copying it; that works for development after `pnpm install`, but the linked copy resolves `@deepseek-ai/*` from its own `node_modules`, so the packed tarball is closer to a published install.

`dsh plugin add` runs `pnpm add` (writing dependencies + `dsh.profile.bundles`), and the plugin's own `cordis.patch.yml` inserts the `bark-notify` line. **A running dsh web watches the profile's `cordis.patch.yml` through Cordis HMR** — appending the same insert line at the user layer hot-loads the plugin without restarting the service:

    # $DSH_HOME/profiles/web/cordis.patch.yml
    - insert:
        - id: bark-notify
          name: 'dsh-notify-bark'

Refresh the browser settings page (gear → Bark notifications) to see the configuration form.

## Security & privacy

- **No built-in keys:** `barkUrl` defaults to empty; each deployer fills in their own Bark URL on the settings page (`https://api.day.app/your-key`). This repository contains no real credentials (tests use only a fake `testkey`).
- **Credentials never reach the browser:** `barkUrl` is declared `role('secret')` in the schema; the Remote get answers only a masked status (configured: `••••••••3F82`) and logs only `configured: true/false`.
- **Config is stored on the Host only:** written to the profile's DSH settings document on the Host and never uploaded to any third party; notifications are sent only to the Bark URL you configured.
- **What the summarizer receives:** one bounded event excerpt (event kind, workspace name, headline/detail, the pending tool name and arguments for approvals and questions, and — only while "Include the AI's last reply" is on — the newest assistant reply, clipped to 2000 characters). It goes to the **current default model provider**, the same provider the session already uses; the plugin adds no service, key, or upload.

## Development

    pnpm install              # typescript / @types/node + the DSH 0.2.1-rc.2 peer types (lockfile: pnpm-lock.yaml)
    pnpm run typecheck        # Host half against the installed DSH 0.2.1-rc.2 packages
    pnpm run typecheck:client # browser-half source against the DSH 0.2.1-rc.2 client packages
    pnpm run build            # tsc compiles the Host half to lib/; the client bundle is maintained directly in lib/client.js
    pnpm test                 # node:test unit + smoke tests (send / mapping / budgets / summarizer / .env / dedup / masking / remote contract / client bundle)

## Structure

    dsh-notify-bark/
    ├── package.json          # dsh.client declaration + bundle patch declaration + repo metadata
    ├── pnpm-lock.yaml        # pnpm lockfile
    ├── cordis.patch.yml      # plugin line insertion
    ├── LICENSE               # MIT
    ├── src/
    │   ├── index.ts          # Host entry: Config schema + event listener + Remote service
    │   ├── bark-service.ts   # Bark HTTP sending (timeout / error classification)
    │   ├── event-listener.ts # session/event → notification intent + detached delivery pipeline
    │   ├── notification.ts   # title/body budgets, summarizer material, deterministic fallback
    │   ├── summarize.ts      # one-shot call to the current default model (soft failure)
    │   ├── workspace-env.ts  # workspace .env icon/group overrides
    │   ├── text.ts           # grapheme-aware character budgets
    │   ├── settings-store.ts # settings model / schema / defaults / masking
    │   ├── remote-contract.ts # shared Remote contract: payloads, validation, descriptors
    │   ├── bark-remote.ts    # barkNotify Remote service (get masked / set / test)
    │   └── client/           # browser-half source (lib/client.js is its bundle mirror)
    ├── lib/                  # deployment artifacts (tsc-compiled Host + hand-maintained module-loader bundle)
    └── tests/                # node:test unit tests

## Design notes

- **Notifications go through the Host:** `ctx.on('session/event')` listens directly (the same path dsh-im-bridge uses); the browser is only a configuration panel.
- **Config is stored on the Host:** on DSH 0.2.1 a plugin entry *is* its settings namespace, so the plugin exports a `Config` schema whose fields are `volatile()` (stable live references, no remount) and writes go through `ctx.settings`. The plugin suppresses the auto-generated page (`configure({ auto: false })`) and owns its `settings.section`; the `barkNotify` Remote keeps reads masked and set write-only.
- **Summaries use the live default model:** `ctx.get('llm')` plus `ctx.agentDefaultModel.currentSelection()` build one hand-built one-shot request (no Agent, no Session, no transcript). The route's least expensive reasoning effort is selected, the whole call is bounded to 8 seconds, and any failure degrades to the deterministic body.
- **Workspace `.env` is read per push:** the session's effective directory comes from `ctx.workingDirectory` (falling back to `session.header.cwd`); only `DSH_BARK_ICON`/`BARK_ICON` and `DSH_BARK_GROUP`/`BARK_GROUP` are read, icon values must be fetchable `http(s)` URLs, and no value is logged.
- **Settings writes are revision-fenced:** the set method reads the entry's revision from `ctx.settings.describe()` and passes it to `ctx.settings.update()`, so a stale editor cannot silently overwrite a concurrent change.
- **Event dedup:** `sessionId` + `event.seq` key with a bounded ledger, so reconnects or replays never push duplicates.
- **No RPC channels were harmed:** the `barkNotify` methods ride the standard Typert `/api` gateway (SRC discovery from the live service), not a custom `connection.rpc.handle` channel — the one surface that cannot work cross-plugin on DSH 0.2+.

## References & acknowledgments

- Architecture patterns referenced (design only — no code copied):
  - **dsh-im-bridge** — the session/event listening path (internal DeepSeek plugin, not public);
  - **dsh-codex-auth** — the pattern of a settings page reading/writing Host config through a dedicated RPC (internal DeepSeek plugin, not public).
- Plugin platform: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT).
- Push service: [Bark](https://github.com/Finb/Bark) (open-source iOS push service) — this plugin only sends HTTP requests to the Bark URL you configured; it does not include or distribute Bark code.

## License

[MIT](LICENSE). Provided as-is, without any express or implied warranty; any loss arising from use of this plugin is borne by the user. Contributors agree to license their contributions under MIT.