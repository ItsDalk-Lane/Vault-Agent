import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { t, type MessageKey } from "@/i18n";
import { TabProvider, useTab } from "@/contexts/TabContext";
import VaultAgentPlugin from "@/main";
import { ByokPanel, ModelManagementProvider } from "@/modelManagement";
import { resetSettings } from "@/settings/model";
import {
  VAULT_AGENT_SETTINGS_TAB_IDS,
  type VaultAgentSettingsTabId,
} from "@/settings/settingsTabs";
import { useSkillLoadErrorCount } from "@/settings/skillLoadErrorState";
import { useLanguage } from "@/i18n/useLanguage";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Cog, Command, Cpu, Plug, ShieldCheck, Sparkle, Wrench } from "lucide-react";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";
import { DesktopOnlySettingsPanel } from "./components/DesktopOnlySettingsPanel";
import { SelfHostSettings } from "./components/SelfHostSettings";
import { McpSettingsPanel } from "./components/McpSettingsPanel";

const LazySkillsSettings = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.SkillsSettings }))
);

const SkillsSettingsPanel: React.FC = () => {
  if (!isDesktopRuntime()) {
    return <DesktopOnlySettingsPanel message={t("settings.skillsDesktopOnly")} />;
  }
  return (
    <React.Suspense fallback={null}>
      <LazySkillsSettings />
    </React.Suspense>
  );
};

const icons: Record<VaultAgentSettingsTabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  selfhost: <ShieldCheck className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  skills: <Sparkle className="tw-size-5" />,
  mcp: <Plug className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

const components: Record<VaultAgentSettingsTabId, React.FC> = {
  basic: () => <BasicSettings />,
  byok: () => <ByokPanel />,
  selfhost: () => <SelfHostSettings />,
  command: () => <CommandSettings />,
  skills: SkillsSettingsPanel,
  mcp: McpSettingsPanel,
  advanced: () => <AdvancedSettings />,
};

const TAB_LABEL_KEYS: Record<VaultAgentSettingsTabId, MessageKey> = {
  basic: "settings.tab.basic",
  byok: "settings.tab.byok",
  selfhost: "settings.tab.selfhost",
  command: "settings.tab.command",
  skills: "settings.tab.skills",
  mcp: "settings.tab.mcp",
  advanced: "settings.tab.advanced",
};

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();
  const skillLoadErrorCount = useSkillLoadErrorCount();
  const tabs = VAULT_AGENT_SETTINGS_TAB_IDS.map((id) => ({
    id,
    icon: icons[id],
    label: t(TAB_LABEL_KEYS[id]),
  })) satisfies TabItemType[];

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-rounded-lg">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={{
              ...tab,
              // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
              // The tab strip stays mounted while inactive panels do not, so
              // load failures remain visible from every settings section.
              warningLabel:
                tab.id === "skills" && skillLoadErrorCount > 0
                  ? t("settings.skillsLoadFailed")
                  : undefined,
            }}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </div>
      <div className="tw-w-full tw-border tw-border-solid" />

      <div>
        {VAULT_AGENT_SETTINGS_TAB_IDS.map((id) => {
          const Component = components[id];
          return (
            <TabContent key={id} id={id} isSelected={selectedTab === id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: VaultAgentPlugin;
  initialTab?: VaultAgentSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  useLanguage();
  const [resetKey, setResetKey] = React.useState(0);

  React.useEffect(() => {
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/166
    // Agent repairs can change hidden files while the window stays focused and
    // the Skills panel is unmounted. Refresh when Settings next opens so its tab
    // marker never depends on visiting the Skills panel first.
    void plugin.skills?.refresh();
  }, [plugin]);

  const handleReset = () => {
    const modal = new ResetSettingsConfirmModal(plugin.app, () => {
      resetSettings();
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <PluginProvider plugin={plugin}>
      <ModelManagementProvider api={plugin.modelManagement}>
        <TabProvider initialTab={initialTab}>
          <div className="tw-mx-auto tw-max-w-[860px]">
            <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
              <div
                role="heading"
                aria-level={1}
                className="tw-flex tw-flex-col tw-gap-2 tw-text-base tw-font-semibold sm:tw-flex-row sm:tw-items-center sm:tw-justify-between"
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span>{t("settings.title")}</span>
                  <div className="tw-flex tw-items-center tw-gap-1">
                    <span className="tw-text-xs tw-font-normal tw-text-muted">
                      v{plugin.manifest.version}
                    </span>
                  </div>
                </div>
                <div className="tw-self-end sm:tw-self-auto">
                  <Button variant="secondary" size="sm" onClick={handleReset}>
                    {t("settings.reset")}
                  </Button>
                </div>
              </div>
            </div>
            <SettingsContent key={resetKey} />
          </div>
        </TabProvider>
      </ModelManagementProvider>
    </PluginProvider>
  );
};

export default SettingsMainV2;
