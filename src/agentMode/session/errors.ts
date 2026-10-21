import { t } from "@/i18n";

export class MethodUnsupportedError extends Error {
  constructor(method: string) {
    super(`Agent does not implement ${method}`);
    this.name = "MethodUnsupportedError";
  }
}

export class AuthRequiredError extends Error {
  constructor(message = t("agentInfra.session.notSignedIn")) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export const JSONRPC_METHOD_NOT_FOUND = -32601;
