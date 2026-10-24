# Projects

Projects are focused workspaces inside Agent Chat. Each Project keeps its own instructions, reusable context, and chat history, so ongoing work for a client, codebase, course, or research topic stays together.

Projects use the plugin’s built-in agent and the model, reasoning level, and permission mode selected for the current chat. Model services are configured in BYOK.

On the Agent Chat home screen, open **Projects** to browse your most recently used Projects. Scroll the list to see more, or use **Search projects** to find a Project by name or description. Search includes every Project, even those you have not scrolled to yet.

## Create a Project

1. Open **Agent Chat** from the ribbon or command palette.
2. From the Agent Chat home screen, open **Projects** and select **New project**.
3. Enter a name and select **Create**.

Vault Agent opens the new Project immediately. Creation asks only for a name. Use **Edit project** to add a description, instructions, and saved context.

Each Project has a folder under `<plugin folder>/projects/`. The default root is `vault-agent/projects/`. Its `project.md` file stores Project details and the context list. Its `AGENTS.md` file contains the instructions you own and edit.

## Add Project instructions

Open the Project info menu beside the name and select **AGENTS.md**. You can also choose **Edit project** from the Projects list and edit **Project instructions**. Both open the same Project file.

Vault-wide instructions still apply. Project instructions are more specific, so they take precedence when the two files conflict. The built-in agent reads the Project `AGENTS.md` directly.

Useful Project instructions include:

- the goal and intended audience;
- important source and output folders;
- the expected deliverable format;
- naming, style, or citation rules; and
- actions that should always require confirmation.

Keep stable rules in `AGENTS.md` and put one-off requests in chat. Start a new Project chat after changing the file to use the latest instructions. See [Instructions for Agent Chat](system-prompts.md).

## Add reusable context

For a new Project, **Context** appears below the composer. After the Project has chats, it appears as a **Context** tab beside **Recent Chats**.

You can:

- drag a vault file or folder into **Context**;
- select **URL** to add a web page or YouTube video; or
- select **Manage** or **Manage Context** to add **Links**, **Tags**, **Properties**, **Folders**, and **Files**, or to manage **Ignore Files**.

Tags match tags stored in note properties. Properties can target notes by a frontmatter field, such as `Topics: Physics`.

When a new Project chat starts, Vault Agent gives the agent a list of the saved context: folders, notes, and files by their location, and web pages and YouTube videos as links. Nothing is downloaded or converted in advance. The agent reads each source when a question needs it.

An existing Project chat keeps the instructions and context captured when that chat started. Start a new chat after changing either one when you need the updated version.

### File and link support

Markdown, text, and source files can be read using the plugin’s vault tools within the allowed scope. Model input currently supports text and eligible images; listing a PDF, video, or other binary file does not convert it or guarantee that the model can read it.

Saved links are references. The agent must use an available web tool or an explicitly configured MCP service to fetch the material; the plugin does not automatically download or convert it when a Project starts.

> **Project privacy:** The context names, paths, links, and excerpts needed for a request can reach the model service you select. A local model does not make remote tools local. Review configured services and approvals before using private material.

**Ignore Files** controls which files are listed in the Project's context. It is not a file permission setting. An agent can still find an ignored file through its own tools when the file is inside a location that agent can access.

## Work with Project chats

Inside a Project:

- **Recent Chats** and **Chat History** show that Project's conversations.
- **New Chat** starts a clean conversation with the latest Project instructions and context.
- **Leave project** returns to the Agent Chat home screen.

From the Projects list, hover over a Project to **Reveal in vault**, **Edit project**, or **Delete** it. The global **Recent Chats** list on the Agent Chat home screen includes conversations from across Projects.

Deleting a Project removes its Vault Agent Project configuration. It does not delete your ordinary vault notes or conversation notes already saved in the vault.

## When to use a Project

Use a Project when a task has a stable scope or will continue across several chats. Use a one-turn context attachment when the material matters only for the next message. Use the vault-root `AGENTS.md` when an instruction should apply everywhere.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [`AGENTS.md` Examples](agents-md-examples.md)
- [Settings and network boundaries](settings.md)
