import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/i18n";
import React from "react";

interface ModelOption {
  label: string;
  value: string;
}

export interface QuickChatModelSettingsProps {
  defaultModelId: string | undefined;
  options: ModelOption[];
  onDefaultModelChange: (modelId: string) => void;
  children: React.ReactNode;
}

export const QuickChatModelSettings: React.FC<QuickChatModelSettingsProps> = ({
  defaultModelId,
  options,
  onDefaultModelChange,
  children,
}) => (
  <SettingSection>
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-py-4">
      <span className="tw-text-base tw-font-semibold">{t("settings.quickChat.modelsTitle")}</span>
      <span className="tw-text-xs tw-text-muted">{t("settings.quickChat.modelsDesc")}</span>
    </div>
    <SettingItem
      type="select"
      title={t("settings.quickChat.defaultModel")}
      description={t("settings.quickChat.defaultModelDesc")}
      value={defaultModelId ?? "Select Model"}
      onChange={(value) => {
        if (value === "Select Model") return;
        onDefaultModelChange(value);
      }}
      options={
        defaultModelId !== undefined
          ? options
          : [{ label: t("settings.quickChat.selectModel"), value: "Select Model" }, ...options]
      }
      placeholder={t("settings.quickChat.modelPlaceholder")}
    />
    <div className="tw-py-4">{children}</div>
  </SettingSection>
);
