import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ProviderStreamsFactory } from "@/agentMode/sdk/pi/models/ProviderFactory";
import { isSummaryRequest } from "./summaryRequest";

export function withDiagnosticSummaries(
  streams: ReturnType<ProviderStreamsFactory>,
  onSummary?: (context: TranscriptContext) => void
): ReturnType<ProviderStreamsFactory> {
  const summary = (context: TranscriptContext) => {
    onSummary?.(context);
    const message = fauxAssistantMessage(
      "## Goal\nContinue the original diagnostic task.\n## Progress\nPreserve committed results and pending decisions.\n## Next Steps\nContinue without repeating finished operations."
    );
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
    return stream;
  };
  return {
    stream: (model, context, request) =>
      isSummaryRequest(context) ? summary(context) : streams.stream(model, context, request),
    streamSimple: (model, context, request) =>
      isSummaryRequest(context) ? summary(context) : streams.streamSimple(model, context, request),
  };
}
