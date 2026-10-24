import { requireNodeModule } from "@/utils/desktopRuntime";
import { t } from "@/i18n";

interface SaveDialog {
  showSaveDialog(options: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

export async function saveChatExport(
  name: string,
  content: string,
  attachments: readonly { name: string; content: Uint8Array }[] = []
): Promise<{ path: string } | null> {
  const electron = requireNodeModule<{ dialog?: SaveDialog; remote?: { dialog?: SaveDialog } }>(
    "electron"
  );
  const dialog = electron.dialog ?? electron.remote?.dialog;
  if (!dialog) throw new Error(t("localData.saveUnavailable"));
  const chosen = await dialog.showSaveDialog({
    defaultPath: name,
    filters: [{ name: t("localData.export"), extensions: [name.endsWith(".md") ? "md" : "json"] }],
  });
  if (chosen.canceled || !chosen.filePath) return null;
  const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("node:path");
  const chosenPath = path.resolve(chosen.filePath);
  const folder = path.dirname(chosenPath);
  const targets = attachments.map((attachment) => {
    const target = path.resolve(folder, attachment.name);
    const relative = path.relative(folder, target);
    if (
      path.isAbsolute(attachment.name) ||
      !relative ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) ||
      target === chosenPath
    )
      throw new Error(t("localData.exportPathInvalid"));
    return { target, attachment, segments: relative.split(path.sep) };
  });
  for (const { target, attachment, segments } of targets) {
    let current = folder;
    // 已有文件夹链接不能把聊天附件写到用户没有选择的位置。https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
    for (const segment of segments) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stat?.isSymbolicLink() || (current !== target && stat && !stat.isDirectory()))
        throw new Error(t("localData.exportPathInvalid"));
      if (current !== target && !stat) await fs.mkdir(current, { mode: 0o700 });
    }
    await fs.writeFile(target, attachment.content, {
      mode: 0o600,
      flag:
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        (fs.constants.O_NOFOLLOW ?? 0),
    });
  }
  await fs.writeFile(chosen.filePath, content, "utf8");
  return { path: chosen.filePath };
}
