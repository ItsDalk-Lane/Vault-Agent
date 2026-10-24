import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
let directory: string;
let bundle: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "request-window-budget-"));
  bundle = path.join(directory, "scenario.cjs");
  const source = `import {budgetModelRequest} from "@/agentMode/sdk/pi/models/RequestWindowBudget"; import {compileModelToolResults} from "@/agentMode/sdk/pi/models/ModelToolResults"; const input=JSON.parse(process.argv[2]);budgetModelRequest(input.model,compileModelToolResults(input.context),input.output).then(result=>process.stdout.write(JSON.stringify(result)),error=>process.stdout.write(JSON.stringify({error:error.message})));`;
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
function run(
  messages: readonly object[],
  model = {
    contextWindow: 8192,
    maxTokens: 4096,
    compat: { supportsMidConvoSystemMessages: false },
  },
  output?: number
): { inputTokens: number; maxTokens: number; error?: string } {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [bundle, JSON.stringify({ context: { messages }, model, output })],
      { encoding: "utf8", timeout: 30000 }
    )
  );
}
describe("RequestWindowBudget", () => {
  describe("budgetModelRequest()", () => {
    it("reserves the final model-visible result metadata alongside the original tool text before allocating output https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const tool = {
        role: "toolResult",
        toolCallId: "call",
        toolName: "change",
        content: [{ type: "text", text: "actual result" }],
        isError: true,
        timestamp: 1,
      };
      const model = {
        contextWindow: 2048,
        maxTokens: 2048,
        compat: { supportsMidConvoSystemMessages: false },
      };
      const plain = run([tool], model);
      const compiled = run(
        [
          {
            ...tool,
            details: {
              outcome: {
                operationId: "actual-operation",
                source: { toolId: "change", caller: "root" },
                status: "error",
                effect: "unknown",
                error: { code: "EFFECT_UNKNOWN", phase: "persistence" },
                truncation: { truncated: false },
                receipts: ["receipt-one"],
                nextActions: ["read", "reconcile"],
              },
            },
          },
        ],
        model
      );
      expect(compiled.inputTokens).toBeGreaterThan(plain.inputTokens);
      expect(compiled.maxTokens).toBeLessThan(plain.maxTokens);
      expect(compiled.inputTokens + compiled.maxTokens).toBeLessThan(2048);
    });
    it("budgets the final system sections, user history, tools, images and tool results together and clips output to remaining capacity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const result = run([
        {
          role: "system",
          content: "policy",
          timestamp: 1,
          toolsAdded: [
            { name: "read", description: "d".repeat(12000), parameters: { type: "object" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Read notes" },
            { type: "image", data: "", mimeType: "image/png" },
          ],
          timestamp: 2,
        },
        {
          role: "toolResult",
          toolCallId: "one",
          toolName: "read",
          isError: false,
          content: [{ type: "text", text: "result".repeat(600) }],
          timestamp: 3,
        },
      ]);
      expect(result.inputTokens).toBeGreaterThan(5000);
      expect(result.maxTokens).toBeGreaterThan(0);
      expect(result.maxTokens).toBeLessThan(4096);
      expect(result.maxTokens + result.inputTokens).toBeLessThan(8192);
    });
    it("counts replacement sections and withdrawn schemas according to actual provider transcript capabilities https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const messages = [
        {
          role: "system",
          content: "policy",
          sections: { project: "old".repeat(7000) },
          toolsAdded: [
            { name: "removed", description: "d".repeat(10000), parameters: { type: "object" } },
          ],
          timestamp: 1,
        },
        {
          role: "system",
          content: "",
          sections: { project: "new" },
          toolsRemoved: [{ name: "removed" }],
          timestamp: 2,
        },
        { role: "user", content: "continue", timestamp: 3 },
      ];
      expect(run(messages).maxTokens).toBe(4096);
      expect(
        run(messages, {
          contextWindow: 8192,
          maxTokens: 4096,
          compat: { supportsMidConvoSystemMessages: true },
        }).error
      ).toContain("context_length_exceeded");
    });
    it("rejects fixed instructions exceeding the declared context and keeps a smaller requested output ceiling https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(run([{ role: "system", content: "x".repeat(40000), timestamp: 1 }]).error).toContain(
        "context_length_exceeded"
      );
      expect(
        run([{ role: "user", content: "hello", timestamp: 1 }], undefined, 256).maxTokens
      ).toBe(256);
      expect(
        run([], {
          contextWindow: 0,
          maxTokens: 4096,
          compat: { supportsMidConvoSystemMessages: false },
        }).error
      ).toContain("容量");
    });
  });
});
