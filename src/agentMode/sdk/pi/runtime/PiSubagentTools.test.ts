import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

interface SmokeReport {
  profileDiscovery: {
    schemaChoices: readonly string[][];
    invalidResult: string;
    disabledResult: string;
  };
  unified: {
    candidateOwned: boolean;
    candidateInstructions: { roleInstructions: string; cwd: string; readOnly: boolean };
    sameCandidate: boolean;
    candidateCaller: string;
    candidateReadOnly: boolean;
    candidateTools: readonly string[];
    scheduledValue: number;
    noWakeRequests: number;
    duplicateCount: number;
    accepted: string;
    conflictDenied: boolean;
    peerDenied: boolean;
    waitReason: string;
    senderVerified: boolean;
    cancellation: string;
    timeout: string;
    terminal: string;
    stoppedGroupDenied: boolean;
    candidateAnswerPreserved: boolean;
    stopCancelsCandidate: boolean;
    lateResultNotRevive: boolean;
    explicitResume: boolean;
    restoredMessages?: number;
  };
  foreground: {
    instructionContext: {
      roleInstructions: string;
      readOnly: boolean;
      outputPaths: readonly string[];
    };
    childCount: number;
    unifiedOutcome: boolean;
    text: string;
    readOnly: boolean;
    modelKey: string | null;
    parentRunId: string | null;
  };
  background: { childCount: number; reportCount: number; status: string; answer: string };
  duplicate: { childCount: number; requests: number };
  reopened: { childCount: number; requests: number; historyCount: number };
  control: { answer: string; reports: number };
  recoveredCompleted: { requests: number; answer: string };
  resumedMessage: string;
  stopped: { status: string; reports: number };
  resumed: { status: string; answer: string };
  failed: { status: string };
  writer: {
    allowed: boolean;
    denied: boolean;
    inputWriteDenied: boolean;
    outputWriteAllowed: boolean;
    cursorInputPreserved: boolean;
    tools: readonly string[];
  };
  identity: {
    legacyRole: string;
    rootCaller: string;
    childCaller: string;
    unknownReadOnly: boolean;
    unknownMode: string;
    unknownModel: string | null;
    unknownRun: string | null;
    unknownTask: unknown;
    rootScope: boolean;
    childScope: boolean;
    deniedScope: boolean;
    childTask: string;
    rootMode: string;
    historyDenied: boolean;
  };
}

const SOURCE = String.raw`
import { Harness, createRegistry, defineExtension, defineDoc } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createPiSubagentTools } from "@/agentMode/sdk/pi/runtime/PiSubagentTools";
import { CapabilityCatalog } from "@/agentMode/sdk/pi/policy/CapabilityCatalog";
import { RunBudget } from "@/agentMode/sdk/pi/runtime/RunBudget";
(async () => {
  globalThis.window=globalThis;
  const rootProvider = fauxProvider({ provider: "root-test", api: "root-test-api" });
  const childProvider = fauxProvider({ provider: "child-test", api: "child-test-api" });
  const models = createModels(); models.setProvider(rootProvider.provider); models.setProvider(childProvider.provider);
  const rootModel = rootProvider.getModel(); const childModel = childProvider.getModel();
  const catalog = { readyModels: [
    { configuredModelId: "root-config", providerInstanceId: rootModel.provider, upstreamModelId: rootModel.id, contextWindow: 200000 },
    { configuredModelId: "child-config", providerInstanceId: childModel.provider, upstreamModelId: childModel.id, contextWindow: 200000 }
  ] };
  const run = { id: "run-1", budget: new RunBudget(), signal: new AbortController().signal };
  const registry = createRegistry();
  registry.install(defineExtension({ name: "vault-fixture", tools: [{ name: "vault_read", description: "read", parameters: { type: "object" }, execute: async (args) => ({ output: [{ type: "text", text: JSON.stringify({ok:true,value:args.cursor?{content:"line",truncated:false}:{content:"single",truncated:true,nextCursor:"opaque-continuation"}}) }] }) }] }));
  const storage = await openNodeJsonlStorage(process.env.STORE_DIR, context);
  const harness = await Harness.open(storage, { models, registry }, context);
  const root = await harness.root(context, { agent: { model: { provider: rootModel.provider, modelId: rootModel.id } } });
  const updates=[];
  const capabilities=new CapabilityCatalog(); capabilities.register({toolId:"vault_read",family:"vault",effects:["read"],allowedCallers:["root","subagent","fanout"]});
  let activeProfiles = ["researcher","reviewer","writer"];
  const options = { capabilities, harness, conversation: root, sessionId: "root-session", models: { models, catalog }, getModelKey: () => "root-config", getMode: () => "default", getRun: () => run, emit: (update) => updates.push(update), isPathInScope: (target) => target.startsWith("notes/"), enabledProfiles: () => activeProfiles };
  const service = await createPiSubagentTools(options); registry.install(service.extension);
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task", {profileId:"researcher", task:"Investigate", description:"Read-only investigation", modelKey:"child-config"})], { stopReason:"toolUse" }), fauxAssistantMessage("root complete")]);
  childProvider.setResponses([fauxAssistantMessage("real foreground answer")]);
  await (await root.submit({type:"input",requestId:"foreground",content:"delegate"},context)).wait(context);
  const firstChildren = await service.list(); const first = firstChildren[0];
  const firstToolResult=(await root.entries({order:"ascending"},100,undefined,context)).items.find(entry=>entry.kind==="pi.tool-result");
  const toolDetails=firstToolResult.model[0].details;
  const unifiedOutcome=Object.keys(toolDetails).length===1 && toolDetails.outcome?.source.toolId==="delegate_task" && toolDetails.outcome?.data.childConversationId===first.conversationId && toolDetails.outcome?.status==="success" && toolDetails.outcome.receipts.includes(first.conversationId);
  const foreground = { instructionContext:service.getInstructionContextForConversation(first.conversationId), unifiedOutcome, childCount: firstChildren.length, text: first.answer ?? "", readOnly: service.isReadOnly(first.conversationId), modelKey: service.getModelKeyForConversation(first.conversationId), parentRunId: service.getParentRunIdForConversation(first.conversationId) };
  const schemaChoices = ["delegate_task","start_background_task"].map(name => service.registrations.find(tool=>tool.name===name).parameters.properties.profileId.enum);
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"explore",task:"Do not start",description:"Unknown role"})],{stopReason:"toolUse"}),fauxAssistantMessage("corrected from available roles")]);
  await (await root.submit({type:"input",requestId:"unknown-profile",content:"invalid role"},context)).wait(context);
  const invalidResult=JSON.stringify((await root.entries({order:"ascending"},1000,undefined,context)).items.filter(entry=>entry.kind==="pi.tool-result").at(-1));
  activeProfiles=["reviewer"];
  const disabled=await service.registrations.find(tool=>tool.name==="delegate_task").execute({profileId:"writer",task:"Do not write",description:"Revoked role"},{conversationId:root.id,taskId:999,callId:"disabled-role",agent:()=>root.agent(context)},context);
  activeProfiles=["researcher","reviewer","writer"];
  const profileDiscovery={schemaChoices,invalidResult,disabledResult:JSON.stringify(disabled)};
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task", {profileId:"researcher", task:"Background investigation", description:"Background", modelKey:"child-config", commandId:"bg-1"})], { stopReason:"toolUse" }), fauxAssistantMessage("launched")]);
  childProvider.setResponses([fauxAssistantMessage("real background answer")]);
  await (await root.submit({type:"input",requestId:"background",content:"start background"},context)).wait(context);
  await service.waitForBackground();
  const all = await service.list(); const bg = all.find(item => item.background);
  const entries = await root.entries({order:"ascending"},1000,undefined,context);
  const background = { childCount: all.length, reportCount: entries.items.filter(item=>item.kind==="va.subagent.report").length, status:bg.status, answer:bg.answer };
  const completedBefore=childProvider.state.callCount;
  const recoveryDoc=defineDoc({kind:"va.subagents",version:1,scope:"conversation",history:"rewindable",fork:"initial",initial:()=>({revision:0,children:{},commands:{},reports:{}})});
  await root.commit(async tx=>{const state=await tx.doc(recoveryDoc,root.id);state.children[first.conversationId].status="interrupted";delete state.children[first.conversationId].answer;delete state.children[first.conversationId].answerEntryId;delete state.children[first.conversationId].roleInstructions;},context);
  await service.resume(first.taskId);await service.resume(bg.taskId);await service.waitForBackground();
  const recoveredCompleted={requests:childProvider.state.callCount-completedBefore,answer:(await service.list()).find(child=>child.taskId===first.taskId).answer};
  const before = childProvider.state.callCount;
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task", {profileId:"researcher", task:"Background investigation", description:"Background", modelKey:"child-config", commandId:"bg-1"})], { stopReason:"toolUse" }), fauxAssistantMessage("already started")]);
  await (await root.submit({type:"input",requestId:"duplicate",content:"same command"},context)).wait(context);
  await service.waitForBackground();
  const duplicate = { childCount:(await service.list()).length, requests:childProvider.state.callCount-before };
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("send_subagent_message", {taskId:bg.taskId,message:"Follow up",commandId:"follow-1",wake:true})], {stopReason:"toolUse"}), fauxAssistantMessage("followed")]);
  childProvider.setResponses([fauxAssistantMessage("real follow-up answer")]);
  await (await root.submit({type:"input",requestId:"follow",content:"follow"},context)).wait(context); await service.waitForBackground();
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("get_subagent_result", {taskId:bg.taskId}),fauxToolCall("list_subagents", {})], {stopReason:"toolUse"}), fauxAssistantMessage("inspected")]);
  await (await root.submit({type:"input",requestId:"inspect",content:"inspect"},context)).wait(context);
  const followed=(await service.list()).find(item=>item.taskId===bg.taskId);
  const control={answer:followed.answer,reports:(await root.entries({order:"ascending"},1000,undefined,context)).items.filter(item=>item.kind==="va.subagent.report").length};
  let childStarted; const started=new Promise(resolve=>{childStarted=resolve;});
  childProvider.setResponses([(_input, opts)=>new Promise(resolve=>{ opts.signal.addEventListener("abort",()=>resolve(fauxAssistantMessage("late answer must be discarded")),{once:true}); childStarted(); })]);
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task", {profileId:"researcher",task:"Wait",description:"Cancellable",modelKey:"child-config",commandId:"bg-stop"})],{stopReason:"toolUse"}),fauxAssistantMessage("waiting")]);
  await (await root.submit({type:"input",requestId:"stop-test",content:"start"},context)).wait(context); await started;
  const waitingChild=(await service.list()).find(item=>item.description==="Cancellable");
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("send_subagent_message",{taskId:waitingChild.taskId,message:"Resume the latest follow-up",commandId:"queued-follow-up",wake:true})],{stopReason:"toolUse"}),fauxAssistantMessage("queued")]);
  await (await root.submit({type:"input",requestId:"queued-follow-up",content:"follow"},context)).wait(context);
  await service.stopAll(); await service.waitForBackground();
  const stoppedChild=(await service.list()).find(item=>item.description==="Cancellable");
  const stopped={status:stoppedChild.status,reports:(await root.entries({order:"ascending"},1000,undefined,context)).items.filter(item=>item.kind==="va.subagent.report").length};
  let resumedMessage="";childProvider.setResponses([(input)=>{resumedMessage=input.messages.findLast(message=>message.role==="user").content;return fauxAssistantMessage("resumed child answer");}]);
  await service.resume(stoppedChild.taskId); await service.waitForBackground();
  const resumedChild=(await service.list()).find(item=>item.taskId===stoppedChild.taskId); const resumed={status:resumedChild.status,answer:resumedChild.answer};
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("stop_subagent",{taskId:bg.taskId})],{stopReason:"toolUse"}),fauxAssistantMessage("stopped completed child")]);
  await (await root.submit({type:"input",requestId:"stop-tool",content:"stop"},context)).wait(context);
  let historyDenied=false; try { await service.readChildHistory("99999"); } catch { historyDenied=true; }
  const identity={legacyRole:service.getInstructionContextForConversation(first.conversationId).roleInstructions,rootCaller:service.getCaller(String(root.id)),childCaller:service.getCaller(first.conversationId),unknownReadOnly:service.isReadOnly("99999"),unknownMode:service.getModeForConversation("99999"),unknownModel:service.getModelKeyForConversation("99999"),unknownRun:service.getParentRunIdForConversation("99999"),unknownTask:service.getChildTaskForConversation("99999"),rootScope:service.isPathInScope("notes/a.md"),childScope:service.isPathInScope("notes/a.md",first.conversationId),deniedScope:service.isPathInScope("elsewhere/a.md",first.conversationId),childTask:service.getChildTaskForConversation(first.conversationId).taskId,rootMode:service.getModeForConversation(String(root.id)),historyDenied};
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"writer",task:"Draft",description:"Writer",modelKey:"child-config",inputFiles:["notes/approved.md"],outputPaths:["notes/new-output.md"]})],{stopReason:"toolUse"}),fauxAssistantMessage("drafted")]);
  childProvider.setResponses([fauxAssistantMessage("writer suggestion")]);
  await (await root.submit({type:"input",requestId:"writer",content:"draft"},context)).wait(context);
  const writerChild=(await service.list()).find(item=>item.profileId==="writer");
  const writer={allowed:service.isPathInScope("notes/approved.md",writerChild.conversationId),denied:service.isPathInScope("notes/other.md",writerChild.conversationId),inputWriteDenied:!service.isPathInScope("notes/approved.md",writerChild.conversationId,"write"),outputWriteAllowed:service.isPathInScope("notes/new-output.md",writerChild.conversationId,"write"),cursorInputPreserved:JSON.parse(writerChild.content).inputFiles[0].content==="singleline",tools:writerChild.scope.tools};
  childProvider.setResponses([fauxAssistantMessage("",{stopReason:"error",errorMessage:"offline"})]);
  rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"researcher",task:"Fails",description:"Failure",modelKey:"child-config"})],{stopReason:"toolUse"}),fauxAssistantMessage("failure handled")]);
  await (await root.submit({type:"input",requestId:"failure",content:"fail"},context)).wait(context);
  const failed={status:(await service.list()).find(item=>item.description==="Failure").status};
  await service.resume(first.taskId);
  await Promise.all([service.beginCandidateGroup({runId:"candidate-group",budget:run.budget}),service.beginCandidateGroup({runId:"candidate-group",budget:run.budget})]);
  const candidate=await service.createReadOnlyCandidate({sessionId:"candidate-session",parentRunId:"candidate-group",modelKey:"child-config",cwd:"notes"});
  const sameCandidate=await service.createReadOnlyCandidate({sessionId:"candidate-session",parentRunId:"candidate-group",modelKey:"child-config",cwd:"notes"});
  const ownedCandidate=await harness.commit(tx=>tx.conversation(Number(candidate.conversationId)),context);
  await service.setCandidateState(candidate.conversationId,"running");
  const scheduledValue=await service.runCandidate(candidate.conversationId,async()=>42);
  await service.setCandidateState(candidate.conversationId,"completed",{answer:"saved candidate answer"});
  const mailboxBefore=childProvider.state.callCount;
  const firstMessage=await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:first.taskId,message:"Do not start a new request",messageId:"passive-1"});
  await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:first.taskId,message:"Do not start a new request",messageId:"passive-1"});
  await service.waitForBackground();
  let conflictDenied=false;try{await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:first.taskId,message:"conflicting content",messageId:"passive-1"});}catch{conflictDenied=true;}
  let peerDenied=false;try{await service.sendMessage({senderConversationId:first.conversationId,recipientTaskId:writerChild.taskId,message:"unapproved peer",messageId:"peer-1"});}catch{peerDenied=true;}
  const priorSequence=Math.max(0,...(await service.messages()).filter(m=>m.recipient==="root:"+root.id).map(m=>m.sequence));
  const pendingMessage=service.wait({conversationId:String(root.id),afterSequence:priorSequence});
  const sentUp=await service.sendMessage({senderConversationId:first.conversationId,recipientTaskId:"parent",message:"child report",messageId:"up-1"});
  const received=await pendingMessage;
  await service.waitForBackground();
  const cancelledWait=new AbortController();cancelledWait.abort();
  const cancellation=await service.wait({conversationId:String(root.id),afterSequence:sentUp.sequence},cancelledWait.signal);
  const timeout=await service.wait({conversationId:String(root.id),afterSequence:sentUp.sequence,timeoutMs:0});
  const terminal=await service.wait({conversationId:String(root.id),afterSequence:sentUp.sequence,taskIds:[first.taskId],timeoutMs:0});
  await service.setCandidateState(candidate.conversationId,"running");
  let markCandidateStarted;const candidateStarted=new Promise(resolve=>{markCandidateStarted=resolve;});
  const candidateAction=service.runCandidate(candidate.conversationId,signal=>new Promise((resolve,reject)=>{signal.addEventListener("abort",()=>reject(new Error("candidate stopped")),{once:true});markCandidateStarted();}));
  const candidateCancelled=candidateAction.then(()=>false,error=>error.message==="candidate stopped");
  await candidateStarted;
  await service.stopCandidateGroup("candidate-group");
  const stopCancelsCandidate=await candidateCancelled;
  await service.setCandidateState(candidate.conversationId,"completed",{answer:"late result"});
  const lateResultNotRevive=(await service.list()).find(c=>c.conversationId===candidate.conversationId).status==="cancelled";
  let stoppedGroupDenied=false;try{await service.beginCandidateGroup({runId:"candidate-group",budget:run.budget});}catch{stoppedGroupDenied=true;}
  await service.beginCandidateGroup({runId:"candidate-group",budget:run.budget,resume:true});
  await service.setCandidateState(candidate.conversationId,"running");
  const explicitResume=await service.runCandidate(candidate.conversationId,async()=>true);
  await service.setCandidateState(candidate.conversationId,"completed",{answer:"saved candidate answer"});
  const savedMessages=await service.messages();
  const unified={candidateInstructions:service.getInstructionContextForConversation(candidate.conversationId),stopCancelsCandidate,lateResultNotRevive,explicitResume,candidateOwned:String(ownedCandidate.owner?.taskId)===candidate.ownerTaskId,sameCandidate:sameCandidate.conversationId===candidate.conversationId,candidateCaller:service.getCaller(candidate.conversationId),candidateReadOnly:service.isReadOnly(candidate.conversationId),candidateTools:(await (await harness.conversation(Number(candidate.conversationId),context)).agent(context)).callable.map(t=>t.name),scheduledValue,noWakeRequests:childProvider.state.callCount-mailboxBefore,duplicateCount:savedMessages.filter(m=>m.messageId===firstMessage.messageId).length,accepted:savedMessages.find(m=>m.messageId===firstMessage.messageId).ack,conflictDenied,peerDenied,waitReason:received.reason,senderVerified:received.messages[0].sender===first.taskId,cancellation:cancellation.reason,timeout:timeout.reason,terminal:terminal.reason,stoppedGroupDenied,candidateAnswerPreserved:(await service.list()).find(c=>c.conversationId===candidate.conversationId).answer==="saved candidate answer"};
  const reopenBefore=childProvider.state.callCount;
  await service.dispose(); await service.dispose(); await harness.close(context);
  const reopenedStorage = await openNodeJsonlStorage(process.env.STORE_DIR,context);
  const reopenedRegistry = createRegistry(); const reopenedHarness = await Harness.open(reopenedStorage,{models,registry:reopenedRegistry},context); const reopenedRoot=await reopenedHarness.root(context);
  const reopenedService=await createPiSubagentTools({...options,harness:reopenedHarness,conversation:reopenedRoot}); reopenedRegistry.install(reopenedService.extension);
  const saved=await reopenedService.list();
  const reopened={childCount:saved.length,requests:childProvider.state.callCount-reopenBefore,historyCount:(await reopenedService.readChildHistory(first.conversationId)).length};
  unified.restoredMessages=(await reopenedService.messages()).length;
  await reopenedService.dispose(); await reopenedHarness.close(context);
  process.stdout.write(JSON.stringify({profileDiscovery,foreground,background,duplicate,control,stopped,resumed,identity,writer,failed,recoveredCompleted,resumedMessage,reopened,unified})+"\n");
})().catch(error=>{ process.stderr.write(String(error?.stack??error)); process.exitCode=1; });
`;

let directory: string;
let report: SmokeReport;
let nestedReport: {
  busyChildren: number;
  busyErrors: number;
  depth: number;
  canDelegate: boolean;
  linkedCard: boolean;
};
let ownershipReport: {
  startedBeforeAnswer: boolean;
  parentToolTerminal: boolean;
  ownerTerminal: boolean;
  waited: string;
  messageAck: string;
  stopped: string;
  oldOwnerTerminal: boolean;
  orphanOwnerReplaced: boolean;
  oldChildRemainsStopped: boolean;
  abortedBeginDenied: boolean;
};
let checkpointResumeReport: {
  writes: string;
  userInputs: number;
  sameReporterIds: boolean;
  parentRunId: string;
  resolvedRuns: string[];
  answer: string;
  oldRequestStatus: string;
  recoveredPassiveAck: string;
  revokedReadOnly: boolean;
  stoppedAfterReenable: boolean;
};
let crashRecovery: {
  beforeStatus: string;
  beforeRequests: number;
  afterStatus: string;
  answer: string;
  requests: number;
};

let failedEarlierRequestReport: {
  prematureFailure: boolean;
  pendingStatus: string;
  pendingAnswer?: string;
  resultReady: boolean;
  finalAnswer: string;
  coldRequests: number;
};
let sequentialRequestReport: {
  pendingAnswer?: string;
  resultReady: boolean;
  finalAnswer: string;
  reports: number;
};
let overlappingRequestReport: {
  pendingStatus: string;
  pendingAnswer?: string;
  waitStatus: string;
  resultReady: boolean;
  finalAnswer: string;
  coldRequests: number;
  reports: number;
};

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-smoke-"));
  const target = path.join(directory, "smoke.cjs");
  const obsidianHost = path.join(directory, "obsidian-host.ts");
  fs.writeFileSync(obsidianHost, 'export const moment = { locale: () => "en" };\n');
  const buildEnvironment = { ...process.env, SMOKE_OBSIDIAN_HOST: obsidianHost };
  const script = `require("esbuild").buildSync({stdin:{contents:process.env.SMOKE_SOURCE,resolveDir:process.cwd(),loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",outfile:process.env.SMOKE_TARGET,alias:{"@":process.cwd()+"/src",obsidian:process.env.SMOKE_OBSIDIAN_HOST},logLevel:"silent"})`;
  execFileSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: {
      ...buildEnvironment,
      SMOKE_SOURCE: SOURCE,
      SMOKE_TARGET: target,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  report = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const prefix = SOURCE.slice(0, SOURCE.indexOf("  rootProvider.setResponses("));
  const overlapSource =
    prefix +
    String.raw`
    let releaseA, releaseB, startedA, startedB;
    const aStarted=new Promise(resolve=>{startedA=resolve;}); const bStarted=new Promise(resolve=>{startedB=resolve;});
    const aGate=new Promise(resolve=>{releaseA=resolve;}); const bGate=new Promise(resolve=>{releaseB=resolve;});
    childProvider.setResponses([async()=>{startedA();await aGate;return fauxAssistantMessage("Initial answer A");},async()=>{startedB();await bGate;return fauxAssistantMessage("Latest answer B with total 9");}]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task",{profileId:"researcher",task:"Initial request A",description:"Overlapping messages",modelKey:"child-config",commandId:"overlap-start"})],{stopReason:"toolUse"}),fauxAssistantMessage("background launched")]);
    await (await root.submit({type:"input",requestId:"start-overlap",content:"launch background"},context)).wait(context);
    await aStarted;
    const child=(await service.list())[0];
    await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:child.taskId,message:"Compute supplemental total B",messageId:"overlap-B",wake:true});
    releaseA();await bStarted;
    const pending=(await service.list())[0];
    const prematureFailure=updates.some(update=>update.sessionUpdate==="tool_call_update"&&update.status==="failed");
    const waited=await service.wait({conversationId:String(root.id),taskIds:[child.taskId],timeoutMs:0});
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("get_subagent_result",{taskId:child.taskId})],{stopReason:"toolUse"}),fauxAssistantMessage("result inspection finished")]);
    await (await root.submit({type:"input",requestId:"inspect-overlap",content:"inspect current pending result"},context)).wait(context);
    const resultEntry=(await root.entries({order:"ascending"},1000,undefined,context)).items.filter(entry=>entry.kind==="pi.tool-result").at(-1);
    const resultReady=resultEntry.model[0].isError!==true;
    releaseB();await service.waitForBackground();
    const final=(await service.list())[0];
    const reports=(await root.entries({order:"ascending"},1000,undefined,context)).items.filter(entry=>entry.kind==="va.subagent.report").length;
    const beforeCold=childProvider.state.callCount;
    await service.dispose();await harness.close(context);
    const reopenedStorage=await openNodeJsonlStorage(process.env.STORE_DIR,context);const reopenedRegistry=createRegistry();const reopenedHarness=await Harness.open(reopenedStorage,{models,registry:reopenedRegistry},context);const reopenedRoot=await reopenedHarness.root(context);
    const reopenedService=await createPiSubagentTools({...options,harness:reopenedHarness,conversation:reopenedRoot});reopenedRegistry.install(reopenedService.extension);
    const saved=(await reopenedService.list())[0];
    const report={prematureFailure,pendingStatus:pending.status,pendingAnswer:pending.answer,waitStatus:waited.tasks[0]?.status,resultReady,finalAnswer:saved.answer,coldRequests:childProvider.state.callCount-beforeCold,reports};
    await reopenedService.dispose();await reopenedHarness.close(context);process.stdout.write(JSON.stringify(report));
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exit(1);});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: overlapSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  overlappingRequestReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "overlap-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const failedOverlapSource = overlapSource.replace(
    'fauxAssistantMessage("Initial answer A")',
    'fauxAssistantMessage("",{stopReason:"error",errorMessage:"earlier request failed"})'
  );
  expect(failedOverlapSource).not.toBe(overlapSource);
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: failedOverlapSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  failedEarlierRequestReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "failed-overlap-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const sequentialOverlapSource = overlapSource.replace(
    '    await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:child.taskId,message:"Compute supplemental total B",messageId:"overlap-B",wake:true});\n    releaseA();await bStarted;',
    '    releaseA();await service.waitForBackground();\n    await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:child.taskId,message:"Compute supplemental total B",messageId:"overlap-B",wake:true});\n    await bStarted;'
  );
  expect(sequentialOverlapSource).not.toBe(overlapSource);
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: sequentialOverlapSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  sequentialRequestReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "sequential-overlap-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const ownershipSource =
    prefix
      .replace(
        "  const registry = createRegistry();",
        "  let beforeRead = async (_args) => {};\n  const registry = createRegistry();"
      )
      .replace(
        "execute: async (args) => ({",
        "execute: async (args) => { await beforeRead(args); return ({"
      )
      .replace("}) }] }));", "}); } }] }));") +
    String.raw`
    let oldOwnerTerminal=false;
    const stateToken=defineDoc({kind:"va.subagents",version:1,scope:"conversation",history:"rewindable",fork:"initial",initial:()=>({revision:0,children:{},commands:{},reports:{}})});
    beforeRead=async()=>{
      const state=await harness.snapshot(stateToken,root.id,context);
      const owner=state?.commands["anchor:ownership-race"];
      if(owner){await harness.waitForTask(Number(owner),context);oldOwnerTerminal=(await harness.getTask(Number(owner),context)).state.status==="terminal";}
    };
    let releaseAnswer;let notifyStarted;const childStarted=new Promise(resolve=>{notifyStarted=resolve;});
    const answerGate=new Promise(resolve=>{releaseAnswer=resolve;});
    childProvider.setResponses([async()=>{notifyStarted();await answerGate;return fauxAssistantMessage("delayed real background answer");}]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task",{profileId:"researcher",task:"Work independently",description:"Ownership race",inputFiles:["notes/input.md"],modelKey:"child-config",commandId:"ownership-race"})],{stopReason:"toolUse"}),fauxAssistantMessage("start returned")]);
    await (await root.submit({type:"input",requestId:"ownership-race",content:"start background"},context)).wait(context);
    const child=(await service.list())[0];
    if(!child)throw new Error("background did not start; oldOwnerTerminal="+oldOwnerTerminal+" "+JSON.stringify((await root.entries({order:"ascending"},100,undefined,context)).items.filter(entry=>entry.kind==="pi.tool-result")));
    await childStarted;
    const startedBeforeAnswer=child.status!=="completed" && !child.answer;
    const parentToolTerminal=(await harness.getTask(Number(child.parentToolTaskId),context)).state.status==="terminal";
    const ownerTerminal=(await harness.waitForTask(Number(child.ownerTaskId),context)).state.status==="terminal";
    const incoming=await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:child.taskId,message:"additional reading instruction",messageId:"ownership-message"});
    const pending=service.wait({conversationId:String(root.id),taskIds:[child.taskId]});
    releaseAnswer();await service.waitForBackground();const waited=(await pending).reason;
    const messageAck=(await service.messages()).find(message=>message.messageId===incoming.messageId).ack;
    await service.stopAll();
    const aborted=new AbortController();aborted.abort();let abortedBeginDenied=false;
    try{await service.beginRun({...run,signal:aborted.signal});}catch{abortedBeginDenied=true;}
    await service.beginRun(run);
    let oldChildRemainsStopped=false;try{await service.sendMessage({senderConversationId:String(root.id),recipientTaskId:child.taskId,message:"must not revive",messageId:"stopped-old-child",wake:true});}catch{oldChildRemainsStopped=true;}
    const anchor=service.extension.tasks.find(task=>task.definition.name==="va.subagent_anchor");
    const orphan=await root.commit(tx=>tx.createTask(anchor,{}, {ownership:{kind:"conversation"},conversationId:root.id,background:true}),context);
    await harness.waitForTask(orphan,context);
    await root.commit(async tx=>{const state=await tx.doc(stateToken,root.id);state.commands["anchor:ownership-stop"]=String(orphan);},context);
    let stopStarted;const stopReady=new Promise(resolve=>{stopStarted=resolve;});
    childProvider.setResponses([(_input,request)=>new Promise((_resolve,reject)=>{request.signal.addEventListener("abort",()=>reject(new Error("stopped")),{once:true});stopStarted();})]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task",{profileId:"researcher",task:"Wait for Stop",description:"Stop background",modelKey:"child-config",commandId:"ownership-stop"})],{stopReason:"toolUse"}),fauxAssistantMessage("second start returned")]);
    await (await root.submit({type:"input",requestId:"ownership-stop",content:"start cancellable background"},context)).wait(context);
    await stopReady;const stoppedChild=(await service.list()).find(item=>item.description==="Stop background");
    const orphanOwnerReplaced=stoppedChild.ownerTaskId!==String(orphan) && (await harness.getTask(orphan,context)).state.status==="terminal";
    await service.stop(stoppedChild.taskId);await service.waitForBackground();const stopped=(await service.list()).find(item=>item.taskId===stoppedChild.taskId).status;
    await service.dispose();await harness.close(context);
    process.stdout.write(JSON.stringify({startedBeforeAnswer,parentToolTerminal,ownerTerminal,waited,messageAck,stopped,oldOwnerTerminal,orphanOwnerReplaced,oldChildRemainsStopped,abortedBeginDenied}));
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exit(1);});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: ownershipSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  ownershipReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "ownership-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const checkpointSource =
    prefix +
    String.raw`
    const fileIO=await import("node:fs/promises");const outputPath=process.env.STORE_DIR+"/writer-output.txt";
    const writeExtension=defineExtension({name:"checkpoint-writes",tools:[{name:"vault_edit",description:"Append the approved text",parameters:{type:"object",properties:{content:{type:"string"}},required:["content"]},execute:async args=>{await fileIO.appendFile(outputPath,args.content);return {output:[{type:"text",text:"saved write"}]};}}]});
    registry.install(writeExtension);capabilities.register({toolId:"vault_edit",family:"vault",effects:["write"],allowedCallers:["root","subagent"]});
    let nextRequest;const requestReached=new Promise(resolve=>{nextRequest=resolve;});
    childProvider.setResponses([fauxAssistantMessage([fauxToolCall("vault_edit",{content:"once\n"})],{stopReason:"toolUse"}),(_input,request)=>new Promise((_resolve,reject)=>{request.signal.addEventListener("abort",()=>reject(new Error("host closed")),{once:true});nextRequest();})]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task",{profileId:"writer",task:"Append once then verify",description:"Checkpoint writer",outputPaths:["notes/output.md"],modelKey:"child-config",commandId:"checkpoint-writer"})],{stopReason:"toolUse"}),fauxAssistantMessage("writer started")]);
    await (await root.submit({type:"input",requestId:"checkpoint-writer",content:"start writer"},context)).wait(context);await requestReached;
    const before=(await service.list())[0];const reporterIds=JSON.stringify(before.reporterIds);const priorRequest=before.latestRequestId;
    await service.dispose({preservePending:true});await harness.close(context);
    const nextRegistry=createRegistry();nextRegistry.install(writeExtension);
    const nextStorage=await openNodeJsonlStorage(process.env.STORE_DIR,context);const nextHarness=await Harness.open(nextStorage,{models,registry:nextRegistry},context);const nextRoot=await nextHarness.root(context);
    const recoverySignal=new AbortController();const resolvedRuns=[];
    const nextService=await createPiSubagentTools({...options,harness:nextHarness,conversation:nextRoot,getRun:()=>({id:"newer-root-turn",budget:new RunBudget(),signal:recoverySignal.signal}),resolveRun:async id=>{resolvedRuns.push(id);return {id,budget:run.budget,signal:recoverySignal.signal};}});nextRegistry.install(nextService.extension);
    childProvider.setResponses([(input)=>{const count=input.messages.filter(message=>message.role==="user"&&JSON.stringify(message.content).includes("Append once then verify")).length;return count>1?fauxAssistantMessage([fauxToolCall("vault_edit",{content:"once\n"})],{stopReason:"toolUse"}):fauxAssistantMessage("continued after the already saved write");},fauxAssistantMessage("duplicate task finished")]);
    await nextService.resume(before.taskId);await nextService.waitForBackground();
    const child=(await nextService.list())[0];const conversation=await nextHarness.conversation(Number(child.conversationId),context);
    const history=(await conversation.entries({order:"ascending"},1000,undefined,context)).items;
    const savedInput=await nextHarness.commit(tx=>tx.submissionByRequest(conversation.id,priorRequest),context);
    const result={writes:await fileIO.readFile(outputPath,"utf8"),userInputs:history.filter(entry=>entry.kind==="pi.user").length,sameReporterIds:reporterIds===JSON.stringify(child.reporterIds),parentRunId:child.parentRunId,resolvedRuns,answer:child.answer,oldRequestStatus:savedInput.status};
    await nextService.stop(child.taskId);activeProfiles=["researcher","reviewer"];
    result.revokedReadOnly=nextService.isReadOnly(child.conversationId);
    activeProfiles=["researcher","reviewer","writer"];result.stoppedAfterReenable=false;
    try{await nextService.sendMessage({senderConversationId:String(nextRoot.id),recipientTaskId:child.taskId,message:"must stay stopped",messageId:"reenabled-but-stopped",wake:true});}catch{result.stoppedAfterReenable=true;}
    await nextService.dispose({preservePending:true});await nextHarness.close(context);
    const queuedRegistry=createRegistry();const queuedStorage=await openNodeJsonlStorage(process.env.STORE_DIR,context);const queuedHarness=await Harness.open(queuedStorage,{models,registry:queuedRegistry},context);const queuedRoot=await queuedHarness.root(context);
    const restoredRun={id:run.id,budget:run.budget,signal:new AbortController().signal};
    const queuedService=await createPiSubagentTools({...options,harness:queuedHarness,conversation:queuedRoot,getRun:()=>restoredRun});queuedRegistry.install(queuedService.extension);
    const mailbox=defineDoc({kind:"va.subagent.mailbox",version:1,scope:"conversation",history:"rewindable",fork:"initial",initial:()=>({messages:{},sequences:{},stoppedRuns:{},epoch:0})});
    const delivery=queuedService.extension.tasks.find(task=>task.definition.name==="va.subagent.message_delivery");
    await queuedRoot.commit(async tx=>{const state=await tx.doc(mailbox,queuedRoot.id);state.messages["cold-passive"]={messageId:"cold-passive",parentTaskId:"root",sender:"root",recipient:child.taskId,sequence:1,causationId:"cold-passive",type:"message",payload:{text:"preserved pending context"},ack:"stored"};const taskId=await tx.createTask(delivery,{messageId:"cold-passive",conversationId:child.conversationId,parentRunId:run.id},{ownership:{kind:"conversation"},conversationId:queuedRoot.id,background:true});(state.deliveries??={})["cold-passive"]=String(taskId);},context);
    await queuedService.dispose({preservePending:true});await queuedHarness.close(context);
    const deliveryRegistry=createRegistry();const deliveryStorage=await openNodeJsonlStorage(process.env.STORE_DIR,context);const deliveryHarness=await Harness.open(deliveryStorage,{models,registry:deliveryRegistry},context);const deliveryRoot=await deliveryHarness.root(context);
    const deliveryService=await createPiSubagentTools({...options,harness:deliveryHarness,conversation:deliveryRoot,getRun:()=>restoredRun});deliveryRegistry.install(deliveryService.extension);deliveryHarness.resume();await deliveryService.waitForBackground();
    result.recoveredPassiveAck=(await deliveryService.messages()).find(message=>message.messageId==="cold-passive").ack;
    await deliveryService.dispose();await deliveryHarness.close(context);process.stdout.write(JSON.stringify(result));
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exit(1);});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: checkpointSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  checkpointResumeReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "checkpoint-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const crashSource =
    prefix +
    String.raw`
    let signalStarted;const started=new Promise(resolve=>{signalStarted=resolve;});
    childProvider.setResponses([()=>new Promise(()=>{signalStarted();})]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("start_background_task",{profileId:"researcher",task:"Recover",description:"Recover",modelKey:"child-config",commandId:"crash"})],{stopReason:"toolUse"}),fauxAssistantMessage("launched")]);
    await (await root.submit({type:"input",requestId:"crash",content:"start"},context)).wait(context);await started;
    const taskId=(await service.list())[0].taskId;await new Promise(resolve=>process.stdout.write(JSON.stringify({taskId}),resolve));process.exit(0);
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exitCode=1;});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: crashSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  execFileSync(process.execPath, [target], {
    env: { ...process.env, STORE_DIR: path.join(directory, "crash-store") },
    timeout: 60_000,
  });
  const recoverySource =
    prefix +
    String.raw`
    const child=(await service.list())[0];const beforeStatus=child.status;const beforeRequests=childProvider.state.callCount;
    childProvider.setResponses([fauxAssistantMessage("recovered durable child answer")]);await service.resume(child.taskId);await service.waitForBackground();const resumed=(await service.list())[0];
    const report={beforeStatus,beforeRequests,afterStatus:resumed.status,answer:resumed.answer,requests:childProvider.state.callCount};await service.dispose();await harness.close(context);process.stdout.write(JSON.stringify(report));
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exitCode=1;});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: recoverySource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  crashRecovery = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "crash-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
  const nestedSource =
    prefix +
    String.raw`
    let arrived=0;let admit;const barrier=new Promise(resolve=>{admit=resolve;});
    const nestedResponse=async(input)=>{if(input.messages.some(message=>message.role==="toolResult"))return fauxAssistantMessage("finished after nested result");arrived++;if(arrived===3)admit();await barrier;return fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"researcher",task:"Grandchild",description:"nested",modelKey:"child-config"})],{stopReason:"toolUse"});};
    childProvider.setResponses(Array.from({length:6},()=>nestedResponse));
    rootProvider.setResponses([fauxAssistantMessage([0,1,2].map(index=>fauxToolCall("delegate_task",{profileId:"researcher",task:"Parent "+index,description:"parent "+index,modelKey:"child-config"})),{stopReason:"toolUse"}),fauxAssistantMessage("done")]);
    await (await root.submit({type:"input",requestId:"busy",content:"three parents"},context)).wait(context);const busyChildren=(await service.list()).length;let busyErrors=0;for(const child of await service.list()){if(JSON.stringify(await service.readChildHistory(child.conversationId)).includes("名额已满"))busyErrors++;}
    childProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"researcher",task:"Grandchild",description:"nested",modelKey:"child-config"})],{stopReason:"toolUse"}),fauxAssistantMessage("grandchild actual answer"),fauxAssistantMessage("parent actual answer")]);
    rootProvider.setResponses([fauxAssistantMessage([fauxToolCall("delegate_task",{profileId:"researcher",task:"One parent",description:"single nested",modelKey:"child-config"})],{stopReason:"toolUse"}),fauxAssistantMessage("done")]);
    await (await root.submit({type:"input",requestId:"nested",content:"one nested"},context)).wait(context);const grandchild=(await service.list()).filter(child=>child.depth===2).at(-1);if(!grandchild)throw new Error(JSON.stringify(await Promise.all((await service.list()).filter(child=>child.description==="single nested").map(async child=>({child,history:await service.readChildHistory(child.conversationId)})))));const tool=updates.filter(update=>update.sessionUpdate==="tool_call"&&update.vendorToolName==="Agent").at(-1);const linkedCard=updates.some(update=>update.sessionUpdate==="tool_call_update"&&update.toolCallId===tool.toolCallId&&update.rawInput?.childConversationId===grandchild.conversationId);
    const report={busyChildren,busyErrors,depth:grandchild.depth,canDelegate:grandchild.scope.delegationAllowed,linkedCard};await service.dispose();await harness.close(context);process.stdout.write(JSON.stringify(report));
  })().catch(error=>{process.stderr.write(String(error?.stack??error));process.exitCode=1;});`;
  execFileSync(process.execPath, ["-e", script], {
    env: { ...buildEnvironment, SMOKE_SOURCE: nestedSource, SMOKE_TARGET: target },
    timeout: 60_000,
  });
  nestedReport = JSON.parse(
    execFileSync(process.execPath, [target], {
      env: { ...process.env, STORE_DIR: path.join(directory, "nested-store") },
      encoding: "utf8",
      timeout: 60_000,
    })
  );
}, 90_000);

afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("PiSubagentTools", () => {
  describe("createPiSubagentTools()", () => {
    it("keeps a newer child request pending when its earlier answer finishes and only exposes the newer answer after that request completes https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(overlappingRequestReport.pendingStatus).not.toBe("completed");
      expect(overlappingRequestReport.pendingAnswer).toBeUndefined();
      expect(overlappingRequestReport.waitStatus).not.toBe("completed");
      expect(overlappingRequestReport.resultReady).toBe(false);
      expect(overlappingRequestReport.finalAnswer).toBe("Latest answer B with total 9");
      expect(overlappingRequestReport.coldRequests).toBe(0);
      expect(overlappingRequestReport.reports).toBe(2);
    });
    it("keeps a later child request intact when its earlier provider request fails https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(failedEarlierRequestReport.prematureFailure).toBe(false);
      expect(failedEarlierRequestReport.pendingStatus).not.toBe("failed");
      expect(failedEarlierRequestReport.pendingAnswer).toBeUndefined();
      expect(failedEarlierRequestReport.resultReady).toBe(false);
      expect(failedEarlierRequestReport.finalAnswer).toBe("Latest answer B with total 9");
      expect(failedEarlierRequestReport.coldRequests).toBe(0);
    });
    it("keeps a previously completed answer in report history without returning it as the result of a newly queued request https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(sequentialRequestReport.pendingAnswer).toBeUndefined();
      expect(sequentialRequestReport.resultReady).toBe(false);
      expect(sequentialRequestReport.finalAnswer).toBe("Latest answer B with total 9");
      expect(sequentialRequestReport.reports).toBe(2);
    });
    it("resumes an unfinished writer at its original SDK input and reporter after cold reopen without repeating the saved file write or borrowing a later root budget https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(checkpointResumeReport).toMatchObject({
        writes: "once\n",
        userInputs: 1,
        sameReporterIds: true,
        parentRunId: "run-1",
        resolvedRuns: ["run-1"],
        answer: "continued after the already saved write",
        oldRequestStatus: "done",
        recoveredPassiveAck: "accepted",
        revokedReadOnly: true,
        stoppedAfterReenable: true,
      });
    });

    it("creates background ownership atomically before asynchronous input work can end its owner and keeps send, wait and Stop usable after the start tool ends https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(ownershipReport).toMatchObject({
        startedBeforeAnswer: true,
        parentToolTerminal: true,
        ownerTerminal: true,
        stopped: "cancelled",
        orphanOwnerReplaced: true,
        oldChildRemainsStopped: true,
        abortedBeginDenied: true,
      });
      expect(["message", "task"]).toContain(ownershipReport.waited);
      expect(["accepted", "answered"]).toContain(ownershipReport.messageAck);
    });

    it("publishes enabled roles to the actual SDK and returns legal choices for unknown and newly disabled roles https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.profileDiscovery.schemaChoices).toEqual([
        ["researcher", "reviewer", "writer"],
        ["researcher", "reviewer", "writer"],
      ]);
      expect(report.profileDiscovery.invalidResult).toContain("researcher");
      expect(report.profileDiscovery.invalidResult).toContain("reviewer");
      expect(report.profileDiscovery.disabledResult).toContain(
        "Allowed enabled profiles: reviewer"
      );
    });

    it("preserves fixed child roles and reconstructs older profile roles while candidates keep only scoped runtime facts https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.foreground.instructionContext).toMatchObject({
        roleInstructions: expect.stringContaining("Never modify the vault"),
        readOnly: true,
        outputPaths: [],
      });
      expect(report.identity.legacyRole).toContain("Never modify the vault");
      expect(report.unified.candidateInstructions).toMatchObject({
        roleInstructions: "",
        cwd: "notes",
        readOnly: true,
      });
    });
    it("runs the foreground child on the configured model and keeps its reduced permissions https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.foreground).toMatchObject({
        childCount: 1,
        text: "real foreground answer",
        readOnly: true,
        modelKey: "child-config",
        parentRunId: "run-1",
      });
    });
    it("returns one canonical outcome payload with actual delegation metadata and stable task identity https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.foreground.unifiedOutcome).toBe(true);
    });
    it("runs durable background delivery and posts one tool-sourced report https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.background).toMatchObject({
        childCount: 2,
        reportCount: 1,
        status: "completed",
        answer: "real background answer",
      });
    });
    it("does not duplicate a background command after its first tool invocation ended https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.duplicate).toEqual({ childCount: 2, requests: 0 });
    });
    it("delivers actual follow-up answers through the controls and persists each answer once https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.control).toEqual({ answer: "real follow-up answer", reports: 2 });
    });
    it("stops the actual child and suppresses its late report https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.stopped).toEqual({ status: "cancelled", reports: 2 });
    });
    it("reuses the actual committed answer when its product mapping was interrupted https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.recoveredCompleted).toEqual({ requests: 0, answer: "real foreground answer" });
    });
    it("requires an explicit resume before a stopped child can run again https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.resumed).toEqual({ status: "completed", answer: "resumed child answer" });
      expect(report.resumedMessage).toBe("Resume the latest follow-up");
    });
    it("resolves root and child identities while denying unknown conversations and out-of-scope paths https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.identity).toMatchObject({
        rootCaller: "root",
        childCaller: "subagent",
        unknownReadOnly: true,
        unknownMode: "plan",
        unknownModel: null,
        unknownRun: null,
        unknownTask: null,
        rootScope: true,
        childScope: true,
        deniedScope: false,
        rootMode: "default",
        historyDenied: true,
      });
      expect(report.identity.childTask).toBeTruthy();
    });
    it("restricts opted-in writer file access to its declared files and parent scope https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.writer).toMatchObject({
        allowed: true,
        denied: false,
        inputWriteDenied: true,
        outputWriteAllowed: true,
        cursorInputPreserved: true,
      });
    });
    it("persists real candidate ownership and shares scheduling without waking completed tasks for passive messages https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.unified).toMatchObject({
        stopCancelsCandidate: true,
        lateResultNotRevive: true,
        explicitResume: true,
        candidateOwned: true,
        sameCandidate: true,
        candidateCaller: "fanout",
        candidateReadOnly: true,
        candidateTools: ["vault_read"],
        scheduledValue: 42,
        noWakeRequests: 0,
        duplicateCount: 1,
        accepted: "accepted",
        conflictDenied: true,
        peerDenied: true,
        waitReason: "message",
        senderVerified: true,
        cancellation: "cancelled",
        timeout: "timeout",
        terminal: "task",
        stoppedGroupDenied: true,
        candidateAnswerPreserved: true,
      });
      expect(report.unified.restoredMessages).toBeGreaterThan(1);
    });
    it("records a real child request failure instead of leaving its card running https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.failed.status).toBe("failed");
    });
    it("restores an interrupted real process without a request and resumes it exactly once on explicit continue https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(crashRecovery).toEqual({
        beforeStatus: "interrupted",
        beforeRequests: 0,
        afterStatus: "completed",
        answer: "recovered durable child answer",
        requests: 1,
      });
    });
    it("avoids nested scheduling deadlocks and permits depth two while keeping its parent card linked https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(nestedReport).toEqual({
        busyChildren: 6,
        busyErrors: 0,
        depth: 2,
        canDelegate: false,
        linkedCard: true,
      });
    });
    it("restores the real child history without restarting completed work https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      expect(report.reopened).toMatchObject({ childCount: 6, requests: 0 });
      expect(report.reopened.historyCount).toBeGreaterThan(1);
    });
  });
});
