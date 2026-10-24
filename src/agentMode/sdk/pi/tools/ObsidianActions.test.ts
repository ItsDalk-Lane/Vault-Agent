import * as path from "node:path";

import { sha256 } from "@/utils/hash";
import { PathResolver } from "@/agentMode/sdk/pi/policy/PathResolver";
import {
  ObsidianActions,
  type ObsidianApp,
  type ObsidianEditor,
  type ObsidianLeaf,
} from "@/agentMode/sdk/pi/tools/ObsidianActions";
import { ToolRegistry } from "@/agentMode/sdk/pi/tools/ToolRegistry";
import {
  decodeSelectionToken,
  encodeSelectionToken,
} from "@/agentMode/sdk/pi/tools/SelectionSnapshot";

// Obsidian actions only use the injected App (popouts included), bind a selection to
// leaf/file/content/range, re-verify the same view after approval, refuse unknown actions or
// command ids, keep unsaved buffers from being overwritten through the disk write path, and honour
// cancellation:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeEditor implements ObsidianEditor {
  text: string;
  from = { line: 0, ch: 0 };
  to = { line: 0, ch: 0 };
  readonly replaced: Array<{ text: string; from: { line: number; ch: number } }> = [];

  constructor(text: string) {
    this.text = text;
  }

  getValue(): string {
    return this.text;
  }

  getSelection(): { from: { line: number; ch: number }; to: { line: number; ch: number } } {
    return { from: this.from, to: this.to };
  }

  replaceRange(
    text: string,
    from: { line: number; ch: number },
    to: { line: number; ch: number }
  ): void {
    this.replaced.push({ text, from });
    const start = this.offsetOf(from);
    const end = this.offsetOf(to);
    this.text = `${this.text.slice(0, start)}${text}${this.text.slice(end)}`;
  }

  private offsetOf(position: { line: number; ch: number }): number {
    const lines = this.text.split("\n");
    let offset = 0;
    for (let index = 0; index < position.line; index += 1) offset += lines[index].length + 1;
    return offset + position.ch;
  }
}

class FakeLeaf implements ObsidianLeaf {
  readonly id: string;
  filePath: string;
  readonly editor: FakeEditor;

  constructor(id: string, filePath: string, editor: FakeEditor) {
    this.id = id;
    this.filePath = filePath;
    this.editor = editor;
  }

  get view(): {
    file: { path: string };
    editor: FakeEditor;
  } {
    return { file: { path: this.filePath }, editor: this.editor };
  }
}

class FakeApp implements ObsidianApp {
  readonly leaves: FakeLeaf[] = [];
  readonly openFileCalls: Array<{ path: string; line?: number }> = [];
  executedCommands: string[] = [];

  readonly workspace = {
    iterateAllLeaves: (callback: (leaf: ObsidianLeaf) => void): void => {
      for (const leaf of this.leaves) callback(leaf);
    },
    getLeaf: (): ObsidianLeaf => this.leaves[0],
    openFile: async (filePath: string, line?: number): Promise<void> => {
      this.openFileCalls.push({ path: filePath, ...(line !== undefined ? { line } : {}) });
    },
  };

  executeCommand(commandId: string): void {
    this.executedCommands.push(commandId);
  }
}

interface Harness {
  readonly app: FakeApp;
  readonly vaultDisk: Map<string, string>;
  readonly tools: ObsidianActions;
  readonly vaultReads: string[];
}

function harness(): Harness {
  const app = new FakeApp();
  const vaultDisk = new Map<string, string>();
  const vaultReads: string[] = [];
  const pathResolver = new PathResolver({
    vaultRoot: "/vault",
    fileSystem: { realpath: async (target) => target },
    path,
  });
  const tools = new ObsidianActions({
    app,
    pathResolver,
    vault: {
      read: async (filePath) => {
        vaultReads.push(filePath);
        return vaultDisk.get(filePath) ?? "";
      },
    },
    registeredActions: ["open_note"],
  });
  return { app, vaultDisk, tools, vaultReads };
}

function addLeaf(harnessed: Harness, id: string, filePath: string, text: string): FakeLeaf {
  const leaf = new FakeLeaf(id, filePath, new FakeEditor(text));
  harnessed.app.leaves.push(leaf);
  harnessed.vaultDisk.set(filePath, text);
  return leaf;
}

describe("ObsidianActions", () => {
  describe("getSelection()", () => {
    it("finds the Markdown selection after a non-editor when native traversal stops on a truthy return https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "selected-leaf", "Notes/selected.md", "颜色：紫色");
      leaf.editor.from = { line: 0, ch: 3 };
      leaf.editor.to = { line: 0, ch: 5 };
      const nativeLeaves: ObsidianLeaf[] = [{ id: "chat", view: {} }, leaf];
      harnessed.app.workspace.iterateAllLeaves = (callback) => {
        const visit: (candidate: ObsidianLeaf) => unknown = callback;
        for (const candidate of nativeLeaves) {
          if (visit(candidate)) break;
        }
      };
      await expect(harnessed.tools.getSelection({}, {})).resolves.toMatchObject({
        ok: true,
        text: "紫色",
        snapshot: { leafId: "selected-leaf", filePath: "Notes/selected.md" },
      });
    });

    it("returns a token bound to leaf, file, content and range", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "hello world");
      leaf.editor.from = { line: 0, ch: 6 };
      leaf.editor.to = { line: 0, ch: 11 };

      const result = await harnessed.tools.getSelection({}, {});

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.selectionToken).toMatch(/^selection:/);
      expect(result.text).toBe("world");
      expect(result.snapshot).toMatchObject({
        leafId: "leaf-1",
        filePath: "Notes/a.md",
        contentHash: sha256("hello world"),
      });
    });
  });

  describe("replaceSelection()", () => {
    it("refuses altered token positions even when the original content and selection hashes remain valid https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "keep selected text");
      leaf.editor.from = { line: 0, ch: 5 };
      leaf.editor.to = { line: 0, ch: 13 };
      const selected = await harnessed.tools.getSelection({}, {});
      if (!selected.ok) throw new Error("selection unavailable");
      const snapshot = decodeSelectionToken(selected.selectionToken);
      if (!snapshot) throw new Error("selection token unavailable");
      const result = await harnessed.tools.replaceSelection(
        {
          selectionToken: encodeSelectionToken({ ...snapshot, from: { line: 0, ch: 0 } }),
          text: "replacement",
        },
        {}
      );
      expect(result).toMatchObject({ ok: false, code: "SELECTION_CHANGED" });
      expect(leaf.editor.getValue()).toBe("keep selected text");
    });

    it("replaces through the same view after the snapshot still matches", async () => {
      const harnessed = harness();
      addLeaf(harnessed, "leaf-1", "Notes/a.md", "hello world");
      const selection = await harnessed.tools.getSelection({}, {});
      if (!selection.ok) throw new Error("selection failed");

      const result = await harnessed.tools.replaceSelection(
        { selectionToken: selection.selectionToken, text: "vault" },
        {}
      );

      expect(result.ok).toBe(true);
      expect(harnessed.app.leaves[0].editor.replaced).toHaveLength(1);
      expect(harnessed.app.leaves[0].editor.getValue()).toContain("vault");
    });

    it("does not modify anything when the file was switched after approval", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "hello world");
      const selection = await harnessed.tools.getSelection({}, {});
      if (!selection.ok) throw new Error("selection failed");
      leaf.filePath = "Notes/b.md";
      leaf.editor.text = "other file";

      const result = await harnessed.tools.replaceSelection(
        { selectionToken: selection.selectionToken, text: "vault" },
        {}
      );

      expect(result).toMatchObject({ ok: false, code: "SELECTION_CHANGED" });
      expect(leaf.editor.replaced).toHaveLength(0);
      expect(leaf.editor.getValue()).toBe("other file");
    });

    it("does not modify anything when cancelled", async () => {
      const harnessed = harness();
      addLeaf(harnessed, "leaf-1", "Notes/a.md", "hello world");
      const selection = await harnessed.tools.getSelection({}, {});
      if (!selection.ok) throw new Error("selection failed");
      const controller = new AbortController();
      controller.abort();

      const result = await harnessed.tools.replaceSelection(
        { selectionToken: selection.selectionToken, text: "vault" },
        { signal: controller.signal }
      );

      expect(result).toMatchObject({ ok: false, code: "CANCELLED" });
      expect(harnessed.app.leaves[0].editor.replaced).toHaveLength(0);
    });
  });

  describe("previewSelectionReplacement()", () => {
    it.each([null, "invalid", { line: -1, ch: 0 }, { line: 0, ch: 0.5 }])(
      "refuses invalid token positions %p without changing or crashing the editor https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (position) => {
        const harnessed = harness();
        const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "original");
        const selected = await harnessed.tools.getSelection({}, {});
        if (!selected.ok) throw new Error("selection unavailable");
        const snapshot = decodeSelectionToken(selected.selectionToken);
        if (!snapshot) throw new Error("selection token unavailable");
        expect(
          harnessed.tools.previewSelectionReplacement(
            {
              selectionToken: `selection:${JSON.stringify({ ...snapshot, from: position })}`,
              text: "replacement",
            },
            {}
          )
        ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
        expect(leaf.editor.getValue()).toBe("original");
        expect(leaf.editor.replaced).toHaveLength(0);
      }
    );

    it("returns the complete proposed buffer without changing the editor https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "keep selected text");
      leaf.editor.from = { line: 0, ch: 5 };
      leaf.editor.to = { line: 0, ch: 13 };
      const selected = await harnessed.tools.getSelection({}, {});
      if (!selected.ok) throw new Error("selection unavailable");
      expect(
        harnessed.tools.previewSelectionReplacement(
          { selectionToken: selected.selectionToken, text: "replacement" },
          {}
        )
      ).toEqual({
        ok: true,
        filePath: "Notes/a.md",
        before: "keep selected text",
        after: "keep replacement text",
      });
      expect(leaf.editor.getValue()).toBe("keep selected text");
      expect(leaf.editor.replaced).toHaveLength(0);
    });

    it("refuses a stale preview after the selected buffer changes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const harnessed = harness();
      const leaf = addLeaf(harnessed, "leaf-1", "Notes/a.md", "original");
      const selected = await harnessed.tools.getSelection({}, {});
      if (!selected.ok) throw new Error("selection unavailable");
      leaf.editor.text = "manual change";
      expect(
        harnessed.tools.previewSelectionReplacement(
          { selectionToken: selected.selectionToken, text: "replacement" },
          {}
        )
      ).toMatchObject({ ok: false, code: "SELECTION_CHANGED" });
      expect(leaf.editor.getValue()).toBe("manual change");
      expect(leaf.editor.replaced).toHaveLength(0);
    });
  });

  describe("openNote()", () => {
    it("uses the injected App workspace for a popout leaf", async () => {
      const harnessed = harness();
      addLeaf(harnessed, "popout-leaf", "Notes/a.md", "hello");

      const result = await harnessed.tools.openNote({ path: "Notes/a.md", line: 3 }, {});

      expect(result).toMatchObject({ ok: true });
      expect(harnessed.app.openFileCalls).toEqual([{ path: "Notes/a.md", line: 3 }]);
    });
  });

  describe("checkOpenBuffer()", () => {
    it.each(["saved editor first", "dirty editor first"])(
      "refuses any unsaved editor for the same note with %s and accepts both matching editors after saving https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (order) => {
        const harnessed = harness();
        const saved = addLeaf(harnessed, "saved", "Notes/a.md", "disk content");
        const dirty = addLeaf(harnessed, "dirty", "Notes/a.md", "disk content");
        dirty.editor.text = "user changes in the other editor";
        addLeaf(harnessed, "unrelated", "Notes/unrelated.md", "separate note");
        if (order === "dirty editor first") harnessed.app.leaves.reverse();
        expect(await harnessed.tools.checkOpenBuffer("Notes/a.md")).toMatchObject({
          ok: false,
          code: "OPEN_BUFFER_CONFLICT",
        });
        expect(harnessed.vaultReads).toEqual(["Notes/a.md"]);
        expect(saved.editor.text).toBe("disk content");
        expect(dirty.editor.text).toBe("user changes in the other editor");
        dirty.editor.text = "disk content";
        expect(await harnessed.tools.checkOpenBuffer("Notes/a.md")).toEqual({ ok: true });
        expect(harnessed.vaultReads).toEqual(["Notes/a.md", "Notes/a.md"]);
      }
    );
    it("reports OPEN_BUFFER_CONFLICT when the editor buffer differs from disk", async () => {
      const harnessed = harness();
      addLeaf(harnessed, "leaf-1", "Notes/a.md", "unsaved changes");
      harnessed.vaultDisk.set("Notes/a.md", "disk content");

      const conflict = await harnessed.tools.checkOpenBuffer("Notes/a.md");
      expect(conflict).toMatchObject({ ok: false, code: "OPEN_BUFFER_CONFLICT" });

      harnessed.app.leaves[0].editor.text = "disk content";
      expect(await harnessed.tools.checkOpenBuffer("Notes/a.md")).toMatchObject({ ok: true });
    });
  });

  describe("runAction()", () => {
    it("rejects unknown actions, arbitrary command ids and JavaScript", async () => {
      const harnessed = harness();

      const unknown = await harnessed.tools.runAction(
        { action: "executeCommand", commandId: "x" },
        {}
      );
      const unknownAction = await harnessed.tools.runAction({ action: "rm_rf" }, {});
      const js = await harnessed.tools.runAction({ action: "open_note", script: "alert(1)" }, {});
      const extraKey = await harnessed.tools.runAction(
        { action: "open_note", payload: { path: "Notes/a.md" }, commandId: "editor.save" },
        {}
      );

      expect(unknown).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(unknownAction).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(js).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(extraKey).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
      expect(harnessed.app.executedCommands).toEqual([]);
      expect(harnessed.app.openFileCalls).toEqual([]);
    });

    it("runs only a host-registered public action", async () => {
      const harnessed = harness();
      addLeaf(harnessed, "leaf-1", "Notes/a.md", "hello");

      const result = await harnessed.tools.runAction(
        { action: "open_note", payload: { path: "Notes/a.md" } },
        {}
      );

      expect(result).toMatchObject({ ok: true });
      expect(harnessed.app.openFileCalls).toHaveLength(1);
    });
  });

  describe("register()", () => {
    it("registers the fixed Obsidian action manifests", () => {
      const harnessed = harness();
      const registry = new ToolRegistry();

      harnessed.tools.register(registry);

      expect(registry.requireManifest("obsidian_open_note").family).toBe("obsidian_action");
      expect(registry.requireManifest("obsidian_get_selection").effects).toEqual(["read"]);
      expect(registry.requireManifest("obsidian_replace_selection").replayPolicy).toBe("unsafe");
      expect(registry.requireManifest("obsidian_action").parameters.additionalProperties).toBe(
        false
      );
    });
  });
});
