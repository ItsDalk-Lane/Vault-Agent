import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("DurableMutationJournal", () => {
  describe("createDurableMutationJournal()", () => {
    it("shares the existing document definition, preserves its projection and reopens without starting a model https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "durable-mutation-journal-"));
      temporary.push(directory);
      const bundle = path.join(directory, "scenario.cjs");
      const source = `
        import { Harness, createRegistry, defineDoc } from "@earendil-works/pi-durable";
        import { createModels } from "@earendil-works/pi-ai";
        import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
        import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
        import { createDurableMutationJournal, getMutationJournalDoc } from "@/agentMode/sdk/pi/storage/DurableMutationJournal";
        async function main() {
          const directory = process.argv[2];
          const open = async () => Harness.open(await openNodeJsonlStorage(directory, context, { fsync: true }), { models: createModels(), registry: createRegistry() }, context);
          let harness = await open();
          let conversation = await harness.root(context);
          const oldToken = defineDoc({kind:"va.mutations",version:1,scope:"conversation",history:"rewindable",fork:"initial",initial:()=>({kind:"va.mutations",version:1,revision:0,updatedAtMs:0,items:[]})});
          await conversation.commit(async tx => { (await tx.doc(oldToken, conversation.id)).items.push({operationId:"legacy-display"}); }, context);
          let store = await createDurableMutationJournal({harness,conversation});
          const initiallyEmpty = await store.load() === null;
          await store.save({version:1,mutations:{one:{operationId:"one",path:"a.md",kind:"write",beforeHash:"before",afterHash:"after",beforeBlobRef:"blob-before",afterBlobRef:"blob-after",committed:false,state:"failed",effect:"not_applied"}},reverts:{}});
          const token = await getMutationJournalDoc();
          const projection = (await harness.snapshot(token,conversation.id,context)).items;
          await harness.close(context);
          harness = await open(); conversation = await harness.root(context);
          store = await createDurableMutationJournal({harness,conversation});
          const restored = await store.load();
          const inspection = await harness.inspect(context);
          const sameToken = token === await getMutationJournalDoc();
          await harness.close(context);
          process.stdout.write(JSON.stringify({initiallyEmpty,projection,restored,inspection,sameToken}));
        }
        main().catch(error=>{process.stderr.write(String(error.stack??error));process.exitCode=1;});
      `;
      execFileSync(
        process.execPath,
        [
          "-e",
          `require("esbuild").build({stdin:{contents:process.env.SCENARIO,resolveDir:process.cwd(),sourcefile:"scenario.ts",loader:"ts"},bundle:true,platform:"node",format:"cjs",target:"node22",alias:{"@":process.env.SRC},outfile:process.env.OUT,plugins:[{name:"desktop",setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"test-host"}));build.onLoad({filter:/.*/,namespace:"test-host"},()=>({contents:"export const Platform={isDesktopApp:true,isMobile:false};",loader:"js"}));}}],logLevel:"silent"})`,
        ],
        {
          cwd: process.cwd(),
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
        initiallyEmpty: true,
        sameToken: true,
        projection: [{ operationId: "legacy-display" }],
        restored: { mutations: { one: { state: "failed", effect: "not_applied" } } },
        inspection: { scheduling: "paused", tasks: [], submissions: [] },
      });
    });
  });
});
