import type { ModelInfo, Provider } from "@/modelManagement";

export interface ModelConnectionTestInput {
  provider: Provider;
  model: ModelInfo;
  apiKey?: string;
  signal?: AbortSignal;
  checkTools?: boolean;
}
