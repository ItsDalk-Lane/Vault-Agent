import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

interface NativeReport {
  capabilities: {
    read: boolean;
    planWrite: boolean;
    strictCommand: boolean;
    trustedCommand: boolean;
    revokedRead: boolean;
  };
  read: string;
  written: string;
  edited: string;
  vaultDenied: boolean;
  outsideDenied: boolean;
  revokedDenied: boolean;
  reboundDenied: boolean;
  reboundCommandDenied: boolean;
  reboundSpawned: boolean;
  strictSpawned: boolean;
  trusted: string;
  approvals: number;
  planDenied: boolean;
  receipts: number;
  cancelled: string;
  recovery: readonly string[];
  changes: number;
}

const SOURCE = String.raw`
import fs from "node:fs/promises"; import path from "node:path";
import {Harness,createRegistry,defineExtension} from "@earendil-works/pi-durable";
import {openNodeJsonlStorage} from "@earendil-works/pi-durable/storage/jsonl/node";
import {fauxProvider,fauxAssistantMessage,fauxToolCall} from "@earendil-works/pi-ai";
import {createModels} from "@earendil-works/pi-ai/models";
import {BACKGROUND_CONTEXT as context} from "@earendil-works/chord/context";
import {createPiNativeHostTools} from "@/agentMode/sdk/pi/tools/PiNativeHostTools";
import {CapabilityCatalog} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import {createDurableNativeMutationJournal} from "@/agentMode/sdk/pi/storage/DurableMutationJournal";
(async()=>{
 const directory=process.env.FIXTURE_DIR; const vault=path.join(directory,"vault"),external=path.join(directory,"external"),privateDir=path.join(directory,"private");
 await fs.mkdir(vault,{recursive:true});await fs.mkdir(external,{recursive:true});await fs.writeFile(path.join(vault,"note.md"),"vault original");const file=path.join(external,"note.md");await fs.writeFile(file,"before");
 let grants=[{root:external,permissions:["read","write"]}];let mode="default";let executionMode="strict";let approvals=0;let revoke=false;let rebound=false;let reboundCommand=false;let settingsListener;let pendingApproval;let approvalStarted;
 const catalog=new CapabilityCatalog();let changes=0; const nativeOptions={capabilities:catalog,vaultRoot:vault,privateDir,sessionId:"session",getMode:()=>mode,getExecutionMode:()=>executionMode,getExternalScopes:()=>grants,subscribeSettings:listener=>{settingsListener=listener;return()=>{settingsListener=undefined;};},requestPermission:async(request)=>{approvals++;if(revoke)grants=[];if(rebound){const previous=grants;grants=[];settingsListener();grants=previous;settingsListener();}if(reboundCommand){executionMode="strict";settingsListener();executionMode="trusted_host";settingsListener();}if(approvalStarted){approvalStarted();return new Promise(resolve=>{pendingApproval=resolve;});}return {outcome:{outcome:"selected",optionId:"allow_once"}};},onFileChanges:(items)=>{changes+=items.length;}};const native=await createPiNativeHostTools(nativeOptions);
 const allowed=(name,mode="default")=>catalog.filter(name,{caller:"root",mode,trustedHost:executionMode==="trusted_host",scope:{vaultRoot:vault,externalRoots:grants.map(scope=>scope.root),readOnly:false}});
 const capabilities={read:allowed("read"),planWrite:allowed("write","plan"),strictCommand:allowed("bash"),trustedCommand:false,revokedRead:false};
 const provider=fauxProvider();const models=createModels();models.setProvider(provider.provider);const model=provider.getModel();const registry=createRegistry();registry.install(defineExtension({name:"native",tools:native.registrations}));const storage=await openNodeJsonlStorage(path.join(directory,"store"),context);const harness=await Harness.open(storage,{models,registry},context);const root=await harness.root(context,{agent:{model:{provider:model.provider,modelId:model.id}}});await native.bindMutationJournal(await createDurableNativeMutationJournal({harness,conversation:root}));let seq=0;
 const run=async(name,args)=>{let observed;provider.setResponses([fauxAssistantMessage([fauxToolCall(name,args)],{stopReason:"toolUse"}),(input)=>{observed=input.messages.findLast(message=>message.role==="toolResult");return fauxAssistantMessage("done");}]);await (await root.submit({type:"input",requestId:String(++seq),content:name},context)).wait(context);return {isError:observed?.isError===true,text:(observed?.content??[]).filter(item=>item.type==="text").map(item=>item.text).join("\n")};};
 const read=(await run("read",{path:file})).text;
 const writeResult=await run("write",{path:file,content:"after"});if(writeResult.isError)throw new Error(writeResult.text);const written=await fs.readFile(file,"utf8");
 const editResult=await run("edit",{path:file,edits:[{oldText:"after",newText:"edited"}]});if(editResult.isError)throw new Error(editResult.text);const edited=await fs.readFile(file,"utf8");
 const vaultDenied=(await run("write",{path:path.join(vault,"note.md"),content:"bad"})).isError;
 const outsideDenied=(await run("read",{path:path.join(directory,"unapproved.md")})).isError;
 revoke=true;const revokedDenied=(await run("write",{path:file,content:"revoked"})).isError;revoke=false;grants=[{root:external,permissions:["read","write"]}];
 rebound=true;const reboundDenied=(await run("write",{path:file,content:"rebound"})).isError;rebound=false;
 const marker=path.join(external,"spawned");await run("bash",{command:"printf bad > "+marker});const strictSpawned=await fs.access(marker).then(()=>true,()=>false);
 executionMode="trusted_host";capabilities.trustedCommand=allowed("bash");const trusted=(await run("bash",{command:"printf native-command",timeout:2})).text;
 const reboundMarker=path.join(external,"rebound-spawned");reboundCommand=true;const reboundCommandDenied=(await run("bash",{command:"printf bad > "+reboundMarker,timeout:2})).isError;reboundCommand=false;const reboundSpawned=await fs.access(reboundMarker).then(()=>true,()=>false);
 mode="plan";const planDenied=(await run("write",{path:file,content:"forbidden"})).isError;mode="default";
 const started=new Promise(resolve=>{approvalStarted=resolve;});provider.setResponses([fauxAssistantMessage([fauxToolCall("write",{path:file,content:"late write"})],{stopReason:"toolUse"}),fauxAssistantMessage("should not continue")]);const waiting=(await root.submit({type:"input",requestId:"cancel",content:"cancel write"},context)).wait(context);await started;await root.abort(context,{background:true});await waiting;pendingApproval({outcome:{outcome:"selected",optionId:"allow_once"}});const cancelled=await fs.readFile(file,"utf8");
 const durableJournal=await createDurableNativeMutationJournal({harness,conversation:root});const receipts=Object.values((await durableJournal.load()).records).filter(record=>record.state==="committed").length;await fs.access(path.join(privateDir,"native-mutations")).then(()=>{throw new Error("旧账本不应新建");},error=>{if(error.code!=="ENOENT")throw error;});
 const previousGrants=grants;grants=[];capabilities.revokedRead=allowed("read");grants=previousGrants;
 await native.dispose();await native.dispose();await harness.close(context);
 const recoveryPrivate=path.join(directory,"legacy-import");const records=path.join(recoveryPrivate,"native-mutations");await fs.mkdir(records,{recursive:true});const recovery=[];for(const [id,before,after,target] of [["native-committed","before","edited",file],["native-not-applied",null,"new",path.join(external,"missing.md")],["native-unknown","old","new",file]]){await fs.writeFile(path.join(records,id+".json"),JSON.stringify({state:"prepared",intent:{operationId:id,path:target,before,after}}));}
 await fs.writeFile(path.join(records,"broken.json"),"broken");const recovered=await createPiNativeHostTools({...nativeOptions,privateDir:recoveryPrivate});const recoveryStorage=await openNodeJsonlStorage(path.join(directory,"recovery-store"),context);const recoveryHarness=await Harness.open(recoveryStorage,{models,registry:createRegistry()},context);const recoveryRoot=await recoveryHarness.root(context);const recoveryJournal=await createDurableNativeMutationJournal({harness:recoveryHarness,conversation:recoveryRoot});await recovered.bindMutationJournal(recoveryJournal);for(const id of ["native-committed","native-not-applied","native-unknown"]){recovery.push((await recoveryJournal.load()).records[id].state);if(JSON.parse(await fs.readFile(path.join(records,id+".json"),"utf8")).state!=="prepared")throw new Error("旧迁移输入被覆盖");}await recovered.dispose();await recoveryHarness.close(context);
 process.stdout.write(JSON.stringify({capabilities,read,written,edited,vaultDenied,outsideDenied,revokedDenied,reboundDenied,reboundCommandDenied,reboundSpawned,strictSpawned,trusted,approvals,planDenied,receipts,cancelled,recovery,changes}));
})().catch(error=>{process.stderr.write(String(error?.stack??error));process.exitCode=1;});
`;

let directory: string;
let report: NativeReport;

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-native-host-"));
  const target = path.join(directory, "fixture.cjs");
  execFileSync(
    process.execPath,
    [
      "-e",
      'require("esbuild").build({stdin:{contents:process.env.FIXTURE_SOURCE,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",outfile:process.env.FIXTURE_TARGET,alias:{"@":process.cwd()+"/src"},logLevel:"silent",plugins:[{name:"desktop-host",setup(build){build.onResolve({filter:/^(obsidian|@.logger)$/},args=>({path:args.path,namespace:"fixture"}));build.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:args.path==="obsidian"?"export const Platform={isDesktopApp:true,isMobile:false};":"export const logWarn=()=>{};export const logInfo=()=>{};export const logError=()=>{};",loader:"js"}));}}]})',
    ],
    { env: { ...process.env, FIXTURE_SOURCE: SOURCE, FIXTURE_TARGET: target }, timeout: 60_000 }
  );
  report = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, FIXTURE_DIR: directory },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
}, 90_000);
afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("PiNativeHostTools", () => {
  describe("createPiNativeHostTools()", () => {
    it("offers native capabilities only with current folder grants and trusted command availability https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.capabilities).toEqual({
        read: true,
        planWrite: false,
        strictCommand: false,
        trustedCommand: true,
        revokedRead: false,
      });
    });
    it("runs official read, write and edit against an authorized real directory https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.read).toContain("before");
      expect(report.written).toBe("after");
      expect(report.edited).toBe("edited");
      expect(report.receipts).toBe(2);
      expect(report.changes).toBe(2);
    });
    it("reconciles interrupted writes without replay and isolates a malformed journal https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.recovery).toEqual(["committed", "not_applied", "effect_unknown"]);
      expect(report.cancelled).toBe("edited");
    });
    it("rejects Vault targets, missing scopes, revoked grants and plan writes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report).toMatchObject({
        vaultDenied: true,
        outsideDenied: true,
        revokedDenied: true,
        planDenied: true,
      });
    });
    it("invalidates pending file and command approvals when a grant is revoked then restored https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.reboundDenied).toBe(true);
      expect(report.reboundCommandDenied).toBe(true);
      expect(report.reboundSpawned).toBe(false);
      expect(report.cancelled).toBe("edited");
    });
    it("spawns nothing in strict mode and supervises an explicitly approved real command https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.strictSpawned).toBe(false);
      expect(report.trusted).toContain("native-command");
      expect(report.approvals).toBeGreaterThanOrEqual(4);
    });
    it("cancels a real pending approval before any late write and disposes repeatedly https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.cancelled).toBe("edited");
    });
  });
});
