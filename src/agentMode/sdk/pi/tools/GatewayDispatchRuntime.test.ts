import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("GatewayDispatchRuntime", () => {
  describe("executeTool()", () => {
    it("persists the actual SDK denial after audit cancellation or MCP intent-time withdrawal and cold opens without dispatch https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-dispatch-"));
      try {
        const source = String.raw`
          import assert from "node:assert/strict";
          import {Harness,createRegistry,defineExtension,defineDoc} from "@earendil-works/pi-durable";
          import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
          import {fauxProvider,fauxAssistantMessage,fauxToolCall,createModels} from "@earendil-works/pi-ai";
          import {BACKGROUND_CONTEXT as c} from "@earendil-works/chord/context";
          import {ToolGateway} from "@/agentMode/sdk/pi/tools/ToolGateway";
          import {ToolRegistry} from "@/agentMode/sdk/pi/tools/ToolRegistry";
          import {defineToolManifest} from "@/agentMode/sdk/pi/policy/ToolManifest";
          import {PolicyEngine} from "@/agentMode/sdk/pi/policy/PolicyEngine";
          import {AuditLog} from "@/agentMode/sdk/pi/policy/AuditLog";
          import {McpCatalog} from "@/agentMode/sdk/pi/mcp/McpCatalog";
          import {McpToolAdapter} from "@/agentMode/sdk/pi/mcp/McpToolAdapter";
          import {createMcpEffectGuard} from "@/agentMode/sdk/pi/mcp/McpEffectGuard";
          (async()=>{
            const modelProvider=fauxProvider(),model=modelProvider.getModel(),models=createModels();models.setProvider(modelProvider.provider);
            const registry=createRegistry();let root;let hostCalls=0;let externalCalls=0;
            const auditDoc=defineDoc({kind:"test.dispatch.audit",version:1,scope:"conversation",history:"latest",fork:"initial",initial:()=>({records:[]})});
            const abort=new AbortController();
            const manifest=defineToolManifest({toolId:"guarded_write",family:"vault",effects:["write"],allowedCallers:["root"],parameters:{type:"object"},extractTargets:()=>[],implementationVersion:1,schemaVersion:1,replayPolicy:"unsafe",maxOutputBytes:4096});
            const toolRegistry=new ToolRegistry();toolRegistry.register(manifest,"host");
            const gateway=new ToolGateway({registry:toolRegistry,policy:new PolicyEngine(),requestApproval:async()=>"approved",audit:new AuditLog({sink:{write:async(record)=>{await root.commit(async tx=>{(await tx.doc(auditDoc,root.id)).records.push(record);},c);if(record.status==="approved")abort.abort();}}})});
            gateway.registerTool({toolId:manifest.toolId,manifest,execute:async()=>{hostCalls++;return {content:"must not run"};}});
            registry.install(defineExtension({name:"gateway",tools:[{name:manifest.toolId,description:"guarded write",parameters:{type:"object"},replay:"unsafe",execute:async(_,api)=>{const result=await gateway.executeTool(manifest.toolId,{}, {operationId:"audit-cancel",caller:"root",mode:"default",scope:{vaultRoot:"",externalRoots:[],readOnly:false},scopeVersion:1,policyVersion:1,targets:[],signal:abort.signal});return {isError:result.decision==="deny",output:[{type:"text",text:JSON.stringify(result.outcome)}],details:{outcome:result.outcome}};}}]}));
            const open=async()=>Harness.open(await openNodeJsonlStorage(process.argv[2]+"/store",c,{fsync:true}),{models,registry},c);
            let harness=await open();root=await harness.root(c,{agent:{model:{provider:model.provider,modelId:model.id}}});
            const actualEffects=await createMcpEffectGuard({harness,conversationId:String(root.id)});
            const catalog=new McpCatalog({serverId:"service",client:{listToolsPage:async()=>({tools:[{name:"change",inputSchema:{type:"object"}}],nextCursor:null})}});await catalog.refresh();
            let current=true;
            const adapter=new McpToolAdapter({serverId:"service",catalog,client:{callTool:async()=>{externalCalls++;return {content:[{type:"text",text:"must not run"}]};}},checkAvailability:()=>({available:current}),gateway:{authorize:async()=>({allowed:true,revalidate:()=>current})},effects:{get recovery(){return actualEffects.recovery;},begin:async(...args)=>{const result=await actualEffects.begin(...args);current=false;return result;},complete:(...args)=>actualEffects.complete(...args),reconcile:()=>actualEffects.reconcile()}});
            const external=adapter.registrations()[0];registry.install(defineExtension({name:"mcp",tools:[external]}));
            for(const [index,name] of [manifest.toolId,external.name].entries()){
              let observed;modelProvider.setResponses([fauxAssistantMessage([fauxToolCall(name,{})],{stopReason:"toolUse"}),input=>{observed=input.messages.findLast(message=>message.role==="toolResult");return fauxAssistantMessage("failure received");}]);
              await(await root.submit({type:"input",requestId:"request-"+index,content:name},c)).wait(c);
              assert.equal(observed.isError,true);assert.equal(observed.details.outcome.effect,"not_applied");
            }
            assert.equal(hostCalls,0);assert.equal(externalCalls,0);
            const records=(await harness.snapshot(auditDoc,root.id,c)).records;assert.deepEqual(records.map(record=>record.status),["approved","cancelled"]);
            assert.equal(actualEffects.recovery.decisions[0].effect,"not_applied");
            const calls=modelProvider.state.callCount;await harness.close(c);harness=await open();root=await harness.root(c);
            const restored=await createMcpEffectGuard({harness,conversationId:String(root.id)});assert.equal(restored.recovery.decisions[0].effect,"not_applied");
            const entries=(await root.entries({order:"ascending"},100,undefined,c)).items;
            const results=entries.filter(entry=>entry.kind==="pi.tool-result");assert.equal(results.length,2);for(const result of results)assert.equal(result.model[0].details.outcome.effect,"not_applied");
            assert.equal(modelProvider.state.callCount,calls);assert.equal(hostCalls+externalCalls,0);await harness.close(c);
            process.stdout.write(JSON.stringify({status:"passed",modelCalls:calls,hostCalls,externalCalls,denials:results.length}));
          })().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
        `;
        const bundle = path.join(directory, "scenario.cjs");
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").build({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",outfile:process.env.OUT,alias:{"@":process.cwd()+"/src"},logLevel:"silent",plugins:[{name:"desktop",setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export const Platform={isDesktopApp:true,isMobile:false};",loader:"js"}));}}]})',
          ],
          { env: { ...process.env, SCENARIO: source, OUT: bundle } }
        );
        expect(
          JSON.parse(
            execFileSync(process.execPath, [bundle, directory], {
              encoding: "utf8",
              timeout: 30_000,
            })
          )
        ).toEqual({ status: "passed", modelCalls: 4, hostCalls: 0, externalCalls: 0, denials: 2 });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
