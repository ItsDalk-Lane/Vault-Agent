# Instructions for Agent Chat

Instructions are rules Vault Agent should keep following, such as your writing style, folder conventions, preferred formats, and safety boundaries.

Agent Chat uses the vault-root `AGENTS.md` for your custom instructions.

- **Agent Chat** reads the latest applicable instructions before each new request.

Agent Chat's built-in guidance covers vault context, Obsidian links and tool routing. The selected agent decides how much searching and planning the task needs, and can report unavailable tools or access honestly.

## Choose the right instruction tool

| Use                     | Best for                                                   |
| ----------------------- | ---------------------------------------------------------- |
| Vault `AGENTS.md`       | Default rules for Agent Chat                               |
| Project `AGENTS.md`     | More specific rules for one Project                        |
| **Skill**               | A reusable workflow with instructions and supporting files |
| **Vault Agent command** | A short saved prompt or template you want to run again     |
| One-off prompt          | A request that matters only for the current turn           |

Keep stable conventions in `AGENTS.md`. Use a [Skill](settings.md#技能) when an agent needs a repeatable process. Use a [Vault Agent command](custom-commands.md) for a short reusable prompt.

## Vault instructions

Vault-wide instructions live in `AGENTS.md` at the root of your vault. They apply to Agent Chat requests.

Open [**Settings → Vault Agent → Basic → Custom instructions**](settings.md#基础设置) and edit **Custom vault instructions**. Vault Agent saves the text to the vault-root file as you type. Select **Open AGENTS.md** to edit the same file as a normal note.

Good instructions are short and concrete:

```markdown
- Keep meeting notes under Meetings/.
- Use YYYY-MM-DD dates.
- Preserve existing frontmatter unless I ask you to change it.
- Ask before deleting a note.
```

Changes take effect on the next request. Project chats also read instructions in folders between the vault root and their project folder; nearer folders provide more specific guidance. Removed instructions stop being added to future requests.

## Project instructions

Each [Project](projects.md) can add its own `AGENTS.md` inside the Project folder. Open the Project info menu and select **AGENTS.md**, or use **Edit project → Project instructions**.

A Project chat follows both files:

1. The vault-root `AGENTS.md` provides general rules.
2. The Project `AGENTS.md` provides more specific rules and takes precedence when the two conflict.

Use Project instructions for details that should not affect the rest of the vault, such as a client's tone, deliverable format, source folders, or output location.

## How instructions and source material are used

Your current request, folder instructions, enabled skills and the current working state remain separate. Notes, websites, external tool replies and subtask reports are treated as source material; instructions found inside them cannot grant extra permissions.

Each request uses the current date, project scope, model capacity and available tools. Changing permissions takes effect before the next operation, even if an earlier request was approved. Turning off built-in guidance or using custom instructions does not turn off permission checks.

## Claude compatibility

Older versions created or updated `CLAUDE.md` imports for external Claude Code sessions. The built-in agent now reads `AGENTS.md` directly. Vault Agent no longer creates or updates those compatibility imports. Existing user files remain untouched; review them yourself if you also use another tool.

## Older saved system prompts

Existing saved system prompt files are kept. The former Quick Chat selection controls have no current runtime entry. Use the vault or Project `AGENTS.md` for current instructions; no existing prompt file is deleted.

## Examples and next steps

Start with the [`AGENTS.md` examples](agents-md-examples.md), then keep only rules that reflect how you actually work. Long procedures are easier to maintain as [Skills](settings.md#技能).

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Vault Agent Commands](custom-commands.md)
- [Settings](settings.md)
