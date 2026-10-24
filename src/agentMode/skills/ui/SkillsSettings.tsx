import { ALL_MANAGED_SKILLS } from "@/builtinSkills/builtinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { BuiltinSkillsTable } from "./BuiltinSkillsTable";
import { formatSkillDisplayName } from "@/agentMode/skills/mergeDiscovery";
import {
  buildSkillRepairPrompt,
  type SkillRepairEvidence,
} from "@/agentMode/skills/skillRepairPrompt";
import { DeleteConfirmModal } from "./DeleteConfirmDialog";
import { EmptyPlaceholder } from "./EmptyPlaceholder";
import {
  AllSkillsNotLoaded,
  SkillLoadIssues,
  SkillLoadIssuesModal,
  type SkillLoadIssue,
} from "./SkillLoadIssues";
import {
  PropertiesModal,
  type PropertiesSaveOutcome,
  type PropertiesSaveRequest,
} from "./PropertiesDialog";
import { SkillManager, useManagedSkills, useRejectedSkills } from "@/agentMode/skills/SkillManager";
import { SkillRow } from "./SkillRow";
import { type Skill } from "@/agentMode/skills/types";
import { Input } from "@/components/ui/input";
import { deriveSkillsFolder } from "@/settings/vaultAgentFolder";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { openVaultPath } from "@/utils/openVaultPath";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { getVaultBase, toVaultRelative } from "@/utils/vaultPath";
import { useSettingsValue } from "@/settings/model";
import { t } from "@/i18n";
import { Search } from "lucide-react";
import { Notice, TFolder } from "obsidian";
import { useApp } from "@/context";
import { usePlugin } from "@/contexts/PluginContext";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BUILTIN_ROWS = ALL_MANAGED_SKILLS.map((skill) => ({
  name: skill.name,
  description: parseSkillFile(skill.skillMd, skill.name).frontmatter.description,
  content: skill.skillMd,
}));

export const SkillsSettings: React.FC = () => {
  const app = useApp();
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const skillsFolder = deriveSkillsFolder(settings);
  const skills = useManagedSkills();
  const rejectedSkills = useRejectedSkills();

  const [searchValue, setSearchValue] = useState("");
  const [builtinPending, setBuiltinPending] = useState<readonly string[]>([]);
  const [builtinError, setBuiltinError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const userSkills = useMemo(() => skills.filter((skill) => !skill.builtin), [skills]);
  const eligibleBuiltins = ALL_MANAGED_SKILLS;
  const unavailableReasons: Record<string, string> = {};
  for (const skill of eligibleBuiltins) {
    const collision =
      userSkills.some(
        (userSkill) => userSkill.name === skill.name && userSkill.location.kind === "canonical"
      ) ||
      rejectedSkills.some(
        (rejected) =>
          toVaultRelative(rejected.dirPath, getVaultBase(app)) === `${skillsFolder}/${skill.name}`
      );
    if (collision) {
      unavailableReasons[skill.name] = t("agentInfra.skills.collision");
    }
  }
  const builtinRows = BUILTIN_ROWS.filter(
    (skill) =>
      eligibleBuiltins.some((builtin) => builtin.name === skill.name) &&
      `${skill.name} ${skill.description}`.toLowerCase().includes(searchValue.trim().toLowerCase())
  );

  const handleBuiltinChange = useCallback(async (name: string, enabled: boolean) => {
    setBuiltinPending((names) => [...names, name]);
    setBuiltinError(undefined);
    try {
      const manager = SkillManager.getInstance();
      const result = await manager.setBuiltinSkillEnabled(name, enabled);
      if (!result.ok) setBuiltinError(result.message);
      else setRefreshError(undefined);
    } catch (error) {
      setBuiltinError(
        t("agentInfra.skills.updateFailed", {
          name,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setBuiltinPending((names) => names.filter((pendingName) => pendingName !== name));
    }
  }, []);
  const handleToggleBuiltinSkill = useCallback(
    (name: string, enabled: boolean) => {
      void handleBuiltinChange(name, enabled);
    },
    [handleBuiltinChange]
  );
  const containerRef = useRef<HTMLDivElement>(null);

  // Refresh on focus: fixing a hidden agent file in an external editor bypasses Obsidian's
  // watcher. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  useEffect(() => {
    const manager = SkillManager.getInstance();
    let active = true;
    const refresh = async () => {
      const result = await manager.refresh();
      if (active) {
        setRefreshError(
          result.reconcileError ??
            result.discoveryError ??
            (result.reconcileErrorCount > 0 ? t("agentInfra.skills.refreshLinksFailed") : undefined)
        );
      }
    };
    void refresh();
    const hostWindow = containerRef.current?.win;
    const handleFocus = (): void => {
      void refresh();
    };
    hostWindow?.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      hostWindow?.removeEventListener("focus", handleFocus);
    };
  }, [skillsFolder]);

  const handleEditSkillMd = useCallback(
    (skill: Skill) => {
      openVaultPath(app, skill.filePath, { newLeaf: true });
    },
    [app]
  );

  // Hidden agent folders are outside Obsidian's index, so they cannot use the vault reveal
  // path. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
  const handleRevealSkillFolder = useCallback(
    (dirPath: string) => {
      const folderRel = toVaultRelative(dirPath, getVaultBase(app));
      if (app.vault.getAbstractFileByPath(folderRel) instanceof TFolder) {
        revealFolderInExplorer(app, folderRel);
        return;
      }
      void openWithSystemDefault(dirPath);
    },
    [app]
  );

  const handleFixWithAgent = useCallback(
    (issues: readonly SkillRepairEvidence[]): void => {
      (app as unknown as { setting: { close: () => void } }).setting.close();
      void plugin.newAgentChatWithDraft(buildSkillRepairPrompt(issues));
    },
    [app, plugin]
  );

  const loadIssues = useMemo<SkillLoadIssue[]>(() => {
    const vaultBase = getVaultBase(app);
    return rejectedSkills.map((skill) => {
      const folderRel = toVaultRelative(skill.dirPath, vaultBase);
      const indexed = app.vault.getAbstractFileByPath(folderRel) instanceof TFolder;
      const evidence: SkillRepairEvidence = {
        location: toVaultRelative(skill.filePath, vaultBase),
        reason: skill.reason,
        offendingText: skill.offendingText,
      };
      return {
        ...evidence,
        revealLabel: indexed
          ? t("agentInfra.skills.row.reveal")
          : t("agentInfra.skills.issues.showInFolder"),
        onFixWithAgent: () => handleFixWithAgent([evidence]),
        onOpen: () => openVaultPath(app, skill.filePath, { newLeaf: true }),
        onReveal: () => handleRevealSkillFolder(skill.dirPath),
      };
    });
  }, [app, handleFixWithAgent, handleRevealSkillFolder, rejectedSkills]);

  const filteredSkills = useMemo(
    () => filterSkills(userSkills, searchValue),
    [userSkills, searchValue]
  );

  const displayFolder = skillsFolder;

  const handleEditProperties = useCallback(
    (skill: Skill) => {
      new PropertiesModal(
        app,
        skill,
        displayFolder,
        async (req: PropertiesSaveRequest): Promise<PropertiesSaveOutcome> => {
          const manager = SkillManager.getInstance();
          const result = await manager.saveProperties(skill, {
            newName: req.nameChanged ? req.newName : undefined,
            patch: req.patch,
          });
          if (!result.ok) {
            if (result.code === "collision") return "collision";
            if (result.code === "invalid") {
              return "stay";
            }
            new Notice(
              t("agentInfra.skills.updateFailed", {
                name: req.nameChanged ? req.newName : skill.name,
                error: result.message,
              })
            );
            return "stay";
          }
          return "close";
        }
      ).open();
    },
    [app, displayFolder]
  );

  const handleAskDelete = useCallback(
    (skill: Skill) => {
      const manager = SkillManager.getInstance();
      new DeleteConfirmModal(app, skill, displayFolder, async () => {
        const result = await manager.deleteSkill(skill);
        if (!result.ok) {
          new Notice(
            t("agentInfra.skills.deleteFailed", {
              name: skill.name,
              error: result.message,
            })
          );
        }
      }).open();
    },
    [app, displayFolder]
  );

  return (
    <div ref={containerRef} className="tw-space-y-4">
      <section>
        <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
          <div className="tw-text-xl tw-font-bold">{t("agentInfra.skills.title")}</div>
          <div className="tw-text-sm tw-text-muted">{t("agentInfra.skills.intro")}</div>
        </div>

        {refreshError && (
          <div role="alert" className="tw-text-ui-smaller tw-text-error">
            {refreshError}
          </div>
        )}

        {loadIssues.length > 0 && (
          <div className="tw-mt-3">
            <SkillLoadIssues
              issues={loadIssues}
              onViewDetails={() =>
                new SkillLoadIssuesModal(app, loadIssues, () =>
                  handleFixWithAgent(loadIssues)
                ).open()
              }
            />
          </div>
        )}

        <div className="tw-mt-4 tw-flex tw-items-center tw-gap-2">
          <div className="tw-relative tw-flex-1 sm:tw-flex-initial">
            <Search
              className="tw-pointer-events-none tw-absolute tw-left-2.5 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-faint"
              aria-hidden="true"
            />
            <Input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={t("agentInfra.skills.searchPlaceholder")}
              className="!tw-w-full !tw-pl-8 sm:!tw-w-64"
              aria-label={t("agentInfra.skills.searchAria")}
            />
          </div>
          <span className="tw-text-xs tw-text-muted">
            {t("agentInfra.skills.loadedCount", { count: userSkills.length })}
          </span>
        </div>

        <div className="tw-mt-4" role="region" aria-label={t("agentInfra.skills.yourSkills")}>
          <div
            role="heading"
            aria-level={3}
            className="tw-mb-3 tw-text-left tw-text-base tw-font-semibold"
          >
            {t("agentInfra.skills.yourSkills")}
          </div>
          {userSkills.length === 0 ? (
            // Rejected files prove skills exist; the empty state would claim there are none. https://github.com/Brevilabs/obsidian-copilot-private/issues/166
            rejectedSkills.length > 0 ? (
              <AllSkillsNotLoaded />
            ) : (
              <EmptyPlaceholder folder={displayFolder} />
            )
          ) : (
            <div className="tw-flex tw-flex-col tw-gap-1.5">
              {filteredSkills.length === 0 ? (
                <div className="tw-rounded-sm tw-border tw-border-dashed tw-border-border tw-bg-primary tw-px-3 tw-py-6 tw-text-center tw-text-ui-smaller tw-text-muted">
                  {t("agentInfra.skills.noMatch", { query: searchValue })}
                </div>
              ) : (
                filteredSkills.map((skill) => (
                  <SkillRow
                    key={skill.dirPath}
                    skill={skill}
                    onEditSkillMd={() => handleEditSkillMd(skill)}
                    onEditProperties={() => handleEditProperties(skill)}
                    onRevealInVault={() => handleRevealSkillFolder(skill.dirPath)}
                    onDelete={() => handleAskDelete(skill)}
                    containerRef={containerRef}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </section>
      <BuiltinSkillsTable
        skills={builtinRows}
        preferences={settings.agentMode.skills.builtinPreferences}
        unavailableReasons={unavailableReasons}
        pendingSkills={builtinPending}
        error={builtinError}
        onToggleSkill={handleToggleBuiltinSkill}
      />
    </div>
  );
};

function filterSkills(skills: Skill[], query: string): Skill[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return skills;
  return skills.filter(
    (s) =>
      formatSkillDisplayName(s).toLowerCase().includes(trimmed) ||
      s.description.toLowerCase().includes(trimmed)
  );
}
