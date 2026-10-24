import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { StoreLocator } from "@/agentMode/sdk/pi/storage/StoreLocator";
import { createWorkItemStore } from "@/agentMode/sdk/pi/storage/WorkItemStore";

export async function readStoredWorkItem(input: {
  readonly privateRoot: string;
  readonly vaultRoot: string;
  readonly vaultId: string;
  readonly sessionId: string;
  readonly workId: string;
}) {
  const locator = new StoreLocator({
    platform: process.platform,
    homeDir: input.privateRoot,
    env: {},
    vaultRoot: input.vaultRoot,
    vaultId: input.vaultId,
  });
  const storage = await openNodeJsonlStorage(
    locator.sessionStorePaths(input.sessionId).storeDir,
    BACKGROUND_CONTEXT
  );
  const harness = await Harness.open(
    storage,
    { models: createModels(), registry: createRegistry() },
    BACKGROUND_CONTEXT
  );
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT);
    return await (await createWorkItemStore({ harness, conversation })).read(input.workId);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
  }
}
