import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { compileHostToolDefinition, type HostToolDefinition } from "./HostToolDefinition";

const api = { conversationId: 1, taskId: 2, callId: "call" } as unknown as ToolExecutionApi;
const context = {} as Context;

function definition(execute: HostToolDefinition["execute"]): HostToolDefinition {
  return {
    toolId: "inspect",
    description: "Read authorized facts and return the actual result.",
    family: "vault",
    effects: ["read"],
    allowedCallers: ["root"],
    parameters: { type: "object", properties: { path: { type: "string" } } },
    replay: "safe",
    executionMode: "sequential",
    outputLimits: { maxBytes: 1024 },
    execute,
  };
}

describe("HostToolDefinition", () => {
  describe("compileHostToolDefinition()", () => {
    it("binds model schema, capabilities, replay, scheduling and actual output to one immutable definition https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const catalog = new CapabilityCatalog();
      const registered = jest.spyOn(catalog, "register");
      const source = definition(async () => ({
        output: [{ type: "text", text: "actual data" }],
        details: { count: 1 },
      }));
      const registration = compileHostToolDefinition(source, catalog);
      (source.parameters as Record<string, unknown>).properties = {};
      expect(registration.parameters).toMatchObject({ properties: { path: { type: "string" } } });
      expect(() => {
        (registration.parameters as Record<string, unknown>).properties = {};
      }).toThrow(TypeError);
      expect(registered.mock.calls[0][0]).toMatchObject({
        description: registration.description,
        parameters: registration.parameters,
        replay: registration.replay,
        executionMode: registration.executionMode,
        outputLimits: registration.outputLimits,
        outputContract: "tool-outcome-v1",
      });
      expect(registration).toMatchObject({
        name: "inspect",
        replay: "safe",
        executionMode: "sequential",
        outputLimits: { maxBytes: 1024 },
      });
      expect(
        catalog.evaluate("inspect", { caller: "root", mode: "plan", readOnly: true }).available
      ).toBe(true);
      expect(
        catalog.evaluate("inspect", { caller: "fanout", mode: "plan", readOnly: true }).available
      ).toBe(false);
      const result = await registration.execute({}, api, context);
      expect(result.output).toEqual([{ type: "text", text: "actual data" }]);
      expect(result.details).toMatchObject({
        outcome: { status: "success", effect: "not_applied", data: { count: 1 } },
      });
    });

    it("rechecks the latest execution boundary for direct calls and cancellation without invoking the implementation https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
      const catalog = new CapabilityCatalog();
      const execute = jest.fn(async () => ({
        output: [{ type: "text" as const, text: "actual" }],
      }));
      let block: string | undefined;
      catalog.setExecutionGate(async () => ({ caller: "root", block }));
      const registration = compileHostToolDefinition(definition(execute), catalog);
      await registration.execute({}, api, context);
      block = "Permission was revoked";
      expect(await registration.execute({}, api, context)).toMatchObject({
        isError: true,
        details: {
          outcome: {
            effect: "not_applied",
            error: { code: "TOOL_EXECUTION_BLOCKED", phase: "review", message: block },
          },
        },
      });
      expect(
        await registration.execute({}, api, { abortSignal: AbortSignal.abort() } as Context)
      ).toMatchObject({ isError: true });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it("rejects actual SDK safe execute-checkpoint replay after a passive write even when beforeTool is skipped https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "host-tool-replay-"));
      try {
        const bundle = path.join(directory, "scenario.cjs");
        const source = String.raw`
          import {Harness,createRegistry,defineExtension,hook,ToolTask,GenerationTask} from "@earendil-works/pi-durable";
          import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
          import {fauxProvider,fauxAssistantMessage,fauxToolCall,createModels} from "@earendil-works/pi-ai";
          import {BACKGROUND_CONTEXT as c} from "@earendil-works/chord/context";
          import {appendFileSync,readFileSync} from "node:fs";
          import {compileHostToolDefinition} from "@/agentMode/sdk/pi/tools/HostToolDefinition";
          import {CapabilityCatalog} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
          const dir=process.argv[2]; const phase=process.argv[3];
          (async()=>{
            const faux=fauxProvider();const m=faux.getModel();const models=createModels();models.setProvider(faux.provider);
            const catalog=new CapabilityCatalog();catalog.setExecutionGate(async()=>{appendFileSync(dir+"/events","gate:"+phase+"\n");return {caller:"root",...(phase==="two"?{block:"Explicit recovery is required"}:{})};});
            const registration=compileHostToolDefinition({toolId:"safe_tool",family:"control",effects:["state"],allowedCallers:["root"],description:"safe state update",parameters:{type:"object"},replay:"safe",outputLimits:{maxBytes:1024},execute:async()=>{appendFileSync(dir+"/events","execute:"+phase+"\n");if(phase==="one")process.exit(0);return {output:[{type:"text",text:"must not run"}]};}},catalog);
            const registry=createRegistry();registry.install(defineExtension({name:"audit",tools:[registration],hooks:[hook(ToolTask,{beforeTool:async()=>{appendFileSync(dir+"/events","hook:"+phase+"\n");return phase==="two"?{block:"must also stop here"}:undefined;}}),hook(GenerationTask,{beforeRequest:async()=>{if(phase==="two")throw new Error("No model before recovery");}})]}));
            const h=await Harness.open(await openNodeJsonlStorage(dir+"/store",c,{fsync:true}),{models,registry},c);const root=await h.root(c,{agent:{model:{provider:m.provider,modelId:m.id}}});
            if(phase==="one"){faux.setResponses([fauxAssistantMessage([fauxToolCall("safe_tool",{})],{stopReason:"toolUse"})]);await(await root.submit({type:"input",content:"run"},c)).wait(c);}
            else{await(await root.submit({type:"write",entry:{kind:"audit.passive",data:{}}},c)).wait(c);await h.waitForIdle(c);const entries=(await root.entries({order:"ascending"},100,undefined,c)).items;await h.close(c);process.stdout.write(JSON.stringify({events:readFileSync(dir+"/events","utf8"),calls:faux.state.callCount,result:entries.find(e=>e.kind==="pi.tool-result")?.model?.[0]}));}
          })().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});
        `;
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").buildSync({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",alias:{"@":process.cwd()+"/src"},outfile:process.env.OUT,logLevel:"silent"})',
          ],
          { env: { ...process.env, SCENARIO: source, OUT: bundle } }
        );
        execFileSync(process.execPath, [bundle, directory, "one"], { timeout: 20_000 });
        const report = JSON.parse(
          execFileSync(process.execPath, [bundle, directory, "two"], {
            encoding: "utf8",
            timeout: 20_000,
          })
        );
        expect(report.events).toBe("hook:one\ngate:one\nexecute:one\ngate:two\n");
        expect(report.result).toMatchObject({
          isError: true,
          details: {
            outcome: { effect: "not_applied", error: { code: "TOOL_EXECUTION_BLOCKED" } },
          },
        });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });

    it("preserves an actual nested SDK validation rejection in its parent's existing result without changing parent success or executing the invalid child https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "host-tool-invalid-nested-"));
      try {
        const bundle = path.join(directory, "scenario.cjs");
        const source = String.raw`
          import {Harness,createRegistry,defineExtension} from "@earendil-works/pi-durable";
          import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
          import {fauxProvider,fauxAssistantMessage,fauxToolCall,createModels} from "@earendil-works/pi-ai";
          import {BACKGROUND_CONTEXT as c} from "@earendil-works/chord/context";
          import {compileHostToolDefinition} from "@/agentMode/sdk/pi/tools/HostToolDefinition";
          import {CapabilityCatalog} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
          import {deriveSdkToolRejection,readSdkToolRejections} from "@/agentMode/sdk/pi/tools/SdkToolRejections";
          (async()=>{
            const dir=process.argv[2];const faux=fauxProvider();const m=faux.getModel();const models=createModels();models.setProvider(faux.provider);let executed=0;let childResult;
            const catalog=new CapabilityCatalog();catalog.setExecutionGate(async()=>({caller:"root",ownerSessionId:"owner"}));
            const common={family:"control",effects:["read"],allowedCallers:["root"],replay:"safe",outputLimits:{maxBytes:1024}};
            const child=compileHostToolDefinition({...common,toolId:"inspect",description:"inspect",callers:["tools"],parameters:{type:"object",required:["path"],properties:{path:{type:"string"}}},execute:async()=>{executed++;return {output:[{type:"text",text:"must not execute"}]};}},catalog);
            const parent=compileHostToolDefinition({...common,toolId:"parent",description:"parent",parameters:{type:"object"},execute:async(_,api,ctx)=>{childResult=await api.executeTool("inspect",{path:{}},ctx,{key:"bad-input"});await api.executeTool("unavailable",{},ctx,{key:"missing-tool"});return {output:[{type:"text",text:"parent remains successful"}],details:{parentData:"retained"},control:{terminate:true}};}},catalog);
            const registry=createRegistry();registry.install(defineExtension({name:"test",tools:[parent,child]}));
            let h=await Harness.open(await openNodeJsonlStorage(dir+"/store",c),{models,registry},c);let root=await h.root(c,{agent:{model:{provider:m.provider,modelId:m.id}}});
            faux.setResponses([fauxAssistantMessage([fauxToolCall("parent",{})],{stopReason:"toolUse"})]);await(await root.submit({type:"input",content:"run"},c)).wait(c);await h.waitForIdle(c);
            const entries=(await root.entries({order:"ascending"},100,undefined,c)).items;const result=entries.find(e=>e.kind==="pi.tool-result");const receipt=result.model[0].details.sdkToolRejections[0];const task=await h.getTask(Number(receipt.taskId),c);const derived=deriveSdkToolRejection({ownerSessionId:"owner",caller:"root",task,nested:receipt});
            await h.close(c);h=await Harness.open(await openNodeJsonlStorage(dir+"/store",c),{models,registry},c);root=await h.root(c);const reopened=(await root.entries({order:"ascending"},100,undefined,c)).items.find(e=>e.kind==="pi.tool-result");const restored=await readSdkToolRejections({harness:h,entries:[reopened],ownerSessionId:"owner",caller:()=>"root"});await h.close(c);
            process.stdout.write(JSON.stringify({executed,calls:faux.state.callCount,result:result.model[0],receipt,derived,childResult,reopened:reopened.model[0],restored}));
          })().catch(e=>{process.stderr.write(e.stack);process.exitCode=1;});`;
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").buildSync({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",alias:{"@":process.cwd()+"/src"},outfile:process.env.OUT,logLevel:"silent"})',
          ],
          { env: { ...process.env, SCENARIO: source, OUT: bundle } }
        );
        const report = JSON.parse(
          execFileSync(process.execPath, [bundle, directory], { encoding: "utf8", timeout: 20000 })
        );
        expect(report.executed).toBe(0);
        expect(report.calls).toBe(1);
        expect(report.result).toMatchObject({
          isError: false,
          details: {
            outcome: { status: "success", data: { parentData: "retained" } },
            sdkToolRejections: [
              {
                key: "bad-input",
                outcome: {
                  effect: "not_applied",
                  error: { code: "invalid_arguments", phase: "validation" },
                },
              },
              {
                key: "missing-tool",
                outcome: {
                  effect: "not_applied",
                  error: { code: "tool_unavailable", phase: "validation" },
                },
              },
            ],
          },
        });
        expect(report.derived.outcome).toEqual(report.receipt.outcome);
        expect(String(report.childResult.taskId)).toBe(report.receipt.taskId);
        expect(report.childResult.details.outcome).toEqual(report.receipt.outcome);
        expect(report.reopened).toEqual(report.result);
        expect(report.restored).toHaveLength(2);
        expect(report.restored[0].outcome).toEqual(report.receipt.outcome);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
