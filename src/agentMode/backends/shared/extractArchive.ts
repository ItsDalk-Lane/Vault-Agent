import { ManagedInstallAbortError } from "@/agentMode/backends/shared/managedInstall";
import { t } from "@/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface ExtractionOptions {
  signal?: AbortSignal;
  stripComponents?: number;
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  options: ExtractionOptions = {}
): Promise<void> {
  const { spawn } = requireNodeModule<typeof import("node:child_process")>("child_process");
  const args = ["-xf", archivePath, "-C", destDir];
  // Full runtime bundles have a wrapper directory; their installed layout must start below it.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (options.stripComponents) args.push(`--strip-components=${options.stripComponents}`);
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let stderr = "";
    let error: NodeJS.ErrnoException | undefined;
    proc.stderr.on("data", (data: Uint8Array) => {
      stderr += Buffer.from(data).toString();
    });
    proc.on("error", (cause: NodeJS.ErrnoException) => {
      error = cause;
    });
    proc.on("close", (code) => {
      if (options.signal?.aborted) reject(new ManagedInstallAbortError());
      else if (error?.code === "ENOENT")
        reject(new Error(t("agentInfra.backend.download.tarMissing")));
      else if (error)
        reject(new Error(t("agentInfra.backend.download.tarLaunch", { error: error.message })));
      else if (code === 0) resolve();
      else
        reject(
          new Error(
            t("agentInfra.backend.download.tarExit", {
              code: code ?? "",
              stderr: stderr.slice(0, 500),
            })
          )
        );
    });
  });
}
