export function isCompactionRequest(context: {
  readonly messages: readonly { readonly role: string; readonly content: unknown }[];
}): boolean {
  return context.messages.some(
    (message) =>
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith("You are a context summarization assistant.")
  );
}
