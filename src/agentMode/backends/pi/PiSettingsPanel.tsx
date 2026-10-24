import React from "react";
import { updateAgentModeBackendFields, useSettingsValue } from "@/settings/model";
import { AgentToolsLayout } from "./ui/AgentToolsLayout";
import { t } from "@/i18n";
import { PiSubagentSettings } from "./PiSubagentSettings";
import { defaultEnabledProfiles } from "@/agentMode/sdk/pi/features/subagents/Profiles";
import { PiExternalFolders } from "./PiExternalFolders";

const EMPTY_EXTERNAL_SCOPES = Object.freeze([]);
const DEFAULT_SUBAGENT_PROFILES = defaultEnabledProfiles();

export function PiSettingsPanel() {
  const settings = useSettingsValue();
  return (
    <AgentToolsLayout
      permissions={
        <>
          <label className="tw-flex tw-items-start tw-gap-2 tw-text-sm">
            <input
              type="checkbox"
              checked={settings.agentMode.backends.pi?.hostExecutionMode === "trusted_host"}
              onChange={(event) =>
                updateAgentModeBackendFields("pi", {
                  hostExecutionMode: event.target.checked ? "trusted_host" : "strict",
                })
              }
            />
            <span>{t("agentInfra.backend.pi.mcp.form.trustedHost")}</span>
          </label>
          <PiSubagentSettings
            writerEnabled={(
              settings.agentMode.backends.pi?.enabledSubagentProfiles ?? DEFAULT_SUBAGENT_PROFILES
            ).includes("writer")}
            onWriterEnabledChange={(enabled) => {
              const profiles =
                settings.agentMode.backends.pi?.enabledSubagentProfiles ??
                DEFAULT_SUBAGENT_PROFILES;
              updateAgentModeBackendFields("pi", {
                enabledSubagentProfiles: enabled
                  ? [...new Set([...profiles, "writer"])]
                  : profiles.filter((profile) => profile !== "writer"),
              });
            }}
          />
        </>
      }
      externalFolders={
        <PiExternalFolders
          scopes={settings.agentMode.backends.pi?.externalScopes ?? EMPTY_EXTERNAL_SCOPES}
          onChange={(externalScopes) => updateAgentModeBackendFields("pi", { externalScopes })}
        />
      }
    />
  );
}
