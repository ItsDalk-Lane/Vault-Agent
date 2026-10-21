import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { useTab } from "@/contexts/TabContext";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { updateSetting, useSettingsValue, type SelfHostSearchProvider } from "@/settings/model";
import { SelfHostWebSearchSettings } from "@/settings/v2/components/ui/SelfHostWebSearchSettings";
import { ShieldCheck } from "lucide-react";
import React from "react";

const BYOK_TAB_ID = "byok";

const SEARCH_PROVIDER_KEY_FIELDS = {
  firecrawl: "firecrawlApiKey",
  perplexity: "perplexityApiKey",
  parallel: "parallelApiKey",
  exa: "exaApiKey",
} as const satisfies Record<SelfHostSearchProvider, keyof ReturnType<typeof useSettingsValue>>;

export const SelfHostSettings: React.FC = () => {
  const settings = useSettingsValue();
  const { setSelectedTab } = useTab();
  const selfHostOn = settings.enableSelfHostMode;

  return (
    <div className="tw-space-y-4">
      <div className="tw-flex tw-items-start tw-gap-2.5 tw-text-sm tw-text-muted">
        <span className="tw-max-w-[620px]">{t("settings.selfHost.intro")}</span>
      </div>

      <SettingSection>
        <SettingItem
          type="switch"
          title={t("settings.selfHost.enable")}
          description={
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {t("settings.selfHost.enableDesc")}
              <HelpTooltip content={t("settings.selfHost.enableDescTooltip")} />
            </span>
          }
          checked={selfHostOn}
          onCheckedChange={(checked) => updateSetting("enableSelfHostMode", checked)}
        />

        <div
          className={cn(
            "tw-flex tw-items-start tw-gap-2 tw-py-3 tw-text-xs tw-text-normal tw-bg-interactive-accent/10"
          )}
        >
          <ShieldCheck className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-accent" />
          <div className="tw-leading-relaxed">
            <span className="tw-font-semibold">{t("settings.selfHost.privacyTitle")}</span>{" "}
            {t("settings.selfHost.privacyBody")}
          </div>
        </div>
      </SettingSection>

      <div className={cn("tw-space-y-4", !selfHostOn && "tw-pointer-events-none tw-opacity-40")}>
        <SettingSection label={t("settings.selfHost.webSearchProviders")}>
          <SelfHostWebSearchSettings
            apiKeys={{
              firecrawl: settings.firecrawlApiKey,
              perplexity: settings.perplexityApiKey,
              parallel: settings.parallelApiKey,
              exa: settings.exaApiKey,
            }}
            disabled={!selfHostOn}
            provider={settings.selfHostSearchProvider}
            onProviderChange={(provider) => updateSetting("selfHostSearchProvider", provider)}
            onApiKeyChange={(provider, value) =>
              updateSetting(SEARCH_PROVIDER_KEY_FIELDS[provider], value)
            }
          />
        </SettingSection>

        <SettingSection label={t("settings.selfHost.selfHostedModels")}>
          <SettingItem
            type="custom"
            title={t("settings.selfHost.modelsTitle")}
            description={<span>{t("settings.selfHost.modelsDesc")}</span>}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setSelectedTab(BYOK_TAB_ID)}
              disabled={!selfHostOn}
            >
              {t("settings.selfHost.openByok")}
            </Button>
          </SettingItem>
        </SettingSection>
      </div>
    </div>
  );
};
