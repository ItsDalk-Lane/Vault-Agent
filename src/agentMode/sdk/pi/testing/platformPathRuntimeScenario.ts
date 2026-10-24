import { requireNodeModule } from "@/utils/desktopRuntime";
import { PathResolver, isPathWithin } from "@/agentMode/sdk/pi/policy/PathResolver";
import { ExternalScopes } from "@/agentMode/sdk/pi/policy/ExternalScopes";

const assert: typeof import("node:assert/strict") = requireNodeModule("node:assert/strict");
const fs = requireNodeModule<typeof import("node:fs/promises")>("node:fs/promises");
const path = requireNodeModule<typeof import("node:path")>("node:path");

export async function runPlatformPathRuntimeScenario(directory: string) {
  const vault = path.join(directory, "BoundaryRoot");
  const alias = path.join(directory, "boundaryroot");
  const protectedRoot = path.join(vault, ".Secrets");
  const external = path.join(directory, "external");
  await fs.mkdir(protectedRoot, { recursive: true });
  await fs.mkdir(external);
  await fs.writeFile(path.join(vault, "note.md"), "owned fixture note");
  await fs.writeFile(path.join(protectedRoot, "key"), "owned fixture secret");
  await fs.writeFile(path.join(external, "outside.md"), "owned external fixture");
  const fileSystem = {
    realpath: (target: string) => fs.realpath(target),
    lstat: (target: string) => fs.lstat(target),
    stat: (target: string) => fs.stat(target, { bigint: true }),
  };
  const resolver = new PathResolver({
    vaultRoot: vault,
    protectedRoots: [protectedRoot],
    fileSystem,
    path,
  });
  assert.equal((await resolver.resolveVaultPath("note.md")).relative, "note.md");
  const original = await fs.stat(vault, { bigint: true });
  const aliasStats = await fs
    .stat(alias, { bigint: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  const insensitive = aliasStats?.dev === original.dev && aliasStats.ino === original.ino;
  const scopes = new ExternalScopes({ fileSystem, path, protectedRoots: [vault] });
  if (insensitive) {
    assert.equal(await isPathWithin(vault, path.join(alias, "note.md"), path, fileSystem), true);
    await assert.rejects(resolver.resolveVaultPath(".SECRETS/key"), { code: "PROTECTED_PATH" });
    await assert.rejects(
      scopes.createScope({ root: alias, createdBy: "user", permissions: ["read"] }),
      { code: "ROOT_OVERLAPS_PROTECTED" }
    );
    await fs.symlink(path.join(alias, "note.md"), path.join(vault, "inside-link.md"));
    assert.equal((await resolver.resolveVaultPath("inside-link.md")).relative, "note.md");
  } else {
    await fs.mkdir(alias, { recursive: true });
    await fs.writeFile(path.join(alias, "note.md"), "separate fixture directory");
    assert.equal(await isPathWithin(vault, path.join(alias, "note.md"), path, fileSystem), false);
    await scopes.createScope({ root: alias, createdBy: "user", permissions: ["read"] });
  }
  await fs.symlink(external, path.join(vault, "outside-link"));
  await assert.rejects(resolver.resolveVaultPath("outside-link/outside.md"), {
    code: "PATH_OUT_OF_SCOPE",
  });
  await assert.rejects(resolver.resolveVaultPath("outside-link/not-created.md"), {
    code: "PATH_OUT_OF_SCOPE",
  });
  await scopes.createScope({ root: external, createdBy: "user", permissions: ["read"] });
  assert.equal(
    (await scopes.checkRootAccess(path.join(external, "outside.md"), "read")).allowed,
    true
  );
  return {
    status: "passed",
    platform: process.platform,
    scope: "actual_host_filesystem_only_new_temporary_fixture_no_obsidian_no_model",
    caseSensitivity: insensitive ? "insensitive" : "sensitive",
    rootIdentity: { dev: String(original.dev), ino: String(original.ino) },
    aliasIdentity: aliasStats ? { dev: String(aliasStats.dev), ino: String(aliasStats.ino) } : null,
    checks: [
      "production_default_resolver_reads_relative_fixture_path",
      "case_boundary_follows_actual_volume_identity",
      "protected_root_or_distinct_root_is_judged_by_actual_identity",
      "external_scope_cannot_alias_protected_root",
      "symlink_target_and_missing_child_remain_outside_vault",
      "explicit_external_scope_accepts_its_actual_file",
    ],
    notRun: [
      ...(process.platform !== "win32" ? ["actual_windows_volume"] : []),
      ...(process.platform !== "linux" ? ["actual_linux_volume"] : []),
      ...(process.platform !== "darwin" || insensitive
        ? ["actual_case_sensitive_macos_volume"]
        : []),
    ],
  };
}
