import type { AgentEvent, ConversationId } from "@earendil-works/pi-durable";

import type { SessionProjection, SessionUpdate } from "@/agentMode/session/types";

// Pi SDK types stay inside sdk/pi and never leak through session/ or ui/:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export interface PiStreamFrame {
  event: AgentEvent;
  cursor: SessionProjection["cursor"];
}

export type PiDomainUpdateMapper = (frame: PiStreamFrame) => SessionUpdate | null;

export interface PiConversationIdentity {
  rootConversationId: ConversationId;
  conversationId: ConversationId;
  requestId: string;
}
