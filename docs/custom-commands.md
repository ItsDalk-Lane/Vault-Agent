# Vault Agent Commands

Vault Agent commands are prompts you save once and reuse. They are best for repeatable jobs such as fixing grammar, summarizing a note, or rewriting selected text.

## Commands or skills?

Commands appear when you type `/` in Agent Chat. Skills appear only in Agent Chat. You can also run saved commands from the editor or command palette.

| Use                     | Best for                                                                     | Managed in                                               |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Vault Agent command** | A short, repeatable prompt with optional note variables                      | [**Settings → Vault Agent → Command**](settings.md#命令) |
| **Skill**               | A reusable agent workflow that can include instructions and supporting files | [**Settings → Vault Agent → Skills**](settings.md#技能)  |

Skills are enabled for the built-in agent through a single switch. Commands stay inside Vault Agent and also work from the editor and Obsidian command palette. If a command and skill have the same name, the skill takes the slash-menu spot.

## Create a command

1. Open [**Settings → Vault Agent → Command**](settings.md#命令).
2. Click **Add Cmd**.
3. Enter a **Name** and **Prompt**.
4. Optionally choose **Model (Optional)**, **Show in context menu**, and **Show in slash menu**.
5. Click **Save**.

Choose **Default model** to keep the model currently selected in the Agent chat. A command-specific model is applied before the command is sent, including a slash-menu run. Its choices come from models enabled for the current agent in **Models (BYOK)**.

If a command's saved model is no longer available, the draft stays unsent and Vault Agent asks you to update that command. It does not silently substitute another provider. Queued commands using different models run as separate turns.

Use **Generate Default** for a starter set. You can edit, duplicate, delete, or drag commands to reorder them. **Custom Prompts Sort Strategy** controls their order in the slash menu.

### Add note context to a prompt

With **Custom Prompt Templating** enabled, these variables add vault context. When disabled, command variables remain literal text:

| Variable           | Adds                                                       |
| ------------------ | ---------------------------------------------------------- |
| `{}`               | Selected text, or the active note when nothing is selected |
| `{activeNote}`     | The active note                                            |
| `{[[Note Title]]}` | A specific note                                            |
| `{Folder/Path}`    | Notes in a folder path                                     |
| `{#tag1, #tag2}`   | Notes with any listed property tag                         |

For example:

```text
Rewrite {} as a concise project update. Match the style of {[[Writing Guide]]}.
```

Tags must be in note properties, not only written inline in the note body. When you run a command from Agent Chat, the active agent resolves note, folder, and tag references with its vault tools.

## Run a command

- **From the editor:** select text if needed, then right-click and choose **Vault Agent: _command name_**. The command must have **Show in context menu** enabled. The original selection and note stay attached to the new draft even if you change pages.
- **From the command palette:** run the saved command by its name. It opens a new Agent chat with an unsent `/command-name` draft.
- **From Agent Chat:** type `/`, choose a command, add any extra instruction, and send. Choosing an item inserts it without sending, so you can review it first.

Results appear in the existing Agent chat. The old Quick Ask, Quick Command and Quick Chat result panels have no current entry; their old settings and files are retained for compatibility.

## Where commands are stored

Each command is a Markdown file in `<Vault Agent folder>/copilot-custom-prompts/`. The filename is the command name, and Vault Agent keeps file changes and the **Command** settings tab in sync. Change the root under [**Settings → Vault Agent → Basic → Vault Agent folder location**](settings.md#基础设置).

When upgrading from older command settings, Vault Agent migrates supported commands to these files. If a name cannot be migrated, Vault Agent keeps it under the `unsupported/` subfolder and shows a startup notice.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Usage guide](index.md)
