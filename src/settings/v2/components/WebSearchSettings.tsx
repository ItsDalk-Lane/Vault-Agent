import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/i18n";
import { updateSetting, useSettingsValue, type SelfHostSearchProvider } from "@/settings/model";
import { SelfHostWebSearchSettings } from "@/settings/v2/components/ui/SelfHostWebSearchSettings";
import React from "react";

const SEARCH_PROVIDER_KEY_FIELDS = {
  firecrawl: "firecrawlApiKey",
  perplexity: "perplexityApiKey",
  parallel: "parallelApiKey",
  exa: "exaApiKey",
} as const satisfies Record<SelfHostSearchProvider, keyof ReturnType<typeof useSettingsValue>>;

export const WebSearchSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-4">
      <div className="tw-flex tw-items-start tw-gap-2.5 tw-text-sm tw-text-muted">
        <span className="tw-max-w-[620px]">{t("settings.webSearch.intro")}</span>
      </div>

      <SettingSection label={t("settings.selfHost.webSearchProviders")}>
        <SelfHostWebSearchSettings
          apiKeys={{
            firecrawl: settings.firecrawlApiKey,
            perplexity: settings.perplexityApiKey,
            parallel: settings.parallelApiKey,
            exa: settings.exaApiKey,
          }}
          provider={settings.selfHostSearchProvider}
          onProviderChange={(provider) => updateSetting("selfHostSearchProvider", provider)}
          onApiKeyChange={(provider, value) =>
            updateSetting(SEARCH_PROVIDER_KEY_FIELDS[provider], value)
          }
        />
      </SettingSection>
    </div>
  );
};
