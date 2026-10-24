import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import * as path from "node:path";

import {
  NativeTools,
  type NativeMutationPlan,
  type NativeMutationReceipt,
  type NativeToolApiLike,
  type NativeToolRegistrationLike,
  type NativeToolResult,
  type NativeWriteApprovalGate,
} from "@/agentMode/sdk/pi/tools/NativeTools";

// The native wrappers must run the official read/write/edit algorithm, capture every byte the
// algorithm wants to write behind a single concrete approval, perform zero writes before that
// approval, return USE_VAULT_TOOL for vault targets instead of silently switching tools, and keep
// real failures as errors:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
class FakeExternalEnv {
  readonly files = new Map<string, string>();
  readonly writes: Array<{ path: string; content: string }> = [];
  readonly reads: string[] = [];
  failWrite = false;
  failRead = false;
  loseWriteAcknowledgement: "return" | "throw" | undefined;
  readonly id = "external-env";
  cwd = "/home/user/docs";

  async readTextFile(
    target: string
  ): Promise<
    { ok: true; value: string } | { ok: false; error: { code: string; message: string } }
  > {
    this.reads.push(target);
    if (this.failRead)
      return { ok: false, error: { code: "permission_denied", message: "read unavailable" } };
    const content = this.files.get(target);
    if (content === undefined) {
      return { ok: false, error: { code: "not_found", message: `not found: ${target}` } };
    }
    return { ok: true, value: content };
  }

  async writeFile(
    target: string,
    content: string | Uint8Array
  ): Promise<{ ok: true; value: undefined } | { ok: false; error: { message: string } }> {
    if (this.failWrite) return { ok: false, error: { message: "disk full" } };
    this.writes.push({ path: target, content: String(content) });
    this.files.set(target, String(content));
    if (this.loseWriteAcknowledgement === "return")
      return { ok: false, error: { message: "write acknowledgement lost" } };
    if (this.loseWriteAcknowledgement === "throw") throw new Error("write acknowledgement lost");
    return { ok: true, value: undefined };
  }
}

function fakeRegistration(
  name: string,
  execute: (
    args: Record<string, unknown>,
    api: NativeToolApiLike,
    context: unknown
  ) => Promise<NativeToolResult>
): NativeToolRegistrationLike {
  return { name, description: `${name} tool`, parameters: {}, execute };
}

function readAlgorithm(): NativeToolRegistrationLike {
  return fakeRegistration("read", async (args, api) => {
    const env = (api as { env: ExecutionEnv }).env;
    const result = await env.readTextFile(String(args.path), {} as never);
    if (!result.ok) {
      return { output: [{ type: "text", text: result.error.message }], isError: true };
    }
    return { output: [{ type: "text", text: result.value }] };
  });
}

function writeAlgorithm(counter: { executes: number }): NativeToolRegistrationLike {
  return fakeRegistration("write", async (args, api) => {
    counter.executes += 1;
    const env = (api as { env: ExecutionEnv }).env;
    await env.writeFile(String(args.path), String(args.content), {} as never);
    return { output: [{ type: "text", text: `Wrote ${String(args.path)}` }] };
  });
}

function editAlgorithm(): NativeToolRegistrationLike {
  return fakeRegistration("edit", async (args, api) => {
    const env = (api as { env: ExecutionEnv }).env;
    const target = String(args.path);
    const read = await env.readTextFile(target, {} as never);
    if (!read.ok) return { output: [{ type: "text", text: read.error.message }], isError: true };
    const edits = args.edits as Array<{ oldText: string; newText: string }>;
    let after = read.value;
    for (const edit of edits) after = after.replace(edit.oldText, edit.newText);
    await env.writeFile(target, after, {} as never);
    return {
      output: [{ type: "text", text: `Edited ${target}` }],
      details: { diff: `${read.value} -> ${after}`, patch: "", firstChangedLine: 1 },
    };
  });
}

function harness(
  options: { approve?: boolean; onApproval?: () => void; onIntent?: () => Promise<void> } = {}
): {
  readonly tools: NativeTools;
  readonly env: FakeExternalEnv;
  readonly plans: NativeMutationPlan[];
  readonly receipts: NativeMutationReceipt[];
  readonly writesAtApproval: number[];
  readonly counter: { executes: number };
} {
  const env = new FakeExternalEnv();
  const plans: NativeMutationPlan[] = [];
  const receipts: NativeMutationReceipt[] = [];
  const writesAtApproval: number[] = [];
  const counter = { executes: 0 };
  const approvals: NativeWriteApprovalGate = {
    request: async (plan) => {
      plans.push(plan);
      writesAtApproval.push(env.writes.length);
      options.onApproval?.();
      return options.approve === false
        ? { approved: false, code: "PERMISSION_DENIED", message: "user denied" }
        : { approved: true };
    },
  };
  const tools = new NativeTools({
    registrations: {
      read: readAlgorithm(),
      write: writeAlgorithm(counter),
      edit: editAlgorithm(),
    },
    env: env as unknown as ExecutionEnv,
    vaultRoot: "/vault",
    approvals,
    receipts: {
      prepare: options.onIntent,
      record: async (receipt) => {
        receipts.push(receipt);
      },
    },
    path,
    now: () => 2_000,
    operationId: () => "op-native-1",
  });
  return { tools, env, plans, receipts, writesAtApproval, counter };
}

function outputText(result: Awaited<ReturnType<NativeTools["execute"]>>): string {
  const output = result.output;
  if (output === undefined) return "";
  if (typeof output === "string") return output;
  return output.map((item) => (item.type === "text" ? item.text : "")).join("");
}

describe("NativeTools", () => {
  describe("execute()", () => {
    it("allows an external Windows directory with different case and a distinct filesystem identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const env = new FakeExternalEnv();
      env.files.set("C:\\vault\\note.md", "external text");
      const options = Object.assign(
        {
          registrations: {
            read: readAlgorithm(),
            write: writeAlgorithm({ executes: 0 }),
            edit: editAlgorithm(),
          },
          env: env as unknown as ExecutionEnv,
          vaultRoot: "C:\\Vault",
          path: path.win32,
          approvals: { request: async () => ({ approved: false as const }) },
          receipts: { record: async () => undefined },
        },
        {
          fileSystem: {
            stat: async (target: string) => ({
              dev: 1,
              ino: target === "C:\\Vault" ? 2 : target === "C:\\vault" ? 3 : 1,
            }),
          },
        }
      );
      const tools = new NativeTools(options);
      const result = await tools.execute("read", { path: "C:\\vault\\note.md" }, {}, {});
      expect(result.isError).not.toBe(true);
      expect(result.output).toEqual([{ type: "text", text: "external text" }]);
    });
    it.each(["return", "throw"] as const)(
      "returns a structured unknown effect when the host %s loses acknowledgement after changing the file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      async (acknowledgement) => {
        const fixture = harness();
        fixture.env.files.set("/home/user/docs/note.md", "before");
        fixture.env.loseWriteAcknowledgement = acknowledgement;
        const result = await fixture.tools.execute(
          "write",
          { path: "/home/user/docs/note.md", content: "after" },
          {},
          {}
        );
        expect(result).toMatchObject({
          isError: true,
          details: { error: { code: "EFFECT_UNKNOWN" } },
        });
        expect(fixture.env.files.get("/home/user/docs/note.md")).toBe("after");
        expect(fixture.env.writes).toHaveLength(1);
        expect(fixture.receipts).toHaveLength(0);
      }
    );

    it("preserves an existing file when its baseline cannot be read instead of treating it as a new empty file https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = harness();
      fixture.env.files.set("/home/user/docs/note.md", "original");
      fixture.env.failRead = true;
      const result = await fixture.tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "overwrite" },
        {},
        {}
      );
      expect(result.isError).toBe(true);
      expect(fixture.plans).toHaveLength(0);
      expect(fixture.env.writes).toHaveLength(0);
      expect(fixture.env.files.get("/home/user/docs/note.md")).toBe("original");
    });
    it("does not change the file when saving its prepared intent fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const fixture = harness({
        onIntent: async () => {
          throw new Error("disk full");
        },
      });
      fixture.env.files.set("/home/user/docs/note.md", "before");
      const result = await fixture.tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "after" },
        {},
        {}
      );
      expect(outputText(result)).toContain("INTENT_FAILED");
      expect(fixture.env.writes).toEqual([]);
      expect(fixture.env.files.get("/home/user/docs/note.md")).toBe("before");
    });

    it("does not write after the real Durable abortSignal is cancelled during approval https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const controller = new AbortController();
      const fixture = harness({ onApproval: () => controller.abort() });
      fixture.env.files.set("/home/user/docs/note.md", "before");
      const result = await fixture.tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "after" },
        {},
        { abortSignal: controller.signal }
      );
      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("CANCELLED");
      expect(fixture.env.writes).toEqual([]);
      expect(fixture.env.files.get("/home/user/docs/note.md")).toBe("before");
    });

    it("runs the injected native read algorithm and returns its output", async () => {
      const harnessed = harness();
      harnessed.env.files.set("/home/user/docs/note.md", "hello world");

      const result = await harnessed.tools.execute(
        "read",
        { path: "/home/user/docs/note.md" },
        {},
        {}
      );

      expect(result.isError).toBeFalsy();
      expect(outputText(result)).toContain("hello world");
      expect(harnessed.env.reads).toContain("/home/user/docs/note.md");
    });

    it("performs zero writes before the concrete write approval and then records a receipt", async () => {
      const harnessed = harness();
      harnessed.env.files.set("/home/user/docs/note.md", "before");

      const result = await harnessed.tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "after" },
        {},
        {}
      );

      expect(harnessed.plans).toHaveLength(1);
      expect(harnessed.writesAtApproval).toEqual([0]);
      expect(result.isError).toBeFalsy();
      expect(harnessed.env.writes).toEqual([{ path: "/home/user/docs/note.md", content: "after" }]);
      expect(harnessed.receipts[0]).toMatchObject({
        operationId: "op-native-1",
        tool: "write",
        path: "/home/user/docs/note.md",
        beforeHash: expect.any(String) as string,
        afterHash: expect.any(String) as string,
      });
    });

    it("returns USE_VAULT_TOOL for a vault target without calling another tool", async () => {
      const harnessed = harness();

      const result = await harnessed.tools.execute(
        "write",
        { path: "/vault/notes/a.md", content: "x" },
        {},
        {}
      );

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("USE_VAULT_TOOL");
      expect(harnessed.counter.executes).toBe(0);
      expect(harnessed.plans).toEqual([]);
      expect(harnessed.env.writes).toEqual([]);
    });

    it("does not write when the approval is denied and returns a real error", async () => {
      const harnessed = harness({ approve: false });
      harnessed.env.files.set("/home/user/docs/note.md", "before");

      const result = await harnessed.tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "after" },
        {},
        {}
      );

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("WRITE_NOT_APPROVED");
      expect(harnessed.env.writes).toEqual([]);
      expect(harnessed.receipts).toEqual([]);
    });

    it("rejects a stale write when the file changed while approval was pending", async () => {
      const env = new FakeExternalEnv();
      env.files.set("/home/user/docs/note.md", "before");
      const plans: NativeMutationPlan[] = [];
      const counter = { executes: 0 };
      const tools = new NativeTools({
        registrations: {
          read: readAlgorithm(),
          write: writeAlgorithm(counter),
          edit: editAlgorithm(),
        },
        env: env as unknown as ExecutionEnv,
        vaultRoot: "/vault",
        approvals: {
          request: async (plan) => {
            plans.push(plan);
            env.files.set("/home/user/docs/note.md", "user edited while pending");
            return { approved: true };
          },
        },
        receipts: { record: async () => undefined },
        path,
        now: () => 2_000,
        operationId: () => "op-native-2",
      });

      const result = await tools.execute(
        "write",
        { path: "/home/user/docs/note.md", content: "after" },
        {},
        {}
      );

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("STALE_BASELINE");
      expect(env.writes).toEqual([]);
      expect(plans).toHaveLength(1);
    });

    it("returns the native edit output/details after applying an approved edit", async () => {
      const harnessed = harness();
      harnessed.env.files.set("/home/user/docs/note.md", "hello old");

      const result = await harnessed.tools.execute(
        "edit",
        { path: "/home/user/docs/note.md", edits: [{ oldText: "old", newText: "new" }] },
        {},
        {}
      );

      expect(result.isError).toBeFalsy();
      expect(outputText(result)).toContain("Edited");
      expect(harnessed.env.writes[0]).toEqual({
        path: "/home/user/docs/note.md",
        content: "hello new",
      });
      expect(harnessed.plans[0]).toMatchObject({
        tool: "edit",
        path: "/home/user/docs/note.md",
        before: "hello old",
        after: "hello new",
      });
      expect(harnessed.plans[0].diff).toContain("hello old");
      expect(harnessed.plans[0].diff).toContain("hello new");
    });

    it("keeps a native execution error as an error instead of an empty success", async () => {
      const env = new FakeExternalEnv();
      const tools = new NativeTools({
        registrations: {
          read: fakeRegistration("read", async () => ({
            output: [{ type: "text", text: "ENOENT: missing" }],
            isError: true,
          })),
          write: writeAlgorithm({ executes: 0 }),
          edit: editAlgorithm(),
        },
        env: env as unknown as ExecutionEnv,
        vaultRoot: "/vault",
        approvals: { request: async () => ({ approved: true }) },
        receipts: { record: async () => undefined },
        path,
        now: () => 2_000,
        operationId: () => "op-native-3",
      });

      const result = await tools.execute("read", { path: "/home/user/docs/missing.md" }, {}, {});

      expect(result.isError).toBe(true);
      expect(outputText(result)).toContain("ENOENT");
      expect(env.writes).toEqual([]);
    });
  });
});
