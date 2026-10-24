import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  storeUnsentRootInput,
  restoreUnsentRootInput,
  type UnsentRootInput,
} from "./UnsentRootInput";

describe("UnsentRootInput", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "pi-unsent-"));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const draft = (): UnsentRootInput => ({
    kind: "prompt",
    savedAtMs: 1,
    input: {
      sessionId: "root-saved",
      requestId: "request-original",
      prompt: [
        { type: "text", text: "展开命令：选区7加4" },
        { type: "image", mimeType: "image/png", data: "cGljdHVyZQ==" },
      ],
      context: { materials: [{ origin: "note", sourcePath: "事实.md", text: "选区7加4" }] },
    },
  });
  describe("storeUnsentRootInput()", () => {
    it("preserves a candidate group's original checkpoint and reuses its image references for explicit continuation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const original = draft();
      if (original.kind !== "prompt") throw new Error("prompt fixture expected");
      const input: UnsentRootInput = {
        kind: "fanout",
        savedAtMs: 1,
        turn: {
          answers: {},
          summary: { status: "pending", text: "", complete: false },
          checkpoint: {
            fanoutId: "same-group",
            mainModelKey: "saved",
            prompt: original.input.prompt,
            context: original.input.context,
            originalPromptText: "原比较要求",
          },
        },
      };
      const stored = await storeUnsentRootInput(input, directory);
      expect(JSON.stringify(stored)).not.toContain("cGljdHVyZQ==");
      expect(await restoreUnsentRootInput(stored, directory)).toMatchObject(input);
    });
    it("reuses content-addressed attachments and preserves raw text, stable identity and material references without duplicating images into metadata https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const original = draft();
      const stored = await storeUnsentRootInput(original, directory);
      await storeUnsentRootInput(original, directory);
      expect(stored.kind === "prompt" && stored.input).toMatchObject({
        sessionId: "root-saved",
        requestId: "request-original",
        context: { materials: [{ sourcePath: "事实.md", text: "选区7加4" }] },
      });
      expect(JSON.stringify(stored)).not.toContain("cGljdHVyZQ==");
      expect(original.kind === "prompt" && original.input.prompt[1]).toMatchObject({
        data: "cGljdHVyZQ==",
      });
      expect(await fs.readdir(path.join(directory, "attachments"))).toHaveLength(1);
      expect(await restoreUnsentRootInput(stored, directory)).toMatchObject(original);
    });
    it("rejects empty and oversized images before accepting a pending request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      for (const data of ["", "A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3) + 5)]) {
        const input = draft();
        if (input.kind === "prompt" && input.input.prompt[1].type === "image")
          input.input.prompt[1].data = data;
        await expect(storeUnsentRootInput(input, directory)).rejects.toThrow("附件容量");
      }
    });
  });
  describe("restoreUnsentRootInput()", () => {
    it("keeps an unsupported saved version unreadable rather than treating it as a new request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      await expect(
        restoreUnsentRootInput({ ...draft(), version: 2 } as unknown as UnsentRootInput, directory)
      ).rejects.toThrow("版本不兼容");
    });
    it("rejects changed attachment contents, MIME and invalid references instead of resuming changed data https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const stored = await storeUnsentRootInput(draft(), directory);
      const file = path.join(directory, "attachments", `${stored.images![0].hash}.json`);
      for (const value of [
        { mime: "image/png", data: "changed" },
        { mime: "image/jpeg", data: "cGljdHVyZQ==" },
      ]) {
        await fs.writeFile(file, JSON.stringify(value));
        await expect(restoreUnsentRootInput(stored, directory)).rejects.toThrow("已变化");
      }
      await expect(
        restoreUnsentRootInput({ ...stored, images: [{ index: 1, hash: "../escape" }] }, directory)
      ).rejects.toThrow("引用无效");
      await expect(
        restoreUnsentRootInput(
          { ...stored, images: [{ index: 0, hash: stored.images![0].hash }] },
          directory
        )
      ).rejects.toThrow("位置无效");
      await fs.writeFile(file, "A".repeat(Math.ceil((8 * 1024 * 1024 * 4) / 3) + 1025));
      await expect(restoreUnsentRootInput(stored, directory)).rejects.toThrow("容量限制");
    });
  });
});
