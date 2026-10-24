import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The Pi SDK is confined to src/agentMode/sdk/pi, and legacy history readers may never
// spawn the removed agent binaries. Both rules are enforced by one scanner script:
// https://github.com/ItsDalk-Lane/Vault-Agent/issues/1
const PROJECT_ROOT = path.resolve(__dirname, "../../../../..");
const CHECKER_SCRIPT = path.join(PROJECT_ROOT, "scripts", "check-pi-boundaries.mjs");

interface PiBoundaryViolation {
  file: string;
  specifier: string;
  reason: string;
}

interface PiBoundaryReport {
  result: "passed" | "failed";
  root: string;
  scannedFiles: number;
  violations: PiBoundaryViolation[];
}

interface CheckerResult {
  status: number;
  report: PiBoundaryReport;
}

const createdFixtures: string[] = [];

function createFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-boundaries-"));
  createdFixtures.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return root;
}

function parseReport(stdout: string): PiBoundaryReport {
  return JSON.parse(stdout) as PiBoundaryReport;
}

function runBoundaries(root?: string): CheckerResult {
  const args = [CHECKER_SCRIPT, "--json", ...(root ? ["--root", root] : [])];
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: PROJECT_ROOT, encoding: "utf8" });
    return { status: 0, report: parseReport(stdout) };
  } catch (error: unknown) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    if (failure.status === 1 && typeof failure.stdout === "string" && failure.stdout.trim()) {
      return { status: 1, report: parseReport(failure.stdout) };
    }
    throw new Error(`check-pi-boundaries failed to run: ${String(failure.stderr ?? error)}`);
  }
}

afterEach(() => {
  for (const root of createdFixtures.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("checkPiBoundaries", () => {
  describe("piSdkImportViolations()", () => {
    it("fails when a UI module imports Harness directly from the locked SDK", () => {
      const root = createFixture({
        "src/agentMode/ui/DirectHarness.ts":
          'import { Harness } from "@earendil-works/pi-durable";\n' +
          "export const harness = Harness;\n",
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(1);
      expect(report.result).toBe("failed");
      expect(report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/agentMode/ui/DirectHarness.ts",
            specifier: "@earendil-works/pi-durable",
            reason: "pi-sdk-import-outside-sdk-pi",
          }),
        ])
      );
    });

    it("fails when a backend imports a private dist entry", () => {
      const root = createFixture({
        "src/agentMode/backends/pi/DirectDist.ts":
          'import { openNodeJsonlStorage } from "@earendil-works/pi-durable/dist/storage/jsonl/node.js";\n',
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(1);
      expect(report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/agentMode/backends/pi/DirectDist.ts",
            reason: "pi-sdk-private-import",
          }),
        ])
      );
    });

    it("fails for a dynamic import of the SDK outside sdk/pi", () => {
      const root = createFixture({
        "src/agentMode/session/DynamicLoad.ts":
          'export const load = async () => import("@earendil-works/pi-ai/models");\n',
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(1);
      expect(report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/agentMode/session/DynamicLoad.ts",
            specifier: "@earendil-works/pi-ai/models",
            reason: "pi-sdk-import-outside-sdk-pi",
          }),
        ])
      );
    });

    it("passes for public subpath imports inside sdk/pi", () => {
      const root = createFixture({
        "src/agentMode/sdk/pi/AllowedAdapter.ts":
          'import type { Context } from "@earendil-works/chord";\n' +
          'import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";\n' +
          'import { createModels } from "@earendil-works/pi-ai/models";\n' +
          "export type AdapterContext = Context;\n" +
          "export const openStore = openNodeJsonlStorage;\n" +
          "export const makeModels = createModels;\n",
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(0);
      expect(report.result).toBe("passed");
      expect(report.violations).toEqual([]);
    });

    it("passes on the current repository", () => {
      const { status, report } = runBoundaries();

      expect(status).toBe(0);
      expect(report.result).toBe("passed");
      expect(report.violations).toEqual([]);
      expect(report.scannedFiles).toBeGreaterThan(100);
    });
  });

  describe("legacyProcessViolations()", () => {
    it.each(["claude", "codex", "opencode"])(
      "rejects imports of the retired %s runtime descriptor https://github.com/ItsDalk-Lane/Vault-Agent/issues/1",
      (backendId) => {
        const specifier = `@/agentMode/backends/${backendId}/descriptor`;
        const root = createFixture({
          "src/agentMode/ui/OldBackend.ts": `export { descriptor } from ${JSON.stringify(specifier)};\n`,
        });
        const { status, report } = runBoundaries(root);
        expect(status).toBe(1);
        expect(report.violations).toEqual([
          expect.objectContaining({ specifier, reason: "removed-execution-import" }),
        ]);
      }
    );

    it("fails when a legacy history reader imports node:child_process", () => {
      const root = createFixture({
        "src/agentMode/session/legacy/LegacyReader.ts":
          'import { execFileSync } from "node:child_process";\n' +
          "export const read = () => execFileSync;\n",
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(1);
      expect(report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: "src/agentMode/session/legacy/LegacyReader.ts",
            specifier: "node:child_process",
            reason: "legacy-process-import",
          }),
        ])
      );
    });

    it("passes for a legacy reader that only reads stored history", () => {
      const root = createFixture({
        "src/agentMode/session/legacy/HistoryReader.ts":
          'import * as fs from "node:fs";\n' + "export const readHistory = fs.readFileSync;\n",
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(0);
      expect(report.violations).toEqual([]);
    });
  });

  describe("parseImportedSpecifiers()", () => {
    it("ignores package names that appear only in comments", () => {
      const root = createFixture({
        "src/agentMode/ui/CommentOnly.ts":
          '// import { Harness } from "@earendil-works/pi-durable";\n' +
          "/*\n" +
          'import { createModels } from "@earendil-works/pi-ai/models";\n' +
          "*/\n" +
          'import { App } from "obsidian";\n' +
          "export type HostApp = App;\n",
      });

      const { status, report } = runBoundaries(root);

      expect(status).toBe(0);
      expect(report.result).toBe("passed");
      expect(report.violations).toEqual([]);
    });
  });
});
