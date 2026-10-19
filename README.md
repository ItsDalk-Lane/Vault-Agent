# Vault Agent

An Obsidian plugin (desktop only) that runs AI coding agents inside your vault. Your notes are the
working directory: the agent reads them, searches them, edits them, and reports back in a chat view
that lives next to your notes.

Supported agent backends:

- **OpenCode** (recommended) — installed and updated from inside the plugin.
- **Claude Code** — via the Claude Agent SDK.
- **Codex** — via the Codex ACP adapter.

Everything runs locally against your own credentials. The plugin ships no hosted service, no account
system, and no telemetry: you bring provider API keys (BYOK) or sign in to a CLI you already have.

## What it does

- **Agent chat** — a dedicated view per conversation, with plan preview, turn diffs, and a trail of
  tool calls you can expand.
- **Projects** — scoped workspaces with their own context sources, `AGENTS.md` instructions, and an
  `outputs/` folder.
- **Skills** — reusable instructions the agent can load, discovered from a managed folder in your
  vault, with a settings tab to enable, disable, or repair them.
- **Multi-agent turns** — @-mention more than one agent to fan a request out and merge the answers.
- **Model picker** — choose which configured models each backend may use, including per-model
  reasoning effort.

## Install (development)

```bash
npm install
npm run build          # tsc + esbuild -> main.js, plus styles.css
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/vault-agent/`,
then enable **Vault Agent** in Obsidian's community plugin list. Requires Obsidian 1.11.4+ on
macOS, Windows, or Linux — the agent runtimes drive external processes, so mobile is not supported.

## Development

```bash
npm run test             # jest (416 suites)
npm test -- -t "name"    # a single test
npm run lint             # eslint, including the module-boundary matrix
npm run format           # prettier
npm run review:obsidian  # the Obsidian submission gate
```

See [`AGENTS.md`](./AGENTS.md) for the architecture rules and
[`designdocs/agents/`](./designdocs/agents/) for the testing, style, and plugin-development guides.

## License

AGPL-3.0. See [`LICENSE`](./LICENSE).
