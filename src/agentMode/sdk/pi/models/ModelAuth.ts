import type { AuthContext } from "@earendil-works/pi-ai";

export const STRICT_NO_AMBIENT_AUTH: AuthContext = Object.freeze({
  env: async () => undefined,
  fileExists: async () => false,
});
