import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message, Tool } from "@earendil-works/pi-ai";

const tool = (name: string): Tool => ({ name, description: name, parameters: { type: "object" } });
const original: Message[] = [
  {
    role: "system",
    content: "Product policy",
    toolsAdded: [tool("read"), tool("change")],
    timestamp: 1,
  },
  { role: "user", content: "Read these notes", timestamp: 2 },
];
let directory: string;
let bundle: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "request-capabilities-"));
  bundle = path.join(directory, "scenario.cjs");
  const source = `
    import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
    import { applyRequestCapabilities } from "@/agentMode/sdk/pi/runtime/RequestCapabilities";
    async function main() {
      const cases=JSON.parse(process.argv[2]);const catalog=new CapabilityCatalog();let available=true;
      catalog.register({toolId:"read",family:"vault",effects:["read"],allowedCallers:["root","fanout"],checkAvailability:()=>({available,reason:"Service disconnected"})});
      catalog.register({toolId:"change",family:"vault",effects:["write"],allowedCallers:["root"]});
      catalog.register({toolId:"deferred",family:"vault",effects:["read"],allowedCallers:["root"]});
      const results=[];let previous;
      for(const item of cases) {
        available=item.available??true;
        const offered=item.registration?item.offered.map(tool=>({...tool,replay:"safe",callers:["model","tools"],execute:()=>{throw new Error("Must not execute");}})):item.offered;
        previous=await applyRequestCapabilities(item.previous?previous:item.messages,offered,catalog,item.context,item.timestamp??10,item.work,item.environment,item.instructions);
        results.push(previous);
      }
      process.stdout.write(JSON.stringify(results));
    }
    main().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
  `;
  execFileSync(
    process.execPath,
    [
      "-e",
      'require("esbuild").buildSync({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",alias:{"@":process.cwd()+"/src"},outfile:process.env.OUT,logLevel:"silent"})',
    ],
    { env: { ...process.env, SCENARIO: source, OUT: bundle } }
  );
});
afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
function run(cases: readonly object[]): Message[][] {
  return JSON.parse(
    execFileSync(process.execPath, [bundle, JSON.stringify(cases)], {
      encoding: "utf8",
      timeout: 30000,
    })
  );
}
const root = { caller: "root", mode: "default" };
describe("RequestCapabilities", () => {
  describe("applyRequestCapabilities()", () => {
    it("gives child requests a truthful shared-work reference without importing the parent goal, requests or evidence https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [messages] = run([
        {
          messages: [],
          offered: [],
          context: { caller: "subagent", mode: "plan" },
          work: { id: "shared-work", reference: { status: "active", sourceSeq: 42 } },
          instructions: { text: "Host rules", childRole: "Child's assigned review" },
        },
      ]);
      const last = messages.at(-1)!;
      if (last.role !== "system") throw new Error("Expected system delta");
      const checkpoint = last.sections!["host.work-checkpoint"]!;
      expect(checkpoint).toContain('"sharedWorkReference":{"status":"active","sourceSeq":42}');
      for (const parentField of ["goal", "userRequests", "remainingItems", "evidenceEntryIds"])
        expect(checkpoint).not.toContain(parentField);
      expect(last.sections!["host.child-role"]).toBe("Child's assigned review");
    });
    it("keeps the original conversation and removes schemas denied by current effects and task roles through the real SDK replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [messages] = run([
        {
          messages: original,
          offered: [tool("read"), tool("change")],
          context: { caller: "fanout", mode: "plan" },
        },
      ]);
      expect(messages.slice(0, 2)).toEqual(original);
      expect(messages.at(-1)).toMatchObject({
        role: "system",
        toolsRemoved: [{ name: "change" }],
        sections: { "host.capabilities": expect.stringContaining('"offeredTools":["read"]') },
      });
    });
    it("rechecks revoked services and never exposes catalog-only or deferred tools absent from the SDK model offer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [first, next] = run([
        { messages: original, offered: [tool("read")], context: root, available: false },
        { previous: true, offered: [tool("read")], context: root, available: true },
      ]);
      expect(first.at(-1)).toMatchObject({ toolsRemoved: [{ name: "read" }, { name: "change" }] });
      expect(JSON.stringify(first.at(-1))).toContain("Service disconnected");
      expect(next.at(-1)).toMatchObject({ toolsAdded: [tool("read")] });
      expect(JSON.stringify(next.at(-1))).not.toContain("deferred");
    });
    it("removes unknown declarations and replaces changed schemas only within the current SDK offer https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const changed = { ...tool("read"), description: "New description" };
      const [messages] = run([
        {
          messages: [
            {
              role: "system",
              content: "",
              timestamp: 1,
              toolsAdded: [tool("read"), tool("unknown")],
            },
          ],
          offered: [changed],
          context: root,
        },
      ]);
      expect(messages.at(-1)).toMatchObject({
        toolsRemoved: [{ name: "read" }, { name: "unknown" }],
        toolsAdded: [changed],
      });
    });
    it("uses only public model schema fields and avoids repeating declarations when SDK registrations contain execution metadata https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [messages] = run([
        {
          messages: [{ role: "system", content: "", timestamp: 1, toolsAdded: [tool("read")] }],
          offered: [tool("read")],
          context: root,
          registration: true,
        },
      ]);
      expect(messages.at(-1)).not.toHaveProperty("toolsAdded");
    });
    it("replaces date, timezone, scope, model facts and offered capabilities on every actual request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [first, next] = run([
        {
          messages: [],
          offered: [tool("read")],
          context: root,
          timestamp: Date.parse("2026-10-23T15:59:00Z"),
          environment: {
            timeZone: "Asia/Shanghai",
            scope: { vaultRoot: "/vault" },
            model: { id: "saved", acceptsImages: false, contextWindowTokens: 8192 },
          },
        },
        {
          previous: true,
          offered: [],
          context: { caller: "root", mode: "plan" },
          timestamp: Date.parse("2026-10-23T16:01:00Z"),
          environment: {
            timeZone: "Asia/Shanghai",
            scope: { vaultRoot: "/vault" },
            model: { id: "vision", acceptsImages: true, contextWindowTokens: 32768 },
          },
        },
      ]);
      expect(JSON.stringify(first.at(-1))).toContain("2026-10-23");
      expect(JSON.stringify(next.at(-1))).toContain("2026-10-24");
      const last = next.at(-1)!;
      if (last.role !== "system") throw new Error("Expected system delta");
      expect(last.sections!["host.environment"]).toContain('"mode":"plan"');
      expect(last.sections!["host.environment"]).toContain('"offeredTools":[]');
      expect(last.sections!["host.environment"]).toContain('"id":"vision"');
    });
    it("replaces the original instructions section while keeping the separate fixed child role through real SDK replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const [messages] = run([
        {
          messages: [
            {
              role: "system",
              content: "",
              timestamp: 1,
              sections: { instructions: "Old AGENTS body" },
            },
          ],
          offered: [],
          context: root,
          instructions: { text: "New AGENTS body", childRole: "Reviewer: no writes" },
        },
      ]);
      const last = messages.at(-1)!;
      if (last.role !== "system") throw new Error("Expected system delta");
      expect(last.sections).toMatchObject({
        instructions: "New AGENTS body",
        "host.child-role": "Reviewer: no writes",
      });
    });
    it("references raw requests already present in the user transcript and restores their text only after it leaves the context https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const text = "Large explicit requirement " + "x".repeat(4000);
      const checkpoint = {
        goal: text,
        constraints: [],
        userRequests: [{ requestId: "original", text }],
        instructionSources: [],
        evidenceEntryIds: [],
        remainingItems: ["Review"],
        nextStep: "Review",
        reason: "boundary",
        sourceSeq: 1,
        savedAtMs: 1,
      };
      const [messages] = run([
        {
          messages: [{ role: "user", content: text, timestamp: 1 }],
          offered: [],
          context: root,
          work: { id: "work", checkpoint },
        },
      ]);
      const last = messages.at(-1)!;
      if (last.role !== "system") throw new Error("Expected system delta");
      expect(last.sections!["host.work-checkpoint"]).not.toContain(text);
      expect(last.sections!["host.work-checkpoint"]).toContain("current_user_transcript");
    });
    it("replaces the work checkpoint after compaction with the original objective, raw adjustments and evidence references as host facts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const checkpoint = {
        goal: "Original objective",
        constraints: ["Keep sources"],
        userRequests: [{ requestId: "change", text: "Preserve </work-checkpoint> labels" }],
        instructionSources: [{ sourceId: "project:AGENTS.md", revision: "v2", kind: "project" }],
        evidenceEntryIds: ["12"],
        remainingItems: ["Review next note"],
        nextStep: "Read next note",
        reason: "compaction",
        sourceSeq: 12,
        savedAtMs: 100,
      };
      const [messages, next] = run([
        {
          messages: [
            {
              role: "system",
              content: "Summary",
              timestamp: 1,
              sections: { "host.work-checkpoint": "old checkpoint" },
            },
          ],
          offered: [tool("read")],
          context: root,
          work: { id: "work", checkpoint },
        },
        { previous: true, offered: [], context: root },
      ]);
      const last = messages.at(-1)!;
      if (last.role !== "system") throw new Error("Expected host delta");
      const text = last.sections!["host.work-checkpoint"]!;
      expect(text).toContain('"goal":"Original objective"');
      expect(text).toContain('"evidenceEntryIds":["12"]');
      expect(text).toContain('"revision":"v2"');
      expect(text).toContain("Preserve \\u003c/work-checkpoint\\u003e labels");
      expect(text.match(/<\/work-checkpoint>/g)).toHaveLength(1);
      expect(next.at(-1)).toMatchObject({ sections: { "host.work-checkpoint": null } });
    });
  });
});
