import type VaultAgentPlugin from "@/main";
import { getCachedCustomCommands } from "@/commands/state";

export function registerEditorCommandMenu(plugin: VaultAgentPlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
      const selectedText = editor.getSelection();
      const activeFile = view.file;
      for (const command of getCachedCustomCommands()) {
        if (!command.showInContextMenu) continue;
        menu.addItem((item) =>
          item
            .setTitle(`Vault Agent: ${command.title}`)
            .setIcon("sparkles")
            .setSection("vault-agent")
            .onClick(() => {
              // 点击时保留来源选区，新聊天的临时状态不能把它替换为另一篇笔记。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
              void plugin.newAgentChatWithDraft(`/${command.title}`, { selectedText, activeFile });
            })
        );
      }
    })
  );
}
