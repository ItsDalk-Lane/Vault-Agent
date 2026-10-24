import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("MutationIdentity", () => {
  describe("createDurableMutationJournal()", () => {
    it("binds one interrupted actual SDK task to its legacy receipt once and blocks ambiguous repeated provider ids without replay https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mutation-identity-"));
      try {
        const source = String.raw`
          import fs from "node:fs/promises";import path from "node:path";import assert from "node:assert/strict";
          import {Harness,createRegistry,defineExtension} from "@earendil-works/pi-durable";
          import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
          import {createModels,fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai";
          import {BACKGROUND_CONTEXT as context} from "@earendil-works/chord/context";
          import {createDurableMutationJournal} from "@/agentMode/sdk/pi/storage/DurableMutationJournal";
          async function main(){
            const base=process.argv[2],provider=fauxProvider(),models=createModels();models.setProvider(provider.provider);const model=provider.getModel();let writes=0,reached;const entered=new Promise(resolve=>reached=resolve);
            const registry=createRegistry();registry.install(defineExtension({name:"identity",tools:[{name:"vault_create",description:"create",parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"}},required:["path","content"]},replay:"unsafe",execute:async(args,api,ctx)=>{writes++;await fs.writeFile(path.join(base,"effect.md"),args.content);reached();await new Promise(resolve=>{if(ctx.abortSignal.aborted)resolve();else ctx.abortSignal.addEventListener("abort",resolve,{once:true});});return {output:"interrupted"};}}]}));
            const open=async()=>Harness.open(await openNodeJsonlStorage(path.join(base,"store"),context,{fsync:true}),{models,registry},context);
            let harness=await open(),conversation=await harness.root(context,{agent:{model:{provider:model.provider,modelId:model.id}}});let store=await createDurableMutationJournal({harness,conversation});
            const args={path:"effect.md",content:"real once"};provider.setResponses([fauxAssistantMessage([{...fauxToolCall("vault_create",args),id:"legacy-call"}],{stopReason:"toolUse"})]);
            const waiting=(await conversation.submit({type:"input",requestId:"old",content:"create"},context)).wait(context).catch(()=>undefined);await entered;
            const legacy={version:1,mutations:{["legacy:"+conversation.id+":legacy-call"]:{operationId:"legacy:"+conversation.id+":legacy-call",path:"effect.md",kind:"create",beforeHash:null,afterHash:"after",beforeBlobRef:null,afterBlobRef:"after-blob",committed:true,state:"committed",effect:"applied"}},reverts:{}};
            await store.save(legacy);await harness.close(context);await waiting;
            harness=await open();conversation=await harness.root(context);store=await createDurableMutationJournal({harness,conversation});
            const pending=(await harness.inspect(context)).tasks.find(task=>task.record.kind==="pi.tool");assert.ok(pending);const id=String(pending.record.id);
            const migrated=await store.migrateOperationIdentities(await store.load());assert.equal(migrated.operationIdentityVersion,2);assert.ok(migrated.legacyTaskOperations[id],JSON.stringify({pending,migrated}));assert.deepEqual(migrated.legacyTaskOperations[id],{operationId:"legacy:"+conversation.id+":legacy-call",toolId:"vault_create",arguments:args});assert.deepEqual(migrated.ambiguousLegacyTasks,[]);await store.save(migrated);
            await conversation.commit(async tx=>{await tx.appendEntry(conversation.id,{kind:"pi.assistant",model:[fauxAssistantMessage([{...fauxToolCall("vault_create",{path:"another.md",content:"different"}),id:"legacy-call"}],{stopReason:"toolUse"})]});},context);
            const ambiguous=await store.migrateOperationIdentities(legacy);assert.deepEqual(ambiguous.ambiguousLegacyTasks,[id]);assert.deepEqual(ambiguous.legacyTaskOperations,{});
            assert.deepEqual(await store.migrateOperationIdentities(migrated),migrated);await conversation.abort(context,{background:true});const stopped=await store.migrateOperationIdentities(ambiguous);assert.deepEqual(stopped.ambiguousLegacyTasks,[]);assert.equal(provider.state.callCount,1);await harness.close(context);
            harness=await open();conversation=await harness.root(context);store=await createDurableMutationJournal({harness,conversation});assert.deepEqual(await store.load(),migrated);assert.equal(writes,1);assert.equal(provider.state.callCount,1);assert.equal(await fs.readFile(path.join(base,"effect.md"),"utf8"),"real once");await harness.close(context);process.stdout.write(JSON.stringify({status:"passed"}));
          }main().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
        `;
        const bundle = path.join(directory, "fixture.cjs");
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").build({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",outfile:process.env.OUT,alias:{"@":process.cwd()+"/src"},plugins:[{name:"desktop",setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"test-host"}));build.onLoad({filter:/.*/,namespace:"test-host"},()=>({contents:"export const Platform={isDesktopApp:true,isMobile:false};",loader:"js"}));}}],logLevel:"silent"})',
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
        ).toEqual({ status: "passed" });
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
