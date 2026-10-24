export interface ProjectInstruction {
  readonly path: string;
  readonly scope: string;
  readonly text: string;
}

export interface ProjectInstructionOptions {
  readonly workspaceRelativePath: string;
  readonly read: (path: string, maxBytes: number) => Promise<string | undefined>;
  readonly maxBytes?: number;
}

const EMPTY_INSTRUCTIONS: readonly ProjectInstruction[] = Object.freeze([]);
const EMPTY_NOTICES: readonly string[] = Object.freeze([]);

export async function loadProjectInstructions(options: ProjectInstructionOptions): Promise<{
  readonly instructions: readonly ProjectInstruction[];
  readonly notices: readonly string[];
}> {
  const notices: string[] = [];
  const relative = options.workspaceRelativePath;
  const segments = relative.split("/").filter(Boolean);
  const insideVault =
    !relative.startsWith("/") &&
    !relative.includes("\\") &&
    !segments.some((part) => part === ".." || part.includes(":"));
  if (!insideVault)
    notices.push("Project AGENTS.md discovery outside the current vault was omitted.");
  const directories = [""];
  if (insideVault)
    for (let i = 1; i <= segments.length; i++) directories.push(segments.slice(0, i).join("/"));
  let remaining = options.maxBytes ?? 32 * 1024;
  const instructions: ProjectInstruction[] = [];
  for (const directory of directories.reverse()) {
    const path = directory ? `${directory}/AGENTS.md` : "AGENTS.md";
    try {
      const text = await options.read(path, remaining);
      if (text === undefined || text.trim().length === 0) continue;
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > remaining) {
        notices.push(
          `Project instructions ${path} were omitted because the instruction byte budget is exhausted.`
        );
        continue;
      }
      remaining -= bytes;
      instructions.unshift({ path, scope: directory || ".", text });
    } catch {
      notices.push(
        `Project instructions ${path} were omitted because they could not be read within the current scope or size limit.`
      );
    }
  }
  return {
    instructions: instructions.length ? Object.freeze(instructions) : EMPTY_INSTRUCTIONS,
    notices: notices.length ? Object.freeze(notices) : EMPTY_NOTICES,
  };
}
