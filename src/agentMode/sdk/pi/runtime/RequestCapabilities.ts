import type { ContextEnvironment } from "@/agentMode/sdk/pi/features/ContextBuilder";
import type { TaskCheckpoint } from "@/agentMode/sdk/pi/storage/WorkItemStore";
import type { Message, SystemMessage, Tool } from "@earendil-works/pi-ai";
import type {
  CapabilityCatalog,
  CapabilityContext,
} from "@/agentMode/sdk/pi/policy/CapabilityCatalog";

export async function applyRequestCapabilities(
  messages: readonly Message[],
  sdkOfferedTools: readonly Tool[],
  catalog: CapabilityCatalog,
  context: CapabilityContext,
  timestamp: number,
  work?:
    | { readonly id: string; readonly checkpoint: TaskCheckpoint }
    | {
        readonly id: string;
        readonly reference: { readonly status: string; readonly sourceSeq: number };
      }
    | null,
  environment?: Pick<ContextEnvironment, "scope" | "model" | "deferredTools"> & {
    readonly timeZone?: string;
  },
  instructions?: { readonly text: string; readonly childRole?: string }
): Promise<readonly Message[]> {
  const { getCurrentTools, getToolStateChanges, toToolDeclaration } =
    await import("@earendil-works/pi-ai/utils/transcript");
  const snapshot = catalog.snapshot(
    sdkOfferedTools.map((tool) => tool.name),
    context
  );
  const permitted = new Set(snapshot.offeredTools);
  // SDK 本轮已经提供的工具才可更新；延后工具必须走 SDK 正式加载，不能凭目录注册取得能力：https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  const schemas = sdkOfferedTools.filter((tool) => permitted.has(tool.name)).map(toToolDeclaration);
  const { toolsRemoved, toolsAdded } = getToolStateChanges(getCurrentTools(messages), schemas);
  const visibleUserText = messages
    .filter((message) => message.role === "user")
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : message.content.filter((part) => part.type === "text").map((part) => part.text)
    );
  const isVisible = (text: string) =>
    text.length > 0 && visibleUserText.some((content) => content.includes(text));
  const checkpoint =
    work && "checkpoint" in work
      ? {
          ...work.checkpoint,
          ...(isVisible(work.checkpoint.goal)
            ? { goal: undefined, goalSource: "current_user_transcript" }
            : {}),
          userRequests: work.checkpoint.userRequests?.map((request) =>
            isVisible(request.text)
              ? { requestId: request.requestId, source: "current_user_transcript" }
              : request
          ),
        }
      : null;
  const timeZone = environment?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date(timestamp);
  const facts: ContextEnvironment = {
    ...environment,
    scope: environment?.scope ?? {},
    currentDate: new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(now),
    timeZone,
    capturedAt: now.toISOString(),
    mode: context.mode,
    offeredTools: snapshot.offeredTools,
  };
  const delta: SystemMessage = {
    role: "system",
    content: "",
    sections: {
      ...(instructions
        ? { instructions: instructions.text, "host.child-role": instructions.childRole ?? null }
        : {}),
      "host.environment": `<current-runtime-facts>${JSON.stringify(facts).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e")}</current-runtime-facts>`,
      "host.work-checkpoint": work
        ? `<work-checkpoint>${JSON.stringify({
            source: "va.work-items",
            workItemId: work.id,
            ...("reference" in work ? { sharedWorkReference: work.reference } : checkpoint),
          })
            .replaceAll("<", "\\u003c")
            .replaceAll(">", "\\u003e")}</work-checkpoint>`
        : null,
      "host.capabilities": `<current-capabilities>${JSON.stringify({
        caller: context.caller,
        mode: context.mode,
        ...snapshot,
      })
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")}</current-capabilities>`,
    },
    ...(toolsRemoved.length ? { toolsRemoved } : {}),
    ...(toolsAdded.length ? { toolsAdded } : {}),
    timestamp,
  };
  return [...messages, delta];
}
