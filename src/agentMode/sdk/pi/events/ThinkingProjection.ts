import type { AssistantMessage, ThinkingContent } from "@earendil-works/pi-ai";
import type { MessageChange } from "@earendil-works/pi-durable";

import type { AgentMessagePart } from "@/agentMode/session/types";

// Reasoning rows render only what a provider publicly returned: one span per thinking block with
// the live stream's real start/end times, no opaque signature text, and no fabricated content for
// models that cannot think. Replay reuses the timings already on the persisted parts instead of
// restarting the clock:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type ThoughtPart = Extract<AgentMessagePart, { kind: "thought" }>;

export interface ThinkingProjectionOptions {
  readonly now?: () => number;
  readonly thinkingSupported?: boolean;
}

interface ThinkingBlockState {
  text: string;
  startedAtMs: number;
  durationMs?: number;
}

export class ThinkingProjection {
  private readonly now: () => number;
  private readonly supported: boolean;
  private readonly blocks = new Map<number, ThinkingBlockState>();

  constructor(options: ThinkingProjectionOptions = {}) {
    this.now = options.now ?? Date.now;
    this.supported = options.thinkingSupported ?? true;
  }

  apply(changes: readonly MessageChange[], atMs?: number): readonly ThoughtPart[] {
    if (!this.supported) return [];
    const at = atMs ?? this.now();
    for (const change of changes) {
      switch (change.type) {
        case "thinking_start":
          if (change.block.type === "thinking") this.open(change.contentIndex, change.block, at);
          break;
        case "thinking_delta":
          this.append(change.contentIndex, change.delta, at);
          break;
        case "block":
          if (change.block.type === "thinking") this.open(change.contentIndex, change.block, at);
          else this.close(change.contentIndex, at);
          break;
        case "message":
          this.reconcileMessage(change.message, at);
          break;
        default:
          break;
      }
    }
    return this.parts();
  }

  finish(atMs?: number): readonly ThoughtPart[] {
    if (this.supported) this.closeAll(atMs ?? this.now());
    return this.parts();
  }

  fromMessage(
    message: Pick<AssistantMessage, "content">,
    persisted: readonly ThoughtPart[] = []
  ): ThoughtPart[] {
    if (!this.supported) return [];
    const parts: ThoughtPart[] = [];
    let persistedIndex = 0;
    for (const block of message.content) {
      if (block.type !== "thinking" || !isPublicThinking(block)) continue;
      const timing = persisted[persistedIndex];
      persistedIndex += 1;
      parts.push({
        kind: "thought",
        text: block.thinking,
        ...(timing?.startedAtMs !== undefined ? { startedAtMs: timing.startedAtMs } : {}),
        ...(timing?.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
      });
    }
    return parts;
  }

  private open(contentIndex: number, block: ThinkingContent, atMs: number): void {
    if (!isPublicThinking(block)) {
      this.blocks.delete(contentIndex);
      return;
    }
    const existing = this.blocks.get(contentIndex);
    if (existing !== undefined) {
      existing.text = block.thinking;
      return;
    }
    this.closeOtherBlocks(contentIndex, atMs);
    this.blocks.set(contentIndex, { text: block.thinking, startedAtMs: atMs });
  }

  private append(contentIndex: number, delta: string, atMs: number): void {
    const existing = this.blocks.get(contentIndex);
    if (existing === undefined) {
      this.closeOtherBlocks(contentIndex, atMs);
      this.blocks.set(contentIndex, { text: delta, startedAtMs: atMs });
      return;
    }
    if (existing.durationMs !== undefined) return;
    existing.text += delta;
  }

  private close(contentIndex: number, atMs: number): void {
    const block = this.blocks.get(contentIndex);
    if (block === undefined) return;
    block.durationMs = Math.max(0, atMs - block.startedAtMs);
  }

  private closeOtherBlocks(activeContentIndex: number, atMs: number): void {
    for (const [contentIndex, block] of this.blocks) {
      if (contentIndex === activeContentIndex || block.durationMs !== undefined) continue;
      block.durationMs = Math.max(0, atMs - block.startedAtMs);
    }
  }

  private closeAll(atMs: number): void {
    for (const block of this.blocks.values()) {
      if (block.durationMs !== undefined) continue;
      block.durationMs = Math.max(0, atMs - block.startedAtMs);
    }
  }

  // The committed message is authoritative: it replaces block content and removes blocks the
  // provider redacted, while already measured spans keep their original start/end:
  // https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
  private reconcileMessage(message: Pick<AssistantMessage, "content">, atMs: number): void {
    const visible = new Map<number, string>();
    message.content.forEach((block, contentIndex) => {
      if (block.type === "thinking" && isPublicThinking(block)) {
        visible.set(contentIndex, block.thinking);
      }
    });
    for (const [contentIndex, block] of this.blocks) {
      const text = visible.get(contentIndex);
      if (text === undefined) {
        this.blocks.delete(contentIndex);
        continue;
      }
      block.text = text;
      visible.delete(contentIndex);
    }
    for (const [contentIndex, text] of visible) {
      this.blocks.set(contentIndex, { text, startedAtMs: atMs });
    }
  }

  private parts(): readonly ThoughtPart[] {
    return [...this.blocks.entries()]
      .filter(([, block]) => block.text.length > 0)
      .sort(([a], [b]) => a - b)
      .map(([, block]) => ({
        kind: "thought" as const,
        text: block.text,
        startedAtMs: block.startedAtMs,
        ...(block.durationMs !== undefined ? { durationMs: block.durationMs } : {}),
      }));
  }
}

function isPublicThinking(block: ThinkingContent): boolean {
  return block.redacted !== true;
}
