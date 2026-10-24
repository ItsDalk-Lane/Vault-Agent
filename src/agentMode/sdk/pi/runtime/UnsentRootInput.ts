import type { PromptInput, PromptContent } from "@/agentMode/session/types";
import type { FanoutTurn } from "@/agentMode/session/fanout/fanoutTypes";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { sha256 } from "@/utils/hash";

// 只保留尚未交给 SDK 的输入草稿；交接确认后删除，执行结果仍只认 Durable。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
export type UnsentRootInput = (
  | { readonly kind: "prompt"; readonly input: PromptInput }
  | { readonly kind: "fanout"; readonly turn: FanoutTurn }
) & {
  readonly version?: 1;
  readonly savedAtMs: number;
  readonly images?: readonly { readonly index: number; readonly hash: string }[];
};

export async function storeUnsentRootInput(
  input: UnsentRootInput,
  privateDir: string
): Promise<UnsentRootInput> {
  if (input.version !== undefined && input.version !== 1)
    throw new Error("待发请求版本不兼容，原记录已保留。");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const saved = JSON.parse(JSON.stringify(input)) as UnsentRootInput;
  const prompt = saved.kind === "prompt" ? saved.input.prompt : saved.turn.checkpoint?.prompt;
  const images: { index: number; hash: string }[] = [];
  for (const [index, block] of (prompt ?? []).entries()) {
    if (block.type !== "image") continue;
    if (!block.data || block.data.length > Math.ceil((8 * 1024 * 1024 * 4) / 3) + 4)
      throw new Error("图片内容为空或超过附件容量限制，未提交这条请求。");
    const hash = sha256(block.data);
    const directory = path.join(privateDir, "attachments");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs
      .writeFile(
        path.join(directory, `${hash}.json`),
        JSON.stringify({
          mime: block.mimeType,
          data: block.data,
        }),
        { mode: 0o600, flag: "wx" }
      )
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    images.push({ index, hash });
    block.data = "";
  }
  return { ...saved, version: 1, ...(images.length ? { images } : {}) };
}

export async function restoreUnsentRootInput(
  input: UnsentRootInput,
  privateDir: string
): Promise<UnsentRootInput> {
  if (input.version !== 1) throw new Error("待发请求版本不兼容，原记录已保留。");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const restored = JSON.parse(JSON.stringify(input)) as UnsentRootInput;
  const prompt: PromptContent[] | undefined =
    restored.kind === "prompt" ? restored.input.prompt : restored.turn.checkpoint?.prompt;
  for (const image of restored.images ?? []) {
    if (!/^[a-f0-9]{64}$/.test(image.hash)) throw new Error("待发图片引用无效，原请求已保留。");
    const block = prompt?.[image.index];
    if (block?.type !== "image") throw new Error("待发图片位置无效，原请求已保留。");
    const file = path.join(privateDir, "attachments", `${image.hash}.json`);
    if ((await fs.stat(file)).size > Math.ceil((8 * 1024 * 1024 * 4) / 3) + 1024)
      throw new Error("待发图片超过容量限制，原请求已保留。");
    const stored = JSON.parse(await fs.readFile(file, "utf8")) as {
      mime?: unknown;
      data?: unknown;
    };
    if (
      typeof stored.data !== "string" ||
      stored.mime !== block.mimeType ||
      sha256(stored.data) !== image.hash
    )
      throw new Error("待发图片已变化，原请求已保留，请重新确认附件。");
    block.data = stored.data;
  }
  return restored;
}
