import { logWarn } from "@/logger";
import type { ProjectDiscoveryFs } from "./discoverProjectSkills";
import { requireNodeModule } from "@/utils/desktopRuntime";

// Only the read-only canonical/project discovery adapter remains; the reconcile, migration and symlink
// adapters were removed with the legacy skill distribution.
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
async function nodeList(p: string): Promise<string[]> {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  try {
    return await fs.promises.readdir(p);
  } catch (err) {
    logWarn(`[skills] readdir ${p} failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function createNodeProjectFs(): ProjectDiscoveryFs {
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  return {
    list: (p) => nodeList(p),
    async readFile(p) {
      return fs.promises.readFile(p, "utf-8");
    },
    async exists(p) {
      try {
        await fs.promises.lstat(p);
        return true;
      } catch {
        return false;
      }
    },
    async isDirectory(p) {
      try {
        const st = await fs.promises.stat(p);
        return st.isDirectory();
      } catch {
        return false;
      }
    },
    async isSymlink(p) {
      try {
        const st = await fs.promises.lstat(p);
        return st.isSymbolicLink();
      } catch {
        return false;
      }
    },
  };
}

export function createNodeProjectDiscoveryFs(): ProjectDiscoveryFs {
  return createNodeProjectFs();
}
