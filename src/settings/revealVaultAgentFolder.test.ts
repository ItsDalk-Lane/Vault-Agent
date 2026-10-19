import { revealHiddenVaultAgentFolder } from "@/settings/revealVaultAgentFolder";
import { MemoryFolderAdapter } from "@/settings/testing/memoryFolderAdapter";

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

function vaultWith(adapter: MemoryFolderAdapter) {
  return { adapter };
}

describe("revealVaultAgentFolder", () => {
  describe("revealHiddenVaultAgentFolder()", () => {
    it("moves every Vault Agent folder from the hidden root into a visible root that does not exist yet", async () => {
      const adapter = new MemoryFolderAdapter({
        ".vault-agent/conversations/chat.md": "",
        ".vault-agent/projects/alpha/project.md": "",
      });

      const item = await revealHiddenVaultAgentFolder(
        vaultWith(adapter),
        ".vault-agent",
        "vault-agent"
      );

      expect(adapter.files.sort()).toEqual([
        "vault-agent/conversations/chat.md",
        "vault-agent/projects/alpha/project.md",
      ]);
      expect(item).toEqual({
        status: "moved",
        from: ".vault-agent",
        to: "vault-agent",
        leftBehind: [],
      });
    });

    it("creates the visible parent folders of a nested root before moving it", async () => {
      const adapter = new MemoryFolderAdapter({ ".work/.ai/memory/Saved Memories.md": "" });

      await revealHiddenVaultAgentFolder(vaultWith(adapter), ".work/.ai/", "work/ai");

      expect(adapter.files).toEqual(["work/ai/memory/Saved Memories.md"]);
    });

    it("merges into an existing visible root and leaves files whose names are taken in the hidden root (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", async () => {
      const adapter = new MemoryFolderAdapter({
        ".vault-agent/conversations/new-chat.md": "",
        ".vault-agent/memory/Saved Memories.md": "",
        ".vault-agent/skills/writer/SKILL.md": "",
        "vault-agent/memory/Saved Memories.md": "",
      });
      adapter.addFolder("vault-agent/conversations");

      const item = await revealHiddenVaultAgentFolder(
        vaultWith(adapter),
        ".vault-agent",
        "vault-agent"
      );

      expect(adapter.files.sort()).toEqual([
        ".vault-agent/memory/Saved Memories.md",
        "vault-agent/conversations/new-chat.md",
        "vault-agent/memory/Saved Memories.md",
        "vault-agent/skills/writer/SKILL.md",
      ]);
      expect(item).toMatchObject({
        status: "moved",
        leftBehind: [".vault-agent/memory/Saved Memories.md"],
      });
    });

    it("keeps the model catalog cache in the hidden root and reports nothing when no Vault Agent folder is inside it (https://github.com/Brevilabs/obsidian-copilot-private/issues/712)", async () => {
      const adapter = new MemoryFolderAdapter({
        ".vault-agent/model-catalog-cache.json": "",
        ".vault-agent/file-content-cache/abc.json": "",
      });

      expect(
        await revealHiddenVaultAgentFolder(vaultWith(adapter), ".vault-agent", "vault-agent")
      ).toBeNull();
      expect(adapter.files.sort()).toEqual([
        ".vault-agent/file-content-cache/abc.json",
        ".vault-agent/model-catalog-cache.json",
      ]);

      const withMemory = new MemoryFolderAdapter({
        ".vault-agent/model-catalog-cache.json": "",
        ".vault-agent/memory/Saved Memories.md": "",
      });
      const item = await revealHiddenVaultAgentFolder(
        vaultWith(withMemory),
        ".vault-agent",
        "vault-agent"
      );

      expect(item).toMatchObject({ status: "moved", leftBehind: [] });
      expect(withMemory.files.sort()).toEqual([
        ".vault-agent/model-catalog-cache.json",
        "vault-agent/memory/Saved Memories.md",
      ]);
    });

    it("does nothing for a visible root, a missing hidden folder, or a non-string setting", async () => {
      const adapter = new MemoryFolderAdapter({ "vault-agent/memory/Saved Memories.md": "" });

      expect(
        await revealHiddenVaultAgentFolder(vaultWith(adapter), "vault-agent", "vault-agent")
      ).toBeNull();
      expect(
        await revealHiddenVaultAgentFolder(vaultWith(adapter), ".vault-agent", "vault-agent")
      ).toBeNull();
      expect(
        await revealHiddenVaultAgentFolder(vaultWith(adapter), undefined, "vault-agent")
      ).toBeNull();
      expect(adapter.files).toEqual(["vault-agent/memory/Saved Memories.md"]);
    });

    it("reports why the move failed and keeps the hidden files", async () => {
      const adapter = new MemoryFolderAdapter({ ".vault-agent/memory/Saved Memories.md": "" });
      adapter.rename = jest.fn().mockRejectedValue(new Error("EACCES"));

      const item = await revealHiddenVaultAgentFolder(
        vaultWith(adapter),
        ".vault-agent",
        "vault-agent"
      );

      expect(item).toEqual({
        status: "failed",
        from: ".vault-agent",
        to: "vault-agent",
        reason: "EACCES",
      });
      expect(adapter.files).toEqual([".vault-agent/memory/Saved Memories.md"]);
    });
  });
});
