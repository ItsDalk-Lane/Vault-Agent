import type { Api, Model } from "@earendil-works/pi-ai";

export interface DeclaredPiModelFact extends Pick<
  Model<Api>,
  | "id"
  | "api"
  | "input"
  | "contextWindow"
  | "maxTokens"
  | "reasoning"
  | "compat"
  | "thinkingLevelMap"
> {
  readonly reasoningEfforts: readonly string[];
}
