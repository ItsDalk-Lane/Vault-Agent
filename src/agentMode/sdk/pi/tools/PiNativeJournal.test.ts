import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("PiNativeJournal", () => {
  describe("createPiNativeHostTools()", () => {
    it("ignores old files and keeps current file and command lifecycle in the durable document after a cold reopen https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-native-journal-"));
      try {
        const source = String.raw`
          import fs from "node:fs/promises"; import path from "node:path";
          import assert from "node:assert/strict";
          import { Harness, createRegistry, defineExtension } from "@earendil-works/pi-durable";
          import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
          import { fauxProvider,fauxAssistantMessage,fauxToolCall,createModels } from "@earendil-works/pi-ai";
          import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
          import { createPiNativeHostTools } from "@/agentMode/sdk/pi/tools/PiNativeHostTools";
          import { createDurableMutationJournal,createDurableNativeMutationJournal } from "@/agentMode/sdk/pi/storage/DurableMutationJournal";
          async function main() {
            const base=process.argv[2], vault=path.join(base,"vault"), external=path.join(base,"external"), privateDir=path.join(base,"private"), receipts=path.join(privateDir,"native-mutations");
            await fs.mkdir(vault,{recursive:true}); await fs.mkdir(external,{recursive:true});await fs.mkdir(receipts,{recursive:true});
            const target=path.join(external,"note.md");await fs.writeFile(target,"already applied");
            const legacy="unread malformed old mutation";
            const oldPath=path.join(receipts,"native-import.json"),oldCommand=path.join(privateDir,"command-intent-old.json");await fs.writeFile(oldPath,legacy);await fs.writeFile(oldCommand,"unread old command");
            const options={vaultRoot:vault,privateDir,sessionId:"native",getMode:()=>"default",getExecutionMode:()=>"trusted_host",getExternalScopes:()=>[{root:external,permissions:["read","write"]}],requestPermission:async()=>({outcome:{outcome:"selected",optionId:"allow_once"}})};
            let storageChecks=0;options.beforeOperation=async()=>{storageChecks++;};
            const provider=fauxProvider(),models=createModels();models.setProvider(provider.provider);const model=provider.getModel();
            async function open() {
              const native=await createPiNativeHostTools(options);await assert.rejects(native.reconcile(),/尚未绑定/);const registry=createRegistry();registry.install(defineExtension({name:"native",tools:native.registrations}));
              const harness=await Harness.open(await openNodeJsonlStorage(path.join(base,"store"),context),{models,registry},context);
              const root=await harness.root(context,{agent:{model:{provider:model.provider,modelId:model.id}}});
              const journal=await createDurableNativeMutationJournal({harness,conversation:root});await native.bindMutationJournal(journal);await assert.rejects(native.bindMutationJournal(journal),/已绑定/);return {native,harness,root,journal};
            }
            const readdir=fs.readdir;fs.readdir=async(target,...args)=>{if(target===receipts||target===privateDir)throw new Error("Old data must not be scanned");return readdir(target,...args);};
            let current;try{current=await open();}finally{fs.readdir=readdir;}assert.equal(await fs.readFile(oldPath,"utf8"),legacy);assert.equal(await fs.readFile(oldCommand,"utf8"),"unread old command");
            assert.deepEqual(await current.journal.load(),{version:1,records:{}});assert.deepEqual(current.native.recovery.decisions,[]);
            const vaultJournal=await createDurableMutationJournal({harness:current.harness,conversation:current.root});await vaultJournal.save({version:1,mutations:{},reverts:{}});
            let requestSequence=0;async function run(name,args,expectedError=false) {let observed;provider.setResponses([fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:"toolUse"}),input=>{observed=input.messages.findLast(message=>message.role==="toolResult");return fauxAssistantMessage("done");}]);await (await current.root.submit({type:"input",requestId:name+"-"+(++requestSequence),content:name},context)).wait(context);assert.equal(observed.isError,expectedError);return observed;}
            const written=await run("write",{path:target,content:"new content"});assert.equal(written.details.outcome.effect,"applied");assert.deepEqual(written.details.outcome.receipts,[written.details.outcome.data.receipt.operationId]);assert.equal(written.details.receipt,undefined);
            const missing=await run("read",{path:path.join(external,"missing.md")},true);assert.equal(missing.details.outcome.effect,"not_applied");assert.ok(missing.details.outcome.error.code);assert.deepEqual(missing.details.outcome.nextActions,["revise_request"]);
            await run("bash",{command:"printf native-durable",timeout:2});
            const failedCommand=await run("bash",{command:"printf expected-failure; exit 1",timeout:2},true);assert.equal(failedCommand.details.outcome.effect,"applied");assert.equal(failedCommand.details.outcome.error.code,"NONZERO_EXIT");assert.deepEqual(failedCommand.details.outcome.nextActions,["revise_request"]);assert.equal(failedCommand.details.outcome.receipts.length,1);const failedReceipt=(await current.journal.load()).records[failedCommand.details.outcome.receipts[0]];assert.equal(failedReceipt.started,true);assert.equal(failedReceipt.exited,true);assert.equal(failedReceipt.result.exitCode,1);
            assert.ok(storageChecks>=4,"native file and program effects must pass actual host operation gates");
            const saved=await current.journal.load();assert.equal(Object.keys(saved.records).length,3);assert.ok(Object.values(saved.records).some(record=>record.state==="command_settled"&&record.result.status==="completed"));
            assert.deepEqual(await fs.readdir(receipts),["native-import.json"]);assert.deepEqual((await fs.readdir(privateDir)).filter(file=>file.startsWith("command-intent-")),["command-intent-old.json"]);assert.equal(await fs.readFile(oldCommand,"utf8"),"unread old command");
            assert.equal(await fs.readFile(oldPath,"utf8"),legacy);await current.native.dispose();await current.harness.close(context);
            await fs.writeFile(oldPath,"corrupted backup must not become authority");current=await open();
            assert.deepEqual(await current.journal.load(),saved);assert.equal(provider.state.callCount,8);assert.equal(current.native.recovery.decisions.length,0);assert.equal((await current.harness.inspect(context)).tasks.length,0);
            let gateCount=0;options.beforeOperation=async()=>{if(++gateCount===2)throw new Error("operation gate");};
            const uncertain=await run("write",{path:target,content:"must not reach filesystem"},true);assert.equal(uncertain.details.outcome.effect,"unknown");assert.equal(uncertain.details.outcome.error.code,"EFFECT_UNKNOWN");assert.deepEqual(uncertain.details.outcome.nextActions,["read","reconcile"]);assert.equal(await fs.readFile(target,"utf8"),"new content");const checked=await current.native.reconcile();assert.ok(checked.decisions.some(item=>item.canReapprove&&item.canContinue));
            await current.native.dispose();await current.harness.close(context);
            process.stdout.write(JSON.stringify({status:"passed"}));
          }main().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
        `;
        const bundle = path.join(directory, "fixture.cjs");
        execFileSync(
          process.execPath,
          [
            "-e",
            'require("esbuild").build({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",outfile:process.env.OUT,alias:{"@":process.cwd()+"/src"},logLevel:"silent",plugins:[{name:"host",setup(build){build.onResolve({filter:/^(obsidian|@.logger)$/},args=>({path:args.path,namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="obsidian"?"export const Platform={isDesktopApp:true,isMobile:false};":"export const logWarn=()=>{};export const logInfo=()=>{};export const logError=()=>{};",loader:"js"}));}}]})',
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
