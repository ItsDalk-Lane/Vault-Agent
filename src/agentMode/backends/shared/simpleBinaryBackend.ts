import type { App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import { AcpBackendProcess } from "@/agentMode/acp/AcpBackendProcess";
import type { AcpBackend, AcpSpawnDescriptor } from "@/agentMode/acp/types";
import { augmentPathForNodeShebang } from "@/agentMode/acp/nodeShebangPath";
import type { BackendDescriptor, BackendProcess } from "@/agentMode/session/types";

export function buildSimpleSpawnDescriptor(
  binaryPath: string | undefined,
  configErrorMessage: string,
  envOverrides?: Record<string, string>,
  managedEnv?: Readonly<Record<string, string>>
): AcpSpawnDescriptor {
  if (!binaryPath) throw new Error(configErrorMessage);
  return {
    command: binaryPath,
    args: [],
    env: {
      ...process.env,
      PATH: augmentPathForNodeShebang(binaryPath, process.env.PATH),
      ...(managedEnv ?? {}),
      ...(envOverrides ?? {}),
    },
  };
}

export function simpleBinaryBackendProcess(
  args: {
    plugin: VaultAgentPlugin;
    app: App;
    clientVersion: string;
    descriptor: BackendDescriptor;
  },
  backend: AcpBackend
): BackendProcess {
  return new AcpBackendProcess(args.app, backend, args.clientVersion, args.descriptor);
}
