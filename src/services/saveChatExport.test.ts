import { saveChatExport } from "@/services/saveChatExport";
import { requireNodeModule } from "@/utils/desktopRuntime";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

jest.mock("@/utils/desktopRuntime", () => ({ requireNodeModule: jest.fn() }));

describe("saveChatExport", () => {
  describe("saveChatExport()", () => {
    let directory: string;
    let destination: string;
    let showSaveDialog: jest.Mock;
    beforeEach(async () => {
      directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "va-export-")));
      destination = path.join(directory, "chosen");
      await fs.mkdir(destination);
      showSaveDialog = jest.fn(async () => ({
        canceled: false,
        filePath: path.join(destination, "chat.md"),
      }));
      (requireNodeModule as jest.Mock).mockImplementation((name: string) =>
        name === "electron"
          ? { remote: { dialog: { showSaveDialog } } }
          : name === "node:path"
            ? jest.requireActual<typeof import("node:path")>("node:path")
            : jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises")
      );
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await fs.rm(directory, { recursive: true, force: true });
    });

    it("writes the chosen document and independent attachment bytes that survive source deletion https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const source = path.join(directory, "private-image.png");
      const bytes = new Uint8Array([0, 1, 2, 128, 255]);
      await fs.writeFile(source, bytes);
      const content = "# Chat\n\n![Image](chat-attachments/image.png)";
      expect(
        await saveChatExport("chat.md", content, [
          {
            name: "chat-attachments/image.png",
            content: new Uint8Array(await fs.readFile(source)),
          },
        ])
      ).toEqual({ path: path.join(destination, "chat.md") });
      await fs.rm(source);
      expect(await fs.readFile(path.join(destination, "chat.md"), "utf8")).toBe(content);
      expect(
        new Uint8Array(await fs.readFile(path.join(destination, "chat-attachments", "image.png")))
      ).toEqual(bytes);
      expect(
        (await fs.lstat(path.join(destination, "chat-attachments", "image.png"))).isSymbolicLink()
      ).toBe(false);
    });

    it("does not write files when the user cancels", async () => {
      showSaveDialog.mockResolvedValue({ canceled: true });
      expect(
        await saveChatExport("chat.json", "{}", [
          { name: "images/photo", content: new Uint8Array([1]) },
        ])
      ).toBeNull();
      expect(await fs.readdir(destination)).toEqual([]);
    });

    it.each(["../outside.png", "nested/../../outside.png", "chat.md"])(
      "rejects attachment path %s before creating any export files https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (name) => {
        await expect(
          saveChatExport("chat.md", "# Chat", [
            { name: "images/valid.png", content: new Uint8Array([1]) },
            { name, content: new Uint8Array([2]) },
          ])
        ).rejects.toThrow();
        expect(await fs.readdir(destination)).toEqual([]);
        await expect(fs.access(path.join(directory, "outside.png"))).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
    );

    it("rejects absolute attachment paths even when they are inside the chosen folder https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(
        saveChatExport("chat.md", "# Chat", [
          { name: path.join(destination, "absolute.png"), content: new Uint8Array([1]) },
        ])
      ).rejects.toThrow();
      expect(await fs.readdir(destination)).toEqual([]);
    });

    it("rejects an attachment folder link before creating directories outside the selected location https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const outside = path.join(directory, "outside");
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(destination, "images"), "dir");
      await expect(
        saveChatExport("chat.md", "# Chat", [
          { name: "images/nested/photo.png", content: new Uint8Array([1]) },
        ])
      ).rejects.toThrow();
      expect(await fs.readdir(outside)).toEqual([]);
      await expect(fs.access(path.join(destination, "chat.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("rejects an attachment file link without changing the linked file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const outside = path.join(directory, "private.png");
      await fs.writeFile(outside, "keep");
      await fs.mkdir(path.join(destination, "images"));
      await fs.symlink(outside, path.join(destination, "images", "photo.png"));
      await expect(
        saveChatExport("chat.md", "# Chat", [
          { name: "images/photo.png", content: new Uint8Array([1]) },
        ])
      ).rejects.toThrow();
      expect(await fs.readFile(outside, "utf8")).toBe("keep");
      await expect(fs.access(path.join(destination, "chat.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("reports an unavailable system save dialog without writing files", async () => {
      (requireNodeModule as jest.Mock).mockReturnValue({});
      await expect(saveChatExport("chat.md", "# Chat")).rejects.toThrow();
      expect(await fs.readdir(destination)).toEqual([]);
    });
  });
});
