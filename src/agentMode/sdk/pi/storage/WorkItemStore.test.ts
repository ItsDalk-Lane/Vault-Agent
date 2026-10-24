import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { createWorkItemStore, type TaskCheckpoint } from "./WorkItemStore";

jest.mock("@earendil-works/pi-durable", () => ({ defineDoc: () => ({}) }), { virtual: true });
jest.mock("@earendil-works/chord/context", () => ({ BACKGROUND_CONTEXT: {} }), { virtual: true });

async function fixture() {
  let document = { items: {} };
  let tail = Promise.resolve();
  let failCommit = false;
  const conversation = {
    id: 1,
    commit: <T>(
      change: (transaction: {
        doc(): Promise<typeof document>;
        appendEntry(): Promise<void>;
      }) => Promise<T>
    ) => {
      const work = tail.then(async () => {
        if (failCommit) throw new Error("disk unavailable");
        const draft = JSON.parse(JSON.stringify(document)) as typeof document;
        const result = await change({ doc: async () => draft, appendEntry: async () => undefined });
        document = draft;
        return result;
      });
      tail = work.then(
        () => undefined,
        () => undefined
      );
      return work;
    },
  };
  const store = await createWorkItemStore({
    harness: { snapshot: async () => document } as unknown as Harness,
    conversation: conversation as unknown as Conversation,
  });
  return {
    store,
    fail: () => {
      failCommit = true;
    },
  };
}

const checkpoint: TaskCheckpoint = {
  goal: "Organize the supplied notes",
  constraints: ["Keep original content"],
  evidenceEntryIds: ["12"],
  remainingItems: ["Review links"],
  nextStep: "Read linked notes",
  reason: "budget",
  sourceSeq: 12,
  savedAtMs: 100,
};

describe("WorkItemStore", () => {
  describe("createWorkItemStore()", () => {
    it("retains goals, grants, reservations, spend and checkpoints in real SDK JSONL without waking a model on reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "work-item-store-"));
      try {
        const bundle = path.join(directory, "scenario.cjs");
        const source = `
          import { Harness, createRegistry } from "@earendil-works/pi-durable";
          import { createModels } from "@earendil-works/pi-ai";
          import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
          import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
          import { createWorkItemStore } from "@/agentMode/sdk/pi/storage/WorkItemStore";
          async function main() {
            const open = async () => Harness.open(await openNodeJsonlStorage(process.argv[2], context, {fsync:true}), {models:createModels(),registry:createRegistry()}, context);
            let harness=await open(); let conversation=await harness.root(context);
            let store=await createWorkItemStore({harness,conversation});
            await store.ensure("work", "Original user objective");
            await store.reserve({attemptId:"one",runId:"work",purpose:"root",reservedAtMs:1});
            await store.recordUsage("work","one",0.25);
            await store.checkpoint("work",{goal:"Original user objective",constraints:["Keep source notes"],evidenceEntryIds:["7"],remainingItems:["Finish index"],nextStep:"Read next note",reason:"budget",sourceSeq:7,savedAtMs:2},"paused_budget");
            await harness.close(context);
            harness=await open();conversation=await harness.root(context);store=await createWorkItemStore({harness,conversation});
            const before=await store.read("work");const inspection=await harness.inspect(context);
            await store.ensure("work","Continue");
            await Promise.all([store.authorizeNextSegment("work"),store.authorizeNextSegment("work")]);
            const continued=await store.read("work");
            await harness.close(context);
            harness=await open();conversation=await harness.root(context);store=await createWorkItemStore({harness,conversation});
            const after=await store.read("work");await harness.close(context);
            process.stdout.write(JSON.stringify({before,inspection,continued,after}));
          }
          main().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
        `;
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").buildSync({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),sourcefile:"work-store-scenario.ts",loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",alias:{"@":process.env.SRC},outfile:process.env.OUT,logLevel:"silent"})',
          ],
          {
            env: {
              ...process.env,
              SCENARIO: source,
              SRC: path.join(process.cwd(), "src"),
              OUT: bundle,
            },
          }
        );
        const report = JSON.parse(
          execFileSync(process.execPath, [bundle, path.join(directory, "store")], {
            encoding: "utf8",
            timeout: 30_000,
          })
        );
        expect(report).toMatchObject({
          before: {
            status: "paused_budget",
            reservations: [{ attemptId: "one" }],
            usage: { one: { usd: 0.25 } },
            checkpoint: { goal: "Original user objective", remainingItems: ["Finish index"] },
          },
          inspection: { scheduling: "paused", tasks: [], submissions: [] },
          after: { status: "active", checkpoint: { goal: "Original user objective" } },
        });
        expect(report.after.grants).toHaveLength(2);
        expect(report.after).toEqual(report.continued);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe("WorkItemStore", () => {
    describe("recordInstructionSources()", () => {
      it("replaces a changed or removed instruction version while retaining the original user objective https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "Original objective");
        await store.recordInstructionSources("work", [
          { sourceId: "project:AGENTS.md", revision: "v2", kind: "project" },
        ]);
        expect((await store.read("work"))?.checkpoint).toMatchObject({
          goal: "Original objective",
          instructionSources: [{ revision: "v2" }],
        });
        await store.recordInstructionSources("work", []);
        expect((await store.read("work"))?.checkpoint.instructionSources).toEqual([]);
      });
    });
    describe("recordInput()", () => {
      it("keeps raw user adjustments and current instruction revisions across later progress writes without guessing new constraints https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "Original objective");
        const original = (await store.read("work"))!.checkpoint;
        await store.recordInput("work", {
          requestId: "one",
          text: "Original objective",
          instructionSources: [{ sourceId: "project:AGENTS.md", revision: "v1", kind: "project" }],
        });
        await store.recordInput("work", {
          requestId: "two",
          text: "Keep all source notes",
          instructionSources: [{ sourceId: "project:AGENTS.md", revision: "v2", kind: "project" }],
        });
        await store.recordInput("work", {
          requestId: "two",
          text: "duplicate replay",
          instructionSources: [],
        });
        await store.checkpoint("work", { ...original, sourceSeq: 1, nextStep: "Review" });
        expect((await store.read("work"))?.checkpoint).toMatchObject({
          goal: "Original objective",
          userRequests: [
            { requestId: "one", text: "Original objective" },
            { requestId: "two", text: "Keep all source notes" },
          ],
          instructionSources: [{ sourceId: "project:AGENTS.md", revision: "v2", kind: "project" }],
          nextStep: "Review",
        });
      });
    });
    describe("importWorkItem()", () => {
      it("preserves spend and the original objective across explicit store rollover without replacing an existing destination https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const source = await fixture();
        await source.store.ensure("work", "Original objective");
        await source.store.reserve({
          attemptId: "one",
          runId: "work",
          purpose: "root",
          reservedAtMs: 1,
        });
        await source.store.recordUsage("work", "one", 0.25);
        await source.store.checkpoint("work", checkpoint, "paused_storage");
        const item = (await source.store.read("work"))!;
        const destination = await fixture();
        await destination.store.importWorkItem(item);
        await destination.store.importWorkItem({
          ...item,
          checkpoint: { ...checkpoint, goal: "Different objective" },
        });
        expect(await destination.store.read("work")).toEqual(item);
        expect((await destination.store.authorizeNextSegment("work")).grants).toHaveLength(1);
        expect(
          (
            await destination.store.reserve({
              attemptId: "two",
              runId: "work",
              purpose: "root",
              reservedAtMs: 2,
            })
          ).accepted
        ).toBe(false);
      });
    });
    describe("ensure()", () => {
      it("keeps the original objective and imported reservations across repeated continuation requests https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        const original = await store.ensure("work", "Original objective", [
          { attemptId: "old", runId: "work", purpose: "root", reservedAtMs: 1 },
        ]);
        expect(await store.ensure("work", "Continue")).toEqual(original);
        expect(original.reservations).toHaveLength(1);
      });
    });
    describe("read()", () => {
      it("returns no work for an unknown identifier without creating a grant https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        expect(await (await fixture()).store.read("missing")).toBeNull();
      });
    });
    describe("reserve()", () => {
      it("atomically shares one allowance across concurrent callers and pauses when it is exhausted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        const results = await Promise.all(
          Array.from({ length: 40 }, (_, index) =>
            store.reserve({
              attemptId: `attempt-${index}`,
              runId: "work",
              purpose: "root",
              reservedAtMs: index,
            })
          )
        );
        expect(results.filter((result) => result.accepted)).toHaveLength(32);
        expect((await store.read("work"))?.status).toBe("paused_budget");
        expect((await store.read("work"))?.reservations).toHaveLength(32);
      });

      it("never admits work while waiting for a user decision or after a failed durable commit https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const test = await fixture();
        await test.store.ensure("work", "goal");
        await test.store.checkpoint("work", checkpoint, "waiting_user");
        expect(
          (
            await test.store.reserve({
              attemptId: "pending",
              runId: "work",
              purpose: "root",
              reservedAtMs: 1,
            })
          ).accepted
        ).toBe(false);
        test.fail();
        await expect(
          test.store.reserve({
            attemptId: "failed",
            runId: "work",
            purpose: "root",
            reservedAtMs: 2,
          })
        ).rejects.toThrow("disk unavailable");
        expect((await test.store.read("work"))?.reservations).toEqual([]);
      });
    });
    describe("authorizeNextSegment()", () => {
      it("grants one new segment for an explicit follow-up even without model todo items and for an explicit user pause https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        await store.checkpoint("work", { ...checkpoint, remainingItems: [] }, "waiting_user");
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(2);
        await store.checkpoint("work", checkpoint, "waiting_user");
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(3);
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(3);
        await store.checkpoint("work", checkpoint, "paused_user");
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(4);
      });
      it("adds one explicitly approved segment after a progress pause and refuses implicit grants after a storage pause https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        await store.checkpoint("work", checkpoint, "paused_stalled");
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(2);
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(2);
        await store.checkpoint("work", checkpoint, "paused_storage");
        expect((await store.authorizeNextSegment("work")).status).toBe("paused_storage");
        expect((await store.read("work"))?.grants).toHaveLength(2);
      });
      it("grants one new segment only from a paused work item and preserves the previous usage https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        expect((await store.authorizeNextSegment("work")).grants).toHaveLength(1);
        await store.checkpoint("work", checkpoint, "paused_budget");
        await Promise.all([store.authorizeNextSegment("work"), store.authorizeNextSegment("work")]);
        expect((await store.read("work"))?.grants).toHaveLength(2);
      });
    });
    describe("recordUsage()", () => {
      it("saves each attempt's known or unknown cost once across duplicate callbacks https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        await store.recordUsage("work", "known", 0.25);
        await store.recordUsage("work", "known", 0.5);
        await store.recordUsage("work", "unknown", null);
        await store.recordUsage("work", "unknown", 0.1);
        expect((await store.read("work"))?.usage).toEqual({
          known: { usd: 0.25 },
          unknown: { usd: 0.1 },
        });
      });
    });
    describe("refund()", () => {
      it("returns only a pre-network reservation and never removes an attempt with recorded usage https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        await store.reserve({
          attemptId: "cancelled",
          runId: "work",
          purpose: "root",
          reservedAtMs: 1,
        });
        await store.reserve({ attemptId: "sent", runId: "work", purpose: "root", reservedAtMs: 2 });
        await store.recordUsage("work", "sent", null);
        await store.refund("work", "cancelled");
        await store.refund("work", "sent");
        expect((await store.read("work"))?.reservations.map((record) => record.attemptId)).toEqual([
          "sent",
        ]);
      });
    });
    describe("checkpoint()", () => {
      it("preserves the newer evidence and remaining steps when an older worker publishes late https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const { store } = await fixture();
        await store.ensure("work", "goal");
        await store.checkpoint("work", checkpoint, "paused_budget");
        await store.checkpoint(
          "work",
          { ...checkpoint, sourceSeq: 8, remainingItems: ["stale step"] },
          "active"
        );
        expect((await store.read("work"))?.checkpoint).toEqual(checkpoint);
        expect((await store.read("work"))?.status).toBe("paused_budget");
      });
    });
  });
});
