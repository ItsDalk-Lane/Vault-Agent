import { preparePiRuntimeInput } from "@/agentMode/sdk/pi/runtime/PiRuntimeInput";
import { getSettings, setSettings } from "@/settings/model";
import { buildProjectContext } from "@/context/manifestBuilder";
import { getPiInstructionSections, PiBackendDescriptor } from "@/agentMode/backends/pi/descriptor";
import { desktopProviderFetch } from "@/utils/desktopProviderFetch";
import { PiBackendProcess } from "@/agentMode/sdk/pi/PiBackendProcess";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { App } from "obsidian";
import type VaultAgentPlugin from "@/main";
import {
  getCachedSystemPrompts,
  getSelectedPromptTitle,
  getDisableBuiltinSystemPrompt,
} from "@/system-prompts/state";
import {
  VAULT_AGENT_PROMPT_BASE,
  VAULT_AGENT_WEB_RESEARCH_STEERING,
  VAULT_AGENT_PROJECT_WORKSPACE_POLICY,
  VAULT_AGENT_INSTRUCTION_PRECEDENCE,
  VAULT_AGENT_EXECUTION_POLICY,
} from "@/agentMode/backends/shared/agentSystemPrompt";

jest.mock("@/context/manifestBuilder", () => ({ buildProjectContext: jest.fn() }));

jest.mock("@/system-prompts/state", () => ({
  getCachedSystemPrompts: jest.fn(),
  getSelectedPromptTitle: jest.fn(),
  getDisableBuiltinSystemPrompt: jest.fn(),
}));

jest.mock("@/agentMode/sdk/pi/PiBackendProcess", () => ({
  PiBackendProcess: jest.fn(),
}));

describe("descriptor", () => {
  describe("PiBackendDescriptor", () => {
    describe("createBackendProcess()", () => {
      it("reads project AGENTS despite whole-root QA exclusions and unrelated QA inclusions, while enforcing an independent instruction policy and protected paths https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "pi-project-agents-adapter-"));
        const previous = getSettings();
        const managed = "自定系统目录";
        const projectRelative = `${managed}/projects/中文项目`;
        const workspace = path.join(directory, projectRelative);
        const body = "项目口令：" + "保留原文".repeat(24);
        try {
          setSettings({ vaultAgentFolder: managed, qaInclusions: "", qaExclusions: managed });
          await mkdir(workspace, { recursive: true });
          await writeFile(path.join(workspace, "AGENTS.md"), body);
          const app = {
            vault: {
              configDir: ".fixture",
              adapter: { getBasePath: () => directory },
              getAbstractFileByPath: () => null,
            },
          } as unknown as App;
          PiBackendDescriptor.createBackendProcess({
            app,
            plugin: {} as VaultAgentPlugin,
            clientVersion: "test",
            descriptor: PiBackendDescriptor,
          });
          const host = jest.mocked(PiBackendProcess).mock.calls.at(-1)![0].host;
          expect(host.isVaultPathAllowed?.(`${projectRelative}/AGENTS.md`)).toBe(false);
          const prepare = (
            workspaceRoot = workspace,
            instructionPolicy = host.isInstructionPathAllowed
          ) =>
            preparePiRuntimeInput({
              input: { sessionId: "project", prompt: [{ type: "text", text: "按约定核对" }] },
              modelKey: "model",
              acceptsImages: false,
              contextWindowTokens: 32000,
              privateDir: path.join(directory, "private"),
              vaultRoot: directory,
              app,
              environment: { scope: { vaultRoot: directory, workspaceRoot } },
              isInstructionPathAllowed: instructionPolicy,
            });
          expect((await prepare()).instructions).toContain(body);
          setSettings({ qaInclusions: "不相关资料目录" });
          expect((await prepare()).instructions).toContain(body);
          expect(
            (await prepare(workspace, (source) => source !== `${projectRelative}/AGENTS.md`))
              .instructions
          ).not.toContain(body);
          const secret = "不得作为指令读取的配置或私有资料";
          for (const protectedDirectory of [".fixture", "private"]) {
            const protectedRoot = path.join(directory, protectedDirectory);
            await mkdir(protectedRoot, { recursive: true });
            await writeFile(path.join(protectedRoot, "AGENTS.md"), secret);
            expect((await prepare(protectedRoot)).instructions).not.toContain(secret);
          }
        } finally {
          setSettings(previous);
          await rm(directory, { recursive: true, force: true });
        }
      });

      it("reads the current project manifest at every host refresh instead of capturing an earlier project version https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
        const app = {} as App;
        PiBackendDescriptor.createBackendProcess({
          app,
          plugin: {} as VaultAgentPlugin,
          clientVersion: "test",
          descriptor: PiBackendDescriptor,
        });
        const host = jest.mocked(PiBackendProcess).mock.calls.at(-1)?.[0]?.host;
        jest
          .mocked(buildProjectContext)
          .mockReturnValueOnce("Project version one")
          .mockReturnValueOnce("Project version two");
        expect(host?.getProjectContext?.("project")).toEqual({ text: "Project version one" });
        expect(host?.getProjectContext?.("project")).toEqual({ text: "Project version two" });
        expect(buildProjectContext).toHaveBeenLastCalledWith(app, "project");
      });
      it("reads a discovered skill using its real absolute path without duplicating the vault root https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", async () => {
        const vaultRoot = await mkdtemp(path.join(tmpdir(), "pi-skill-source-"));
        try {
          const skillPath = path.join(vaultRoot, "技能", "验收", "SKILL.md");
          await mkdir(path.dirname(skillPath), { recursive: true });
          await writeFile(skillPath, "# 技能说明\n本地读取验收", "utf8");
          const read = jest.fn((source: string) => readFile(path.join(vaultRoot, source), "utf8"));
          PiBackendDescriptor.createBackendProcess({
            app: { vault: { adapter: { read } } } as unknown as App,
            plugin: {} as VaultAgentPlugin,
            clientVersion: "test",
            descriptor: PiBackendDescriptor,
          });
          const host = jest.mocked(PiBackendProcess).mock.calls.at(-1)?.[0]?.host;
          expect(host?.fetch).toBe(desktopProviderFetch);
          if (!host?.skillsSource)
            throw new Error("Skill source was not wired to the real backend");
          await expect(host.skillsSource.readBody(skillPath)).resolves.toBe(
            "# 技能说明\n本地读取验收"
          );
          expect(read).not.toHaveBeenCalled();
        } finally {
          await rm(vaultRoot, { recursive: true, force: true });
        }
      });
    });
  });

  describe("getPiInstructionSections()", () => {
    it("keeps the existing prompt text in base, tool guidance, and selected user order https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      jest
        .mocked(getCachedSystemPrompts)
        .mockReturnValue([{ title: "chosen", content: "User instructions" }] as ReturnType<
          typeof getCachedSystemPrompts
        >);
      jest.mocked(getSelectedPromptTitle).mockReturnValue("chosen");
      jest.mocked(getDisableBuiltinSystemPrompt).mockReturnValue(false);
      expect(getPiInstructionSections()).toEqual({
        base: [VAULT_AGENT_PROMPT_BASE, VAULT_AGENT_WEB_RESEARCH_STEERING].join("\n\n"),
        toolGuidance: [
          VAULT_AGENT_EXECUTION_POLICY,
          VAULT_AGENT_PROJECT_WORKSPACE_POLICY,
          VAULT_AGENT_INSTRUCTION_PRECEDENCE,
        ].join("\n\n"),
        userSystem: ["User instructions"],
      });
    });

    it("disables only optional builtins while keeping policy guidance and a stable empty user section https://github.com/ItsDalk-Lane/Vault-Agent/issues/1", () => {
      jest.mocked(getCachedSystemPrompts).mockReturnValue([]);
      jest.mocked(getSelectedPromptTitle).mockReturnValue("");
      jest.mocked(getDisableBuiltinSystemPrompt).mockReturnValue(true);
      const sections = getPiInstructionSections();
      expect(sections.base).toBe("");
      expect(sections.toolGuidance).toContain(VAULT_AGENT_INSTRUCTION_PRECEDENCE);
      expect(sections.userSystem).toHaveLength(0);
      expect(getPiInstructionSections().userSystem).toBe(sections.userSystem);
    });
  });
});
