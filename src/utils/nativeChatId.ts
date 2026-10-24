export function buildNativeChatId(_backendId: string, sessionId: string): string {
  return sessionId;
}

export function isNativeChatId(id: string): boolean {
  return /^root-[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}

export function parseNativeChatId(id: string): { backendId: string; sessionId: string } | null {
  return isNativeChatId(id) ? { backendId: "pi", sessionId: id } : null;
}
