import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const print = (value) => process.stdout.write(String(value) + "\n");

const arg=process.argv.indexOf("--root");
const root=arg>=0?path.resolve(process.argv[arg+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),"utf8"));
const {tasks,phases}=read("execution/TASKS.json");
const state=read("execution/STATE.json");
const active=tasks.find(t=>state.tasks[t.id]?.status==="in_progress");
if(active){ print(`RESUME ${active.id}: ${active.title}\nRead ${active.card} and execution/HANDOFF.md`); process.exit(0); }
for(const p of phases){
  const pending=tasks.filter(t=>t.phase===p.id&&state.tasks[t.id]?.status!=="done");
  if(!pending.length){
    if(state.phaseGates[p.id]?.status!=="passed"){ print(`RUN GATE ${p.id}\nRead execution/phases/${p.id}.md`); process.exit(0); }
    continue;
  }
  if(p.previousGate!=="P00"&&state.phaseGates[p.previousGate]?.status!=="passed"){
    print(`BLOCKED BY GATE ${p.previousGate}`); process.exit(0);
  }
  const next=pending.find(t=>t.dependencies.every(id=>state.tasks[id]?.status==="done"));
  if(!next){ print(`No dependency-ready task in ${p.id}; inspect STATE and HANDOFF.`); process.exit(1); }
  const status=state.tasks[next.id].status;
  print(`${status==="todo"?"START":"REPAIR/RESUME"} ${next.id}: ${next.title}\nState: ${status}\nRead ${next.card}`);
  process.exit(0);
}
print("All task and phase gates passed. Review release evidence before any publication.");
