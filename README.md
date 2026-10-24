# Vault Agent

An Obsidian plugin (desktop only) that runs an AI coding agent inside your vault. Your notes are the
working directory: the agent reads them, searches them, edits them, and reports back in a chat view
that lives next to your notes.

The plugin ships one engine and needs nothing installed besides Obsidian itself: no Node, no CLI, no
separate agent runtime. Add a provider API key in the plugin settings (BYOK), or configure an
explicitly keyless local endpoint such as LM Studio. Enable a model and declare its context capacity
when it is unknown before starting a chat.
Older chats recorded with earlier OpenCode / Claude Code / Codex engines still open and keep their
original labels, but they are read-only history: those execution engines were removed.

Everything runs locally against your own credentials. The plugin ships no hosted service, no account
system, and no telemetry.

## What it does

- **Agent chat** — a dedicated view per conversation, with plan preview, turn diffs, and a trail of
  tool calls you can expand.
- **Projects** — scoped workspaces with their own context sources, `AGENTS.md` instructions, and an
  `outputs/` folder.
- **Skills** — reusable instructions the agent can load, discovered from a canonical folder in your
  vault, with a settings tab to enable, disable, or repair them.
- **Multi-agent turns** — @-mention more than one enabled model to compare and merge the answers.
- **Model picker** — choose which configured models the agent may use, including per-model
  reasoning effort.

## Install (development)

```bash
npm install
npm run build          # tsc + esbuild -> main.js, plus styles.css
```

Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/vault-agent/`,
then enable **Vault Agent** in Obsidian's community plugin list. That is the whole installation: the
plugin bundles its engine, and no Node/npm install, agent CLI, or login is required. Requires
Obsidian 1.11.4+ on macOS, Windows, or Linux — the vault tools drive external file access, so mobile
is not supported.

## Data, credentials, and network

- **Settings** — `.obsidian/plugins/vault-agent/data.json` inside the vault's config folder. It never
  contains provider API keys.
- **Credentials** — stored in the OS keychain through Obsidian SecretStorage; provider keys and MCP
  tokens are referenced by id, not written to vault files.
- **Chats** — an `agent-chat-index.json` index plus the durable session store in the plugin data
  folder (JSONL, append-only). A single root store warns at 16 MiB and refuses new runs at 32 MiB
  while reads, cancellation, export, and pending approvals stay available. Optional chat notes use
  `mode: agent` frontmatter in the vault.
- **Migration backups** — settings migrations write a backup to a private migration folder before
  rewriting settings, with credential fields excluded.
- **Network** — only the provider endpoints you configure, the HTTP MCP servers you add, and the URLs
  the agent explicitly fetches. No telemetry, hosted service, account system, or update channel.

## Trust boundaries

- **MCP servers are third-party programs.** Their tool results are untrusted material, their
  read-only annotations do not grant read-only rights, and unknown effects are approved per call and
  rejected in plan mode. HTTP MCP needs explicit configuration; OAuth may open your system browser.
- **Shell and stdio MCP are optional.** Without a host interpreter/server the core flows still work;
  the plugin never installs one for you. Opaque local processes are disabled in strict mode. This is
  a permission layer, not a sandbox: processes you configure run with your OS account's rights.
- **Approvals bind arguments, targets, and file baselines.** Crash recovery can complete a missing
  receipt when the effect already happened, never replays unknown/unsafe effects, and does not
  promise exactly-once side effects across all external systems.
- **Background subagent reports** are delivered once, a cancelled root stores the report without
  waking the parent model, and closing Obsidian stops background work; reopening restores state only.

## Legacy history

Old chats recorded by earlier OpenCode / Claude Code / Codex engines stay readable and keep their
original labels. When their records cannot be reconstructed faithfully they are imported as visible
chat material (marked as legacy text, not a new instruction) rather than as a full tool history; the
original data is not deleted or rewritten.

## Development

```bash
npm run test             # full jest suite
npm test -- -t "name"    # a single test
npm run lint             # eslint, including the module-boundary matrix
npm run format           # prettier
npm run review:obsidian  # the Obsidian submission gate
```

Requires Obsidian 1.11.4+ (desktop only). Verification results are recorded in
[`current verification report`](./designdocs/pi-rebuild/execution/evidence/CURRENT-VERIFICATION.json).
An isolated macOS Obsidian 1.14.4 vault has exercised actual LM Studio inference, approvals,
questions, plans, compaction, and a full application restart. Saved chats and notes survived;
a temporary password-storage test value survived restart and was removed after the check.
Long histories open with the latest 50 messages and retain the complete record for browsing and
export. Windows/Linux, user-authorized remote MCP, and the complete release acceptance checklist
remain unverified; this build does not claim that the full reconstruction plan or three-platform
acceptance is complete.

See [`AGENTS.md`](./AGENTS.md) for the architecture rules and
[`designdocs/agents/`](./designdocs/agents/) for the testing, style, and plugin-development guides.

## License

AGPL-3.0. See [`LICENSE`](./LICENSE).
