export function buildChatDeepLink(vault: string, id: string): string {
  return `obsidian://vault-agent?vault=${encodeURIComponent(vault)}&id=${encodeURIComponent(id)}`;
}

export function buildChatMarkdownLink(title: string, url: string): string {
  return `[${title.replace(/[[\]\\]/g, "\\$&")}](${url})`;
}
