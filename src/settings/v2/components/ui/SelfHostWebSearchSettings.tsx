import { SettingItem } from "@/components/ui/setting-item";
import { t, type MessageKey } from "@/i18n";
import type { SelfHostSearchProvider } from "@/settings/model";
import { ArrowUpRight } from "lucide-react";
import React from "react";

interface SearchProviderConfig {
  apiKeyTitleKey: MessageKey;
  descriptionKey: MessageKey;
  label: string;
  placeholder: string;
  signupUrl: string;
}

const SEARCH_PROVIDER_CONFIGS: Record<SelfHostSearchProvider, SearchProviderConfig> = {
  firecrawl: {
    apiKeyTitleKey: "settings.selfHost.provider.firecrawl.apiKeyTitle",
    descriptionKey: "settings.selfHost.provider.firecrawl.description",
    label: "Firecrawl",
    placeholder: "fc-…",
    signupUrl: "https://firecrawl.link/logan-yang",
  },
  perplexity: {
    apiKeyTitleKey: "settings.selfHost.provider.perplexity.apiKeyTitle",
    descriptionKey: "settings.selfHost.provider.perplexity.description",
    label: "Perplexity Sonar",
    placeholder: "pplx-…",
    signupUrl: "https://docs.perplexity.ai",
  },
  parallel: {
    apiKeyTitleKey: "settings.selfHost.provider.parallel.apiKeyTitle",
    descriptionKey: "settings.selfHost.provider.parallel.description",
    label: "Parallel",
    placeholder: "parallel-…",
    signupUrl: "https://platform.parallel.ai/",
  },
  exa: {
    apiKeyTitleKey: "settings.selfHost.provider.exa.apiKeyTitle",
    descriptionKey: "settings.selfHost.provider.exa.description",
    label: "Exa",
    placeholder: "exa-…",
    signupUrl: "https://dashboard.exa.ai/api-keys",
  },
};

const SEARCH_PROVIDER_OPTIONS = Object.entries(SEARCH_PROVIDER_CONFIGS).map(([value, config]) => ({
  label: config.label,
  value,
}));

export interface SelfHostWebSearchSettingsProps {
  apiKeys: Readonly<Record<SelfHostSearchProvider, string>>;
  disabled?: boolean;
  onApiKeyChange: (provider: SelfHostSearchProvider, value: string) => void;
  onProviderChange: (provider: SelfHostSearchProvider) => void;
  provider: SelfHostSearchProvider;
}

export const SelfHostWebSearchSettings: React.FC<SelfHostWebSearchSettingsProps> = ({
  apiKeys,
  disabled = false,
  onApiKeyChange,
  onProviderChange,
  provider,
}) => {
  const config = SEARCH_PROVIDER_CONFIGS[provider];

  return (
    <>
      <SettingItem
        type="select"
        title={t("settings.selfHost.searchProvider")}
        description={t("settings.selfHost.searchProviderDesc")}
        value={provider}
        onChange={(value) => onProviderChange(value as SelfHostSearchProvider)}
        options={SEARCH_PROVIDER_OPTIONS}
        disabled={disabled}
      />

      <SettingItem
        type="password"
        title={t(config.apiKeyTitleKey)}
        description={
          <span>
            {t(config.descriptionKey)}{" "}
            <a
              href={config.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tw-text-accent"
            >
              {t("settings.selfHost.signUp")}{" "}
              <ArrowUpRight className="tw-inline tw-size-3 tw-align-text-bottom" />
            </a>
          </span>
        }
        value={apiKeys[provider]}
        onChange={(value) => onApiKeyChange(provider, value)}
        placeholder={config.placeholder}
        disabled={disabled}
      />
    </>
  );
};
