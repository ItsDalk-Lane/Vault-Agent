import type { BackendDescriptor, BackendId } from "@/agentMode/session/types";
import ClaudeLogo from "@/agentMode/session/legacy/icons/claude.svg";
import CodexLogo from "@/agentMode/session/legacy/icons/codex.svg";
import OpencodeLogo from "@/agentMode/session/legacy/icons/opencode.svg";

export interface HistoricalBackendIdentity {
  readonly id: BackendId;
  readonly displayName: string;
  readonly Icon: BackendDescriptor["Icon"];
  readonly agentProductName?: string;
}

// 旧聊天只保留身份，不能再进入模型发现、安装或运行入口。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export const HISTORICAL_BACKEND_IDENTITIES: readonly HistoricalBackendIdentity[] = Object.freeze([
  Object.freeze({
    id: "claude",
    displayName: "Claude",
    Icon: ClaudeLogo,
    agentProductName: "Claude Code",
  }),
  Object.freeze({ id: "codex", displayName: "Codex", Icon: CodexLogo, agentProductName: "Codex" }),
  Object.freeze({ id: "opencode", displayName: "opencode", Icon: OpencodeLogo }),
]);

export function isHistoricalBackendId(backendId: BackendId): boolean {
  return backendId !== "pi";
}
